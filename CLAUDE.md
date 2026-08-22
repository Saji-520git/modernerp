# ModernERP — Claude Project Guide

> **READ THIS FIRST EVERY SESSION.** This file is the single source of truth for the project state, rules, and what to build next. Always update this file when a module is completed.

---

## 1. Project Identity

**Name:** ModernERP
**Goal:** A modern, full-featured ERP built incrementally with AI — one module at a time.
**Stack:** React 18 + Vite + TypeScript (frontend) · Node.js + Express + TypeScript (backend) · PostgreSQL 16 + Prisma 5.22 (database)
**Ports:** Frontend `:5173` · Backend `:4000` · PostgreSQL `:5432`
**Repo root:** `ModernERP_Project/claude-code-setup/`

---

## 2. Current Phase

### Phase 1 — Core ERP: **IN PROGRESS**

| # | Module | Status | Key Notes |
|---|---|---|---|
| 1 | Auth + JWT | ✅ Done | Login/logout, access + refresh tokens, bcryptjs |
| 2 | Master Data | ✅ Done | Categories, brands, units, warehouses |
| 3 | Products | ✅ Done | SKU, barcode, pricing, tax %, reorder level |
| 4 | POS | ✅ Done | Cart, checkout, stock deduction, receipt; shares INV- number sequence with Sales |
| 5 | Inventory | ✅ Done | Stock levels per warehouse, adjustments, transfers, movement history |
| 6 | Purchases | ✅ Done | PO-YYYY-NNNN, draft → confirm → stock-in (PURCHASE_IN movement) |
| 7 | Contacts | ✅ Done | Suppliers + Customers combined page (2 tabs) |
| 8 | Sales | ✅ Done | INV-YYYY-NNNN, draft → confirm → stock deduction (SALE_OUT), payment recording |
| 9 | Sales Returns | ✅ Done | CRN-YYYY-NNNN, validates available qty, RETURN_IN movement restores stock |
| 10 | User Management | ✅ Done | Full CRUD + role/permission system (17 permissions, 4 roles, per-user custom overrides) |
| 11 | Dashboard | ✅ Done | KPI cards, 14-day revenue bar chart (CSS), top products, recent sales, stock alerts |
| 12 | PDF Export | ✅ Done | jsPDF + jspdf-autotable; Download PDF on Invoice, PO, and CRN modals |
| 13 | Reports | ✅ Done | Sales/Purchases/Products/Customers/Inventory/P&L tabs; pure CSS charts; PDF export |
| 14 | Products Page | ✅ Done | Full CRUD — table, search, category/brand filter, create/edit modal, margin preview, stock drawer |
| 15 | Dashboard v2 | ✅ Done | Gradient hero card, outstanding receivables, inventory value, month purchases, quick actions, better design |
| 16 | POS v2 | ✅ Done | Customer selector (walk-in / existing), keyboard shortcuts (F1-F5, Enter, Shift+Enter, Esc), professional receipt, quit button |
| 17 | POS v3 + Settings | ✅ Done | Draft/hold bills (H=hold, L=load drafts), per-item price adjust (role-gated), credit sales (CREDIT payment, limit enforcement), expiry alerts on products, customer credit setup, Settings page for categories/brands/units CRUD |
| 18 | Unit Conversion   | ✅ Done | Product-specific conversions (Box→Piece etc.), base-unit stock storage, multi-level chains, POS unit selector, purchase unit column, inventory display in all units, Units management page |

### After Phase 1 (do NOT build yet)
- Phase 2: Accounting, HR, Payroll
- Phase 3: CRM, Manufacturing, Projects
- Phase 4: Multi-branch, E-commerce, Mobile App

---

## 3. Tech Stack (locked — do not change without asking)

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + Vite + TypeScript |
| UI styling | Tailwind CSS + shadcn/ui (copy-in components under `src/components/ui`) |
| Server state | TanStack Query v5 |
| Client state | Zustand |
| HTTP client | Axios |
| Routing | React Router v6 |
| Backend | Node.js + Express + TypeScript (ESM mode) |
| Database | PostgreSQL 16 |
| ORM | Prisma 5.22.0 — schema at `backend/src/prisma/schema.prisma` |
| Auth | JWT (access + refresh) stored in httpOnly cookies + Zustand |
| Validation | Zod (both sides) |
| Password hashing | bcryptjs (NOT bcrypt) |
| Charts | Pure CSS/Tailwind on legacy pages; Recharts via shadcn Chart on the Dashboard |

### 3.1 shadcn/ui — how it is wired here (read before adding a component)

shadcn is copy-in, not a dependency: components live in `src/components/ui` and
are OURS to edit. `components.json` is configured so
`npx shadcn@latest add <name>` drops new ones in correctly.

**`shadcn init` was deliberately NOT run.** It rewrites `index.css` and
`tailwind.config.js` with its own palette, which would have replaced the design
tokens in §3 and restyled every existing page. Instead:

- `index.css` carries a **bridge block**: shadcn variable names
  (`--background`, `--primary`, `--border`, …) defined as HSL ALIASES of the
  existing hex tokens, in both `:root` and `[data-theme="dark"]`. shadcn
  components therefore inherit the app palette and follow the existing theme
  toggle with no `dark:` variants. **Change a token, update its alias.**
- `tailwind.config.js` adds the shadcn colour names purely additively. No
  existing name was re-pointed, so pages predating this render unchanged.
- `accent` already means the indigo brand here, which is NOT what shadcn means
  by it. Our components hover on `bg-muted` instead. Do not "fix" this by
  repointing `accent` — it would move every page that already uses it.
- Card radius and control heights are pinned to the app (`--radius-xl`, 36px),
  not shadcn defaults, so new components sit beside the old ones.

---

## 4. Critical Technical Rules

### 4.1 Imports (ESM — all must have .js extension)
```typescript
import { prisma } from '../../config/prisma.js';      // ✅ correct
import { HttpError } from '../../middleware/error-handler.js';
import bcrypt from 'bcryptjs';                          // NOT bcrypt
```

### 4.2 Money
- Always stored as **integer cents** (e.g., `priceCents`, `totalCents`)
- Never use floats for money. Convert at display time: `cents / 100`

### 4.3 Database writes
- Any write touching **more than 1 table** must use `prisma.$transaction()`
- Tax: taxPercent stored in DB, always set to 0 for new products.
  Never display tax rows in POS UI or receipts.
- Payment methods enum: CASH | CARD | BANK_TRANSFER | QR_PAY | CREDIT
- Credit sales: only allowed when customer.creditEnabled === true

### 4.4 Prisma schema location
```
backend/src/prisma/schema.prisma    ← non-default location
```
Migration command:
```bash
npx prisma migrate dev --name <description> --schema src/prisma/schema.prisma
```
Or simply (if `schema` is set in package.json):
```bash
npx prisma migrate dev --name <description>
```

### 4.5 Auth middleware
```typescript
// JWT payload carries: { userId, role, permissions[] }
requireAuth          // validates JWT, sets req.auth
requirePermission('manage_users')  // checks permissions[] array in JWT
```

### 4.6 Permission system
- 21 granular permissions defined in `backend/src/config/permissions.ts`
- 4 roles (ADMIN, MANAGER, CASHIER, STAFF) with default permission sets
- Each user can have a custom `permissions Json?` field on the User model that overrides their role defaults
- `resolvePermissions(role, customPermissions)` returns the effective permission array
- All routes use `requirePermission(...)` — NOT `requireRole`

### 4.7 Password rules
- Min 8 characters, at least 1 letter, at least 1 number
- Hashed with bcryptjs, 12 rounds (SALT_ROUNDS = 12 — do not reduce)

---

## 5. Folder Structure

```
claude-code-setup/
├── CLAUDE.md                          ← this file
├── backend/
│   └── src/
│       ├── config/
│       │   ├── prisma.ts              ← Prisma client singleton
│       │   ├── permissions.ts         ← ALL_PERMISSIONS, ROLE_DEFAULTS, PERMISSION_GROUPS
│       │   └── env.ts
│       ├── middleware/
│       │   ├── auth.ts                ← requireAuth, requirePermission
│       │   └── error-handler.ts       ← HttpError class
│       ├── modules/
│       │   ├── index.ts               ← registers all routers
│       │   ├── auth/
│       │   ├── users/                 ← CRUD + permissions PATCH /:id/permissions
│       │   ├── products/
│       │   ├── inventory/
│       │   ├── purchases/
│       │   ├── suppliers/
│       │   ├── customers/
│       │   ├── sales/                 ← sales.* + returns.* (4 files each)
│       │   ├── pos/
│       │   ├── dashboard/             ← single /summary endpoint (v2: + unpaid, monthPurchases, inventoryValue)
│       │   ├── products/              ← CRUD + /meta (categories, brands, units)
│       │   └── reports/               ← sales, purchases, products, customers, inventory, profit-loss
│       └── prisma/
│           └── schema.prisma
│
└── frontend/
    └── src/
        ├── services/
        │   ├── api.ts                 ← axios instance
        │   ├── auth.ts
        │   ├── users.ts               ← includes Permission types + PERMISSION_GROUPS
        │   ├── sales.ts               ← includes SaleReturn types
        │   ├── dashboard.ts           ← DashboardSummary, formatCurrency helpers
        │   ├── reports.ts             ← all report types + reportsApi + format helpers
        │   ├── pdfExport.ts           ← exportSaleInvoice, exportPurchaseOrder, exportSaleReturn
        │   ├── inventory.ts
        │   ├── purchases.ts
        │   ├── contacts.ts
        │   └── pos.ts
        ├── store/
        │   └── authStore.ts           ← { user, accessToken, refreshToken }
        ├── components/
        │   └── layout/
        │       └── AppShell.tsx       ← sidebar nav, role-filtered (User Mgmt = ADMIN only)
        └── pages/
            ├── auth/                  ← LoginPage
            ├── dashboard/             ← DashboardPage (live KPIs + chart)
            ├── pos/                   ← POSPage
            ├── inventory/             ← InventoryPage
            ├── purchases/             ← PurchasesPage
            ├── contacts/              ← ContactsPage (Suppliers + Customers tabs)
            ├── sales/                 ← SalesPage (Invoices + New Invoice + Returns tabs)
            ├── users/                 ← UsersPage (2-column modal with permission toggles)
            ├── products/              ← ProductsPage (full CRUD, drawer, create/edit modal)
            ├── reports/               ← ReportsPage (6 tabs: Sales/Purchases/Products/Customers/Inventory/P&L)
            └── settings/              ← SettingsPage (stub)
```

---

## 6. Data Models Summary (Prisma)

```
User          — id, email, passwordHash, fullName, role, permissions Json?, isActive
Category      — id, name, parentId (self-relation)
Brand         — id, name
Unit          — id, name, shortCode, allowDecimal, type (UnitType), isActive
ProductUnitConversion — productId, fromUnitId, toUnitId, conversionQty Decimal(18,6), priceCents?, barcode?
Warehouse     — id, name, code, address, isActive
Product       — id, sku, barcode, name, costCents, priceCents, taxPercent, reorderLevel, expiryDate, expiryAlertDays
Stock         — productId + warehouseId (unique), qty Decimal, shortfallQty Decimal
                 (qty is NEVER negative and always == SUM(positive batches);
                  units sold past zero live in shortfallQty and are settled by
                  the next stock increase — see utils/stock-utils.ts)
StockMovement — productId, warehouseId, type (enum), qty (signed), refType, refId, batchId?
StockBatch    — productId, warehouseId, purchaseLineId?, qty, expiryDate?, receivedAt
AppSettings   — …blockExpiredSales Boolean @default(true)
Customer      — id, name, phone, email, address, isActive, creditEnabled, creditLimitCents, creditAlertPct, creditSettleDays
Supplier      — id, name, phone, email, address, isActive
Purchase      — number PO-YYYY-NNNN, supplierId, warehouseId, status DocStatus
PurchaseLine  — purchaseId, productId, qty, unitCostCents, taxPercent, lineTotalCents
Sale          — number INV-YYYY-NNNN, customerId?, warehouseId, status, isPos, paidCents
SaleLine      — saleId, productId, qty, unitPriceCents, taxPercent, discountCents
SaleReturn    — number CRN-YYYY-NNNN, saleId, warehouseId, reason?, totalCents
SaleReturnLine— returnId, productId, qty, unitPriceCents, lineTotalCents

PosDraft      — id, label, warehouseId, customerId, paymentMethod, discountCents, note, createdById
PosDraftItem  — id, draftId, productId, qty, unitPriceCents

Enums: Role, DocStatus (DRAFT/CONFIRMED/CANCELLED), PaymentMethod (CASH/CARD/BANK_TRANSFER/WALLET/CREDIT/OTHER), StockMoveType
```

---

## 7. Current Module Pointer

> **Phase 1: COMPLETE ✓**
> **Phase 2: COMPLETE ✓**
> **Now starting: Phase 3**
> **Choose next sprint:** See section 13 for options A-E
>
> All Phase 1 modules done: Auth, Products, Inventory,
> Contacts, POS, Purchases, Sales Invoice, Reports
>
> All Phase 2 sprints done: User Management, Batch Expiry,
> Returns UI, Barcode Labels, Expenses

---

## 8. Development Commands

```bash
# Backend (run from backend/)
npm run dev                                        # starts on :4000
npx prisma migrate dev --name <description>        # new migration
npx prisma studio                                  # visual DB browser
npx prisma generate                                # regenerate client after schema change

# Frontend (run from frontend/)
npm run dev                                        # starts on :5173

# Docker (run from project root)
docker compose up -d                               # start postgres
docker compose down                                # stop
```

⚠️  AFTER EVERY MIGRATION — run these two commands in order:
```bash
npx prisma generate --schema src/prisma/schema.prisma
npm run typecheck
```
Never skip prisma generate. The Prisma DLL (generated client) is
compiled from the schema. If a migration adds columns and generate
is not run, the old DLL throws PrismaClientValidationError on any
query using the new fields — requests hang permanently in Express 4
(no async error propagation without asyncHandler wrapper).

## Dev Checklist — Standing Rules

After ANY backend code change during development:
- Kill the server (Ctrl+C)
- Restart: `npm run dev`

Never rely on hot-reload for Prisma client or middleware changes.
Hot reload (tsx watch) does NOT re-initialize the Prisma client
instance — only a full process restart does.

| When | Rule |
|---|---|
| After `prisma migrate` | Run `prisma generate` + `npm run typecheck`, then restart server |
| After any code change | Kill server (Ctrl+C) → `npm run dev` |
| After `prisma generate` | Restart server — old DLL stays in memory until process exits |
| Before committing | `npm run typecheck` on both backend and frontend |
| Before packaging | `npm run build:win` (or `npm run build`) — never `npm run electron`, which does NOT compile |
| New session | Read CLAUDE.md sections 7 + 13 before writing any code |

---

## 9. What to Build Next

### ✅ Done: PDF Export (Module #12)

`frontend/src/services/pdfExport.ts` — three exports:
- `exportSaleInvoice(sale)` → `INV-YYYY-NNNN.pdf`
- `exportPurchaseOrder(po)` → `PO-YYYY-NNNN.pdf`
- `exportSaleReturn(ret)` → `CRN-YYYY-NNNN.pdf`

"Download PDF" button added to Invoice detail modal, PO detail modal, and Return detail modal.

---

### ✅ Done: Reports Module (#13)

`backend/src/modules/reports/` — service, controller, routes (6 endpoints):
- `GET /reports/sales` — revenue by period, by warehouse, by payment method
- `GET /reports/purchases` — spend by supplier, by period
- `GET /reports/products` — top by revenue + top by qty (with COGS & margin)
- `GET /reports/customers` — top customers by total spend
- `GET /reports/inventory` — valuation, low stock count, optional warehouse filter
- `GET /reports/profit-loss` — gross revenue, COGS, gross profit by period

`frontend/src/pages/reports/ReportsPage.tsx` — full analytics page:
- Sidebar nav with 6 color-coded report links
- `DateRangePicker` with preset pills (30d / 90d / YTD / Custom)
- Pure CSS `BarChart` + `HBar` components (no chart library)
- PDF export on every tab via jsPDF + autoTable
- Inventory tab: warehouse filter dropdown + search + low-stock toggle

`frontend/src/services/reports.ts` — all types + `reportsApi` object

---

### ✅ Done: Products Page (Module #14)

`backend/src/modules/products/` — schema, service, controller, routes:
- `GET/POST /products` — list with search/filter + create
- `PATCH /products/:id` — update
- `PATCH /products/:id/toggle-active` — deactivate/reactivate
- `GET /products/meta` — categories, brands, units for dropdowns

`frontend/src/pages/products/ProductsPage.tsx`:
- Table with avatar, SKU, category/brand badges, cost/price/margin columns, stock pill
- Detail side-drawer showing stock by warehouse
- Create/Edit modal with margin preview
- Search + category + brand + active/all/inactive filter pills

### ✅ Done: Dashboard v2 (Module #15)

Added to `dashboard.service.ts`: `unpaidCents`, `monthPurchasesCents`, `inventoryValueCents`

`DashboardPage.tsx` redesigned:
- Gradient indigo hero card for today's revenue
- Outstanding receivables KPI (links to sales)
- Inventory value KPI
- Month purchases KPI
- Quick Actions bar (POS, Invoice, Purchase, Reports)
- Renamed user greeting (first name)
- Count pills → full 4-column grid with arrow icons

### ✅ Done: POS v2 (Module #16)

`frontend/src/pages/pos/POSPage.tsx` enhanced:
- **Customer selector**: Walk-in or search existing customers by name/phone
- **Keyboard shortcuts**:
  - `F1–F5` — select payment method (Cash/Card/Bank/Wallet/Other)
  - `/` — focus search bar
  - `Enter` — checkout
  - `Del` — clear cart
  - Receipt: `Enter`=Print, `Shift+Enter`=New Sale, `Esc`=Close/Quit
- **Professional receipt**: business name/address header, customer section, item table, totals
- **Quit button**: closes receipt modal without clearing cart
- **Shortcut strip**: visible hints at bottom of product area
- **Help modal**: `?` (keyboard icon) shows all shortcuts

---

### ✅ Done: POS v3 + Settings (Module #17)

**Schema changes** (migration: `20260509000001_add_pos_drafts_credit_expiry`):
- `PaymentMethod` enum: added `CREDIT`
- `Product`: added `expiryDate DateTime?`, `expiryAlertDays Int @default(30)`
- `Customer`: added `creditEnabled`, `creditLimitCents`, `creditAlertPct`, `creditSettleDays`
- New models: `PosDraft`, `PosDraftItem`

**Backend** (`backend/src/modules/`):
- `pos/`: draft CRUD (listDrafts, saveDraft, deleteDraft), getCustomerCredit, credit limit enforcement in checkout, price-adjust gate
- `master-data/`: full CRUD for categories, brands, units (requires `manage_settings` permission)
- `config/permissions.ts`: 4 new permissions — `adjust_sale_price`, `sell_on_credit`, `manage_credit`, `manage_settings`

**Frontend** (`frontend/src/`):
- `store/authStore.ts`: added `permissions: string[]` to User interface
- `services/pos.ts`: draft types + API methods, `CustomerCreditInfo`, `daysUntilExpiry()` helper
- `services/masterData.ts`: categories/brands/units API
- `services/contacts.ts`: credit fields on Customer + CustomerBody
- `pages/pos/POSPage.tsx`: DraftPanel, HoldModal, CreditBanner, per-item price editing (role-gated), CREDIT payment (role-gated), keyboard H/L/F6
- `pages/contacts/ContactsPage.tsx`: credit section in customer modal, credit badge in table
- `pages/products/ProductsPage.tsx`: expiry date + alert days in form, expiry badges in table
- `pages/settings/SettingsPage.tsx`: new page — 3-column CRUD for categories, brands, units

**⚠️ Before testing**: Run the migration:
```bash
cd backend
npx prisma migrate deploy --schema src/prisma/schema.prisma
npx prisma generate --schema src/prisma/schema.prisma
```

---

### ✅ Done: Unit Conversion Module (#18)

**Schema changes** (migration: `20260512_add_unit_conversion`):
- `UnitType` enum: COUNT / WEIGHT / VOLUME / LENGTH / OTHER
- `Unit`: added `type`, `isActive`, new named relations for base/purchase/sales/conversions
- `Product`: added `baseUnitId?`, `purchaseUnitId?`, `salesUnitId?`, `unitConversions`
- `PurchaseLine`: added `unitId?`, `baseQty?`
- `SaleLine`: added `unitId?`, `baseQty?`
- New model: `ProductUnitConversion` (productId, fromUnitId, toUnitId, conversionQty, priceCents?, barcode?)

**Backend** (`backend/src/`):
- `modules/units/`: full CRUD for the new-style units (type, isActive, shortCode) — `GET/POST/PATCH/DELETE /api/v1/units`
- `utils/unit-converter.ts`: `convertToBaseUnit`, `convertFromBaseUnit`, `getUnitPrice` — supports multi-level chains
- `modules/products/product-conversions.service.ts`: `setConversions` + `getConversions` via `PUT/GET /products/:id/conversions`
- `modules/pos/pos.service.ts`: checkout converts sale units to base units before deducting stock
- `modules/purchases/purchases.service.ts`: confirmPurchase converts purchase units to base units when adding stock
- `modules/inventory/inventory.service.ts`: `getStockByUnits(productId)` — new `GET /inventory/stock/:productId/units`
- `modules/purchases/purchases.service.ts`: `listProducts` now returns `baseUnit`, `purchaseUnit`, `unitConversions`

**Frontend** (`frontend/src/`):
- `services/units.ts`: Unit types, `unitsApi` (list, listAll, create, update, softDelete, getConversions, setConversions)
- `pages/units/UnitsPage.tsx`: full CRUD table — name, shortCode, type badge, decimal toggle, product count, active toggle
- `pages/products/ProductsPage.tsx`: added Unit Roles section (Base/Purchase/Sales dropdowns) + Unit Conversions dynamic table with live preview; conversions saved atomically on product save
- `pages/pos/POSPage.tsx`: per-cart-item unit selector dropdown; price auto-updates to unit price; base-unit deduction hint shown
- `pages/purchases/PurchasesPage.tsx`: unit column in line items with conversion preview ("→ 24 pcs added to stock")
- `components/layout/AppShell.tsx`: Units nav item added (Ruler icon)
- `App.tsx`: `/units` route added

**Tests**: `backend/tests/unit-conversion.test.ts` — 15 passing tests covering single-level, multi-level, error cases, stock deduction logic, duplicate validation

**⚠️ Before testing**: Migration already applied. Run seed to get demo conversions:
```bash
cd backend
npm run seed
```

---

### ✅ Done: Sprint 18 — Purchasing Power-Ups

**Task 1 — Supplier Payments (rich modal):**
- `SupplierPayment` model: paymentNumber, method, referenceNo, bankName, paymentDate
- `POST /purchases/:id/payments`, `GET /purchases/:id/payments`
- Full payment history modal with method badges, totals, delete

**Task 2 — Import Products page:**
- `ImportPage` wired into `App.tsx` + AppShell nav (ADMIN only, Upload icon)
- Route: `/settings/import`

**Task 3 — Partial Delivery / GRN Receipts:**
- Schema: `PurchaseReceipt`, `PurchaseReceiptLine`, `DeliveryStatus` enum, `receivedQty` on PurchaseLine
- `purchase-receipt.service.ts` + controller: create, list, getById (GRN-YYYY-NNNN numbering)
- `confirmPurchase` auto-creates a GRN document (non-fatal try/catch)
- `ReceiveStockSection` in PurchasesPage: per-line qty + batch/expiry inputs, delivery status badge

**Task 4 — Expiry Entry per batch-tracked product:**
- `isBatchTracked` on Product; per-line batch/expiry columns only when product is batch-tracked
- `BATCH` chip, yellow warning for missing batch number

**Task 5 — Auto-PO from Low Stock Alerts:**
- `defaultSupplierId` on Product, `sourceType` on Purchase
- `POST /purchases/from-alerts` creates DRAFT PO from selected alert items
- AlertsPage: checkboxes on LOW_STOCK cards, select-all toggle, action bar, Generate PO modal
- PurchasesPage list: purple "Auto PO" badge when `sourceType === 'AUTO_PO'`

### 🔲 Next: (Choose Phase 3 sprint)

Options:
  A - Reports upgrade (better dashboard, trends, custom ranges)
  B - HR & Payroll (employees, attendance, salaries)
  C - CRM (customer profiles, loyalty, purchase history)
  D - Multi-warehouse (transfers, per-location POS)
  E - Accounting (chart of accounts, journals, balance sheet)

---

## 10. Session Checklist

Before writing any code in a new session:
- [ ] Read this file (CLAUDE.md) fully
- [ ] Check which module is marked 🔲 Next
- [ ] Read relevant existing service/page files before editing them
- [ ] Run migrations if schema was changed in a previous session

After completing a module:
- [ ] Update the module table in Section 2 (change 🔲 to ✅)
- [ ] Update Section 9 "What to Build Next"
- [ ] Commit the working code

---

## 11. Functional Test Checklist

### POS
- [ ] Cash/Card/Bank/QR/Credit payments complete without error
- [ ] Hold bill → Drafts list → resume → complete payment
- [ ] Void & New clears cart immediately
- [ ] Enter on empty barcode → Discount focused
- [ ] Enter on Discount → Total focused
- [ ] Enter on Total → Payment dialog opens
- [ ] Arrow keys move between payment tabs
- [ ] Enter on tab → Amount field focused
- [ ] Enter on Amount → Confirm Payment fires
- [ ] Ctrl+Shift+X (Admin) → exits POS
- [ ] Shift time updates correctly after new shift opens

### Inventory
- [ ] After POS sale: stock decreases correctly
- [ ] After Purchase GRN: stock increases correctly

## 12. Known Issues Log

| # | Issue | File | Priority | Status |
|---|-------|------|----------|--------|
| 1 | Del key not clearing cart | POSPage.tsx | HIGH | Resolved |
| 2 | Shift time not updating after new shift | posStore | HIGH | Resolved |
| 3 | 3 pre-existing TypeScript errors | ContactsPage/UsersPage/api.ts | LOW | Resolved |
| 4 | Dev DB carries 21 v2 tables + 5 columns not in this branch | shared dev `modernerp` DB | INFO | Accepted (Option a) — leave alone |
| 5 | Receipt/label print silently skipped in Electron — `win.close()` raced `win.print()` | printWindow.ts / POSPage / BarcodeLabelsPage | HIGH | Resolved 2026-08-18 |
| 6 | Invoice numbers derived from row count — skip, and collide after a delete | sales.service / pos.service | HIGH | Resolved 2026-08-18 |
| 7 | `npm run build` packaged a stale dist — shipped fixes were invisible | package.json | HIGH | Resolved 2026-08-18 |
| 8 | Eight other doc-number generators still count rows (PO/CRN/GRN/SPAY/quotation/stocktake/purchase-return/write-off) | see §12.2 | MEDIUM | Open |

### 12.2 ⚠️ Two traps that cost a full debugging session (2026-08-18)

**1. A "rebuild" that rebuilds nothing.** The Electron app loads
`frontend/dist/index.html` and `backend/dist/server.js` from disk. npm pre-hooks
match the script name EXACTLY, so the old `prebuild:win` fired only for
`build:win` — `npm run build` packaged whatever dist was lying around. A July
bundle was still shipping in August: fixes were written, committed, "rebuilt",
and the packaged app carried none of them, with no error to say so. Both paths
now delegate to `npm run compile`. **If a fix does not appear, grep the built
bundle for a string only the new code contains before debugging anything else.**

**2. `window.print()` is modal in a browser, async in Electron.** Any
`win.print(); win.close();` pair works in dev at :5173 and silently loses the job
in the packaged app. Print documents must close themselves on `afterprint` —
use `autoPrintScript()` from `frontend/src/utils/printWindow.ts`. Never call
`print()`/`close()` on a popup from the opener.

### 12.1 ⚠️ Dev Database Drift — DO NOT run `migrate dev` (verified 2026-07-09)

**What:** The shared dev DB `modernerp` physically contains 21 tables + 5 real-table
columns that `electron-v1.0`'s migration history does NOT create:
- Tables: BOM, BOMLine, CustomerInteraction, Delivery, LoyaltyConfig,
  LoyaltyTransaction, PriceTier, ProductPrice, ProductionOrder, ProductionOrderLine,
  Quotation, QuotationLine, attendance, client_config, leave, salary, staff, tenants,
  whatsapp_config, whatsapp_log, whatsapp_template
- Columns: Customer.loyaltyPoints, Customer.priceTierId, Sale.pointsEarned,
  Sale.pointsRedeemed, User.tenantId

**Origin (NOT contamination):** legitimate `main`/`dev` v2 migrations (HR/CRM/tenant/
whatsapp/quotation/manufacturing, dated 2026-06-02/03) applied to this *shared* dev DB,
then work resumed on `electron-v1.0` (forked 2026-06-01, before those migrations).
All 8 are recorded in `_prisma_migrations`. It is a branch-vs-shared-DB mismatch.

**Risk:** HARMLESS today. `migrate deploy` and `migrate status` ignore it (status shows
"up to date"). **DANGER:** `prisma migrate dev` would see 8 applied-but-fileless
migrations → prompt a FULL-DB RESET (drops ALL real data). The 21 DROP statements seen
earlier came from `migrate diff` (a report), NOT from what `migrate dev` executes.

**ACM production: UNAFFECTED.** ACM deploys `electron-v1.0` files via `migrate deploy`;
those files contain none of the v2 migrations. Drift is isolated to this dev box only.

**RULE:** On any shared/prod-like DB use ONLY `migrate deploy`. NEVER `migrate dev`.
For a clean dev DB, build a *separate throwaway* database from files — never mutate this one.

## 13. Sprint State

**Phase 1: COMPLETE ✓** (2026-05-17)
**Phase 2: COMPLETE ✓** (2026-05-19)
**Phase 3 Sprint 12: POS Shifts ✓** (2026-05-20)
**Phase 3 Sprint 13: Settings Module ✓** (2026-05-20)
**Phase 3 Sprint 14: Warehouse Management ✓** (2026-05-20)
**Phase 3 Sprint 15: Receipt Printing ✓** (2026-05-22)
**Phase 3 Sprint 16: Stock Alerts ✓** (2026-05-22)
**Phase 3 Sprint 17: FEFO + Write-off + Stock Overview ✓** (2026-05-24)
**Phase 3 Sprint 18: Purchasing Power-Ups ✓** (2026-05-25)
**Phase 3 Sprint 19: Attachments, Customer Payments, Purchase Returns, P&L Compare, Dashboard Live Data ✓** (2026-05-25)
**Phase 3 Sprint 20: Negative Stock (sell past zero) ✓** (2026-08-21)

Phase 2 sprints completed:
- Sprint 5: User Management ✓
- Sprint 6: Batch Expiry System ✓
- Sprint 7: Returns UI ✓
- Sprint 8: Barcode Labels ✓
- Sprint 9: Expenses (categories, recurring, budget, CSV, P&L) ✓

Phase 3 sprints completed:
- Sprint 12: POS Shifts (open/close shift, per-method breakdown, variance, ShiftsPage, force-close) ✓
- Sprint 13: Settings Module (AppSettings DB, CRUD API, full SettingsPage, SettingsContext, permissions matrix) ✓
- Sprint 14: Warehouse Management (schema migration, full CRUD API, WarehousesPage with cards/detail/form, default auto-select in POS) ✓
- Sprint 15: Receipt Printing (ThermalReceipt, EN/SI language, 58/80mm paper, print window, generateReceiptHtml, receipt settings) ✓
- Sprint 16: Stock Alerts (alert bell, AlertsPage, low stock + expiry alerts, mark read, dismiss, alert settings, dashboard widget) ✓
- Sprint 17: FEFO + Write-off (FEFO batch deduction in POS checkout, WRITE_OFF enum + batchId on StockMovement, blockExpiredSales setting, /inventory/write-off endpoint, WriteOffModal in ProductDetailPanel + inline write-off in StockRow, KPI tiles on Stock Overview) ✓
- Sprint 17b: expiredStockPolicy 3-option radio (BLOCK/WARN/ALLOW) replacing boolean blockExpiredSales toggle; Settings UI 3-option radio; POS card policy-aware badge/confirm dialog; checkout warnings in response) ✓
- Sprint 18: Barcode System (BarcodeInput shared component, GET /products/by-barcode/:barcode endpoint, barcode inline duplicate check + search-Enter in Products page, POS unknown barcode → API fallback → QuickAddModal, Purchases scan-to-add-line, Inventory Adjust + Transfer scan-to-select; all type=text, loading states, focus management) ✓
- Sprint 18: Purchasing Power-Ups (Supplier Payments rich modal, Product Import page wired up, Partial Delivery / GRN receipts with batch+expiry per line, Auto-PO from Low Stock Alerts with Generate PO modal) ✓

**Current: Phase 3 continuing**
**Next sprint: Choose from:**
  A - Reports upgrade (better dashboard, trends, custom ranges)
  B - HR & Payroll (employees, attendance, salaries)
  C - CRM (customer profiles, loyalty, purchase history)
  D - Multi-warehouse (transfers, per-location POS)
  E - Accounting (chart of accounts, journals, balance sheet)

**Known open issues (minor):**
- Expense add with non-Rent categories: test after bug fix
- P&L report shows expenses section (verify in browser)
- 3 pre-existing backend TS errors in auth.service + users.service

**Tech stack:** React 18 + Vite + TypeScript + Tailwind
  Node.js + Express + Prisma + PostgreSQL
  Backend: localhost:4000 | Frontend: localhost:5173
