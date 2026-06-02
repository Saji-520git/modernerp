# BROcode ERP — Cloud / Multi-Tenant Architecture

This document explains how BROcode ERP v2 supports a **single hosted instance
serving multiple clients** (multi-tenant SaaS) while remaining 100 % compatible
with the existing **single-client / Electron** deployments.

---

## 1. Design principle: additive dual-mode

The cloud foundation never changes single-client behaviour. The whole system
runs in one of two modes, decided per-request by the presence of a `tenantId` in
the authenticated user's JWT:

| Mode                | Trigger                            | Config source                     |
| ------------------- | ---------------------------------- | --------------------------------- |
| **Single-client**   | No `tenantId` in token (or no auth)| Singleton `ClientConfig` row      |
| **Cloud / tenant**  | `tenantId` present in token        | The matching `Tenant` row         |

Key invariants:

- `tenantId` is **optional everywhere** (`String?` on `User`). Existing rows and
  Electron tokens have no `tenantId` and behave exactly as before.
- No existing model field was changed. The migration only **adds** a nullable
  `User.tenantId` column and a new `tenants` table.
- Module resolution, middleware, and routes all fall back to the singleton path
  when no tenant is in scope.

---

## 2. Data model

```
User                          Tenant (new — "tenants" table)
├─ id                         ├─ id          cuid
├─ email                      ├─ name
├─ role                       ├─ slug        @unique
├─ ...existing fields...      ├─ plan        default "starter"
├─ tenantId  String?  ◄───────┤ isActive     default true
└─ tenant    Tenant?  ──────► ├─ maxUsers    default 5
   (FK, ON DELETE SET NULL)   ├─ modules     Json   default "{}"
                              ├─ settings    Json   default "{}"
                              ├─ trialEndsAt DateTime?
                              ├─ createdAt / updatedAt
                              └─ users       User[]
```

Migration: `add_tenant_model` — purely additive (nullable column + new table +
FK with `ON DELETE SET NULL`).

---

## 3. Request lifecycle

```
            ┌─────────────────────────────────────────────────────────┐
  request → │ helmet · cors · json · rateLimit                         │
            ├─────────────────────────────────────────────────────────┤
            │ /health, /health/ready          (no tenant needed)       │
            ├─────────────────────────────────────────────────────────┤
            │ tenantMiddleware  (GLOBAL)                                │
            │   • reads tenantId from req.auth or decodes Bearer token  │
            │   • none      → req.tenant = null   (single-client)       │
            │   • present   → load Tenant                               │
            │        - missing/inactive → 403 TENANT_INACTIVE           │
            │        - active           → req.tenant = <Tenant>         │
            │   • on error  → log + req.tenant = null (fail open)       │
            ├─────────────────────────────────────────────────────────┤
            │ /api/v1 (legacy)   ·   /api/v2 (modules, hr, tenants)     │
            │   • requireAuth (per-router)                              │
            │   • requireModule(name) → configService.getModules(       │
            │         req.tenant ?? null)                               │
            └─────────────────────────────────────────────────────────┘
```

Because `requireAuth` runs **per-router** (not globally), `req.auth` is not yet
populated when the global `tenantMiddleware` runs. The middleware therefore does
a best-effort `jwt.verify` of the Bearer token itself purely to extract
`tenantId`. Authorization is still enforced later by `requireAuth`.

---

## 4. Module resolution (dual-mode)

`configService.getModules(tenant?)` is the single source of truth:

```ts
getModules(tenant?: { modules: unknown } | null): ModuleFlags {
  if (tenant) return { ...DEFAULT_MODULES, ...(tenant.modules ?? {}) }; // cloud
  // single-client: merge stored ClientConfig.modules over defaults
  return { ...DEFAULT_MODULES, ...(clientConfig.modules ?? {}) };
}
```

- `requireModule(name)` calls `getModules(req.tenant ?? null)` and returns
  `403 MODULE_DISABLED` if the flag is off. It **fails open** if config is
  unreadable so a config outage never locks the whole API.
- Existing callers that pass nothing keep the original singleton behaviour — the
  parameter is optional and backward compatible.

---

## 5. Tenant lifecycle

### Registration (public)
`POST /api/v2/tenants/register` — rate limited to **5/hour/IP**. In one
`prisma.$transaction` it:
1. validates input (Zod), slugifies the name (or uses a provided slug),
2. ensures slug + admin email are unique,
3. creates the `Tenant` with plan-preset modules and `maxUsers`,
4. creates an `ADMIN` `User` (bcrypt-hashed password, cost 12) linked via
   `tenantId`,
5. returns the tenant plus a tenant-scoped access token.

### Tenant-scoped tokens
The issued JWT embeds `{ userId, role, permissions, tenantId }`. On every
subsequent request `tenantMiddleware` reads that `tenantId` and attaches the
active `Tenant`, scoping module access to the tenant's plan.

### Management (super-admin only)
Guarded by `requireAuth + requireSuperAdmin` (email must equal
`SUPER_ADMIN_EMAIL`):

| Endpoint                               | Action                          |
| -------------------------------------- | ------------------------------- |
| `GET  /api/v2/tenants`                 | List tenants (+ user counts)    |
| `GET  /api/v2/tenants/:id`             | Tenant detail                   |
| `PUT  /api/v2/tenants/:id`             | Update name/plan/limits/modules |
| `POST /api/v2/tenants/:id/modules`     | Toggle modules                  |
| `POST /api/v2/tenants/:id/deactivate`  | Soft-deactivate (`isActive=false`)|

Deactivation is a **soft** operation (consistent with the platform's
soft-delete rule): the tenant row is kept, `isActive` flips to `false`, and
`tenantMiddleware` then rejects its tokens with `403 TENANT_INACTIVE`.

---

## 6. Plans

| Plan         | Modules                                              | Max users |
| ------------ | ---------------------------------------------------- | --------- |
| `starter`    | pos, inventory, customers, expenses, reports         | 5         |
| `standard`   | + purchasing, suppliers, warehouses                  | 15        |
| `business`   | + hr, manufacturing                                  | 50        |
| `enterprise` | all modules                                          | 1000      |

Plans are presets applied at creation; a tenant's `modules` JSON can be tuned
afterwards and is always merged over `DEFAULT_MODULES`.

---

## 7. Deployment topology

```
                 Internet
                    │  (TLS terminated upstream — LB / Cloudflare / proxy)
                    ▼
        ┌───────────────────────┐
        │  frontend (nginx)     │  serves React bundle
        │  Dockerfile.frontend  │  proxies /api, /uploads, /health → backend
        └───────────┬───────────┘
                    │ docker network
        ┌───────────▼───────────┐
        │  backend (Express)    │  Prisma; runs `migrate deploy` on boot
        │  Dockerfile.backend   │  port 4000
        └───────────┬───────────┘
                    │
        ┌───────────▼───────────┐
        │  db (postgres:16)     │  named volume: brocode-erp-db-data
        └───────────────────────┘
```

Defined in `docker-compose.prod.yml`. The frontend's nginx
(`nginx/nginx.conf`) reverse-proxies `/api`, `/uploads`, and the health probes
to the backend, and serves `index.html` for SPA client-side routes.

---

## 8. Security notes

- Secrets (`JWT_*`, DB password) come only from `.env`, which is gitignored and
  excluded from images via `.dockerignore`.
- JWT secrets are validated at startup (≥32 chars) by the env schema.
- The super-admin panel is invisible to client admins — access requires the
  configured `SUPER_ADMIN_EMAIL`, looked up by user id on every request.
- Registration is rate-limited; the global limiter (300/min/IP) and login
  limiter remain in force.
- Postgres is not published to the host by default; only the backend reaches it
  over the internal compose network.

---

## 9. What this foundation intentionally does **not** do yet

- Row-level tenant data isolation (per-tenant scoping of products, sales, etc.).
  Only `User` carries `tenantId` today; business tables are not yet
  tenant-partitioned. This is the next step toward full data isolation.
- Per-tenant subdomains / custom domains.
- Billing / subscription enforcement beyond the plan→modules mapping.

These are deliberately out of scope for the v2.2 cloud **foundation** and can be
layered on without breaking single-client mode.
