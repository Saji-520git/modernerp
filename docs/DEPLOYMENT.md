# BROcode ERP — Cloud Deployment Guide

This guide covers deploying BROcode ERP v2 as a **single hosted instance serving
multiple clients (multi-tenant / SaaS)** using Docker.

> **Single-client / Electron deployments are unaffected.** Everything here is
> additive. When no `tenantId` is present in a user's token the app runs exactly
> as it always has (singleton `ClientConfig`). See
> [CLOUD-ARCHITECTURE.md](./CLOUD-ARCHITECTURE.md) for how dual-mode works.

---

## 1. Prerequisites

- A Linux host (or any Docker host) with:
  - Docker Engine 24+ and the Docker Compose plugin
  - At least 2 vCPU / 2 GB RAM for a small deployment
- A DNS record pointing at the host (e.g. `erp.example.com`)
- (Recommended) A TLS terminator in front — a managed load balancer, Cloudflare,
  or an nginx/Caddy reverse proxy doing HTTPS. The bundled nginx serves plain
  HTTP on the published port.

---

## 2. Components

The production stack is defined in [`docker-compose.prod.yml`](../docker-compose.prod.yml):

| Service    | Image / build        | Role                                                        |
| ---------- | -------------------- | ----------------------------------------------------------- |
| `db`       | `postgres:16`        | PostgreSQL data store (persisted to a named volume)         |
| `backend`  | `Dockerfile.backend` | Express + Prisma API on port 4000; runs migrations on boot  |
| `frontend` | `Dockerfile.frontend`| nginx serving the React bundle + reverse-proxying `/api`    |

The dev-only `docker-compose.yml` (Postgres + Adminer) is left in place for local
development and is **not** used in production.

---

## 3. Configure environment

1. Copy the template and fill in real values:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env`:

   - **Postgres:** set `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.
   - **`DATABASE_URL`:** must use the compose hostname `db` and match the Postgres
     credentials, e.g.
     `postgresql://erp:<password>@db:5432/brocode_erp?schema=public`.
   - **JWT secrets:** `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must each be at
     least 32 characters and should be different. Generate strong values:

     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```

   - **`CORS_ORIGIN`:** the public URL of your frontend (e.g. `https://erp.example.com`).
   - **`SUPER_ADMIN_EMAIL`:** the BROcode Solutions staff email that may access the
     super-admin panel (tenant management).
   - **`VITE_API_URL`:** leave as `/api` to use the bundled nginx proxy.
   - **`HTTP_PORT`:** host port the frontend listens on (default `80`).

> **Never commit `.env`.** It is gitignored. The `.dockerignore` also prevents it
> from being copied into any image layer.

---

## 4. Build & start

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

On first boot the backend container automatically runs
`prisma migrate deploy`, which applies all committed migrations (including the
`add_tenant_model` migration) before starting the server. This command is
idempotent and never prompts.

Check status:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend
```

---

## 5. Verify the deployment

```bash
# Liveness — process is up
curl http://localhost/health

# Readiness — process is up AND the database is reachable
curl http://localhost/health/ready
```

`/health` returns `{ status: "ok", uptime, version, ts }`.
`/health/ready` returns `200` with `database: "connected"` when healthy, or
`503` with `database: "unavailable"` when the DB is unreachable.

---

## 6. Onboard the first client (tenant)

Two ways to create a tenant:

### a) Self-service registration (public, rate-limited)

```bash
curl -X POST http://localhost/api/v2/tenants/register \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Acme Hardware",
    "plan": "standard",
    "adminEmail": "owner@acme.example.com",
    "adminPassword": "a-strong-password",
    "adminName": "Acme Owner"
  }'
```

The response includes the new `tenant` and a tenant-scoped JWT for the admin
user. This endpoint is limited to **5 requests per hour per IP**.

### b) Super-admin management

Log in as the `SUPER_ADMIN_EMAIL` user, then use the **Super Admin → Tenant
Management** UI, or the API directly:

| Method & path                          | Purpose                       |
| -------------------------------------- | ----------------------------- |
| `GET  /api/v2/tenants`                 | List all tenants              |
| `GET  /api/v2/tenants/:id`             | Tenant detail (with userCount)|
| `PUT  /api/v2/tenants/:id`             | Update name/plan/limits/etc.  |
| `POST /api/v2/tenants/:id/modules`     | Toggle enabled modules        |
| `POST /api/v2/tenants/:id/deactivate`  | Soft-deactivate a tenant      |

Deactivated tenants (`isActive: false`) are rejected by `tenantMiddleware` with
`403 TENANT_INACTIVE`.

---

## 7. Plans & modules

Plan presets (see `backend/src/modules/tenants/tenant.service.ts`):

| Plan         | Modules enabled                                                            | Max users |
| ------------ | -------------------------------------------------------------------------- | --------- |
| `starter`    | pos, inventory, customers, expenses, reports                               | 5         |
| `standard`   | starter + purchasing, suppliers, warehouses                                | 15        |
| `business`   | standard + hr, manufacturing                                               | 50        |
| `enterprise` | all modules                                                                | 1000      |

A tenant's module flags can be customised afterwards via the modules endpoint;
they are merged over the platform `DEFAULT_MODULES`.

---

## 8. Backups

The database lives in the `brocode-erp-db-data` volume; uploaded files in
`brocode-erp-uploads`. Back both up regularly:

```bash
# Database dump
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%F).sql

# Uploads (copy the named volume contents)
docker run --rm -v brocode-erp-uploads:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

---

## 9. Updating

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Migrations are applied automatically on backend startup. Always take a database
backup before updating a production instance.

---

## 10. Troubleshooting

| Symptom                                   | Likely cause / fix                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Backend exits on boot                     | Invalid env vars — check `JWT_*` length (≥32) and `DATABASE_URL` format.  |
| `/health/ready` returns 503               | DB not reachable — check the `db` container and `DATABASE_URL` host/creds.|
| `403 TENANT_INACTIVE` on requests         | Tenant is deactivated — reactivate via `PUT /api/v2/tenants/:id`.         |
| `403 MODULE_DISABLED`                     | Module off for that tenant — enable via the modules endpoint/UI.          |
| Frontend loads but API calls fail (CORS)  | `CORS_ORIGIN` does not match the public frontend URL.                     |
| Migration errors on boot                  | Inspect `docker compose logs backend`; ensure the DB volume isn't stale.  |
