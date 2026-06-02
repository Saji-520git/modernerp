# BROcode ERP v2 — General ERP Development Rules
# Applies to: dev branch and main

## VISION
One universal ERP codebase that serves any business type.
Features controlled by module flags per client.
Two delivery modes: Cloud SaaS + Electron offline.
Built by BROcode Solutions.

## ARCHITECTURE PRINCIPLES
1. Module-first : every feature belongs to a named module
2. Flag-gated   : every module is behind a feature flag
3. Client-safe  : disabled modules are invisible to client
4. Additive     : new modules never break existing ones
5. Deployable   : every commit must be deployable

## MODULE FLAG SYSTEM
Every module has a flag in the client config:
{
  pos            : true/false
  inventory      : true/false
  purchasing     : true/false
  customers      : true/false
  suppliers      : true/false
  expenses       : true/false
  reports        : true/false
  warehouses     : true/false
  manufacturing  : true/false
  hrPayroll      : true/false
  multiLocation  : true/false
  ecommerce      : true/false
  bakery         : true/false
  repairs        : true/false
  crm            : true/false
  whatsapp       : true/false
}

Super-admin controls all flags.
Client can only toggle flags explicitly allowed.
Hidden modules: not in sidebar, not in routes,
not in API, not in DB queries.

## BUSINESS TYPE TEMPLATES
Grocery/Retail  : pos, inventory, purchasing, customers,
                  suppliers, expenses, reports, warehouses
Hardware Store  : + purchasing heavy, no bakery
Bakery          : + manufacturing, production orders
Clothing        : + variants, sizes, colors
Mobile Repair   : + repair jobs, parts inventory
Pharmacy        : + expiry critical, batch mandatory
Hotel           : + rooms, bookings (future)

## DEVELOPMENT PHASES

### Phase 4 — Foundation (current)
Sprint 1 : Module flag system + super-admin panel
Sprint 2 : HR & Staff management
Sprint 3 : Manufacturing / production orders
Sprint 4 : Multi-branch / multi-location
Sprint 5 : Cloud deployment (Docker + VPS)

### Phase 5 — Business types
Sprint 6  : Bakery module
Sprint 7  : Repair shop module
Sprint 8  : Clothing / variants module
Sprint 9  : SaaS billing + subscription system

### Phase 6 — Scale
Sprint 10 : Mobile app (React Native)
Sprint 11 : API marketplace / integrations
Sprint 12 : Advanced analytics + AI insights

## FOLDER STRUCTURE (v2)
backend/src/modules/
  core/           ← auth, users, settings (always on)
  pos/            ← point of sale
  inventory/      ← stock management
  purchasing/     ← purchase orders, GRN
  customers/      ← CRM, credit
  suppliers/      ← supplier management
  expenses/       ← expense tracking
  reports/        ← all reports
  warehouses/     ← multi-warehouse
  manufacturing/  ← NEW Phase 4
  hr/             ← NEW Phase 4
  locations/      ← NEW Phase 4
  [future modules added here]

frontend/src/modules/
  [mirrors backend module structure]

## NEW MODULE CHECKLIST
Before building any new module:
[ ] Module flag added to client config schema
[ ] Sidebar entry behind flag check
[ ] Routes behind flag check
[ ] Backend routes behind permission check
[ ] Module has its own folder in modules/
[ ] Module has its own Prisma models
[ ] Migration created and tested
[ ] tsc --noEmit clean before PR

## SUPER-ADMIN PANEL
Route  : /super-admin (never visible to clients)
Access : BROcode Solutions staff only
Can do :
  - Enable/disable modules per client
  - Set client name, logo, business type
  - Apply business type template (one click)
  - View all clients and their status
  - Push config updates remotely (cloud)
  - Generate new Electron build config (offline)

## API STANDARDS (v2)
All routes: /api/v2/[module]/[resource]
Auth header: Bearer token (JWT)
Response format:
{
  success: boolean,
  data: T | null,
  message: string,
  pagination?: { page, limit, total }
}

Error format:
{
  success: false,
  error: string,
  code: string,    ← machine-readable
  details?: any
}

## DATABASE RULES
- Every table has: id, createdAt, updatedAt, deletedAt
- Every table has: tenantId (for multi-client cloud)
- Soft delete everywhere (deletedAt not null = deleted)
- No raw SQL — Prisma only
- Migrations: one migration per feature, named clearly
- Never edit an existing migration

## MULTI-TENANT RULES (cloud)
Every query MUST filter by tenantId:
  where: { tenantId: ctx.tenantId, deletedAt: null }
Middleware validates tenantId on every request.
No cross-tenant data leak is acceptable — ever.

## ELECTRON v2 (when needed)
Branch from main when ready for offline packaging.
Module flags baked into build config.
Client gets only their enabled modules compiled in.
Same build:win process as v1.

## COMMIT FORMAT (v2)
feat(module): description
fix(module): description
refactor(module): description

Examples:
  feat(hr): add staff attendance tracking
  feat(flags): add module flag middleware
  fix(manufacturing): correct BOM calculation
  feat(super-admin): add client management panel
