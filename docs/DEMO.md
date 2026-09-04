# The client demo — frontend only, no backend

A hosted build of the ERP that a prospective client can click through in a
browser. There is no server, no database and no network call: the whole thing
runs in the visitor's tab.

Built for **Mr. Akeel, Gampola** — a hardware and building-supplies trade — on
branch `demo/client-preview`, cut from `electron-v1.0` at `c607d83` (v1.1.8).

---

## 1. What it is

| | |
|---|---|
| Branch | `demo/client-preview` (never merge into `electron-v1.0` without re-reading §5) |
| Build | `npm run build:demo` → `frontend/dist-demo/` |
| Host | Vercel, static. No cold start, no server cost. |
| Data | Fictional. Generated in `src/demo/catalogue.ts`. |
| Persistence | `localStorage`, per visitor, per browser. Nothing leaves the device. |

### Sign-in accounts

Shown on the login screen as one-tap buttons, so nobody has to be told a
password over the phone.

| Account | Email | Password | What it shows |
|---|---|---|---|
| Owner / Admin | `demo@akeel-hardware.lk` | `Demo@2026` | Everything — all modules, all reports |
| Counter staff | `cashier@akeel-hardware.lk` | `Counter@2026` | Till only. `CashierGuard` locks this role to `/pos`; sign out from the POS header to switch back. |

These are **demo-only and fictional**. The production seed credentials
(`modernerp@gmail.com` / `superadmin123`, `backend/src/prisma/seed.ts`) appear
nowhere in this build — see §5.

Neither account is `SUPER_ADMIN`. That role bypasses every module and role gate
in `AppShell.isVisible`, which would put vendor-only tooling in front of a
client.

---

## 2. How it works

Every API call in the app goes through the single axios instance in
`src/services/api.ts`. Swapping that instance's **adapter** therefore intercepts
100% of API traffic:

```
services/api.ts
  └── if (import.meta.env.VITE_DEMO_MODE === 'true')
        installDemoAdapter(api)          src/demo/install.ts
          └── demoAdapter                src/demo/adapter.ts
                ├── ROUTES               src/demo/handlers/index.ts
                │     └── core / catalog / selling / buying / analytics
                ├── getDb()              src/demo/db.ts     (seed + localStorage)
                └── catalogue            src/demo/catalogue.ts
```

**Why an adapter and not MSW.** MSW needs a service worker registered from
`public/mockServiceWorker.js`, which is one more thing for a static host to
serve correctly and one more thing to fail silently. The adapter is plain
JavaScript on an instance the whole app already shares, and it was verified that
nothing bypasses it: the only other network calls in the codebase are
logo/attachment `fetch()`s, all already wrapped in `try/catch` returning `null`.

The adapter rejects with a real `AxiosError` carrying a `response.status`, which
matters — POS, Products, Sales, Purchases and Inventory all branch on
`err.response?.status === 404` to offer "add this product".

### Writes are real

A sale rung up on the till deducts stock, records `SALE_OUT` movements, issues
the next `INV-YYYY-NNNN` from **max+1** (never a row count — CLAUDE.md sprint
21), and moves the dashboard and every report. Verified end to end at 375×812:
`INV-2026-0656`, Rs. 4,950 cash, socket outlets 74 → 71 and hammers 23 → 21.

### Dates

Seed history is built with local `new Date(y, m, d, hh, mm)` constructors, never
a date-only string. Per CLAUDE.md issues 19–22 a date-only string parses as UTC
midnight, which in Colombo reads back as 05:30 the next morning. Range filters
in the handlers compare `YYYY-MM-DD` strings from `toLocalYMD`, never
`toISOString().slice(0, 10)`.

### The demo re-seeds on a new day

All history is generated relative to the day it was seeded. A copy left in a
browser overnight would have no sales "today", so a visitor opening the link a
week later would meet a dashboard reading Rs. 0 and −100%. `getDb()` therefore
re-seeds when the stored copy's local calendar day is not today. Mid-session
nothing is touched — the check is by day, not by age.

Today's sales are also generated only up to the current clock, and in the small
hours the window becomes the couple of hours behind now, so the shop is never
empty whatever time the link is opened.

---

## 3. What is included

Scoped to the flows a demo actually walks through, not all ~150 endpoints.

**Working:** login · dashboard · POS (search, barcode, unit conversion, batch
picking, credit limits, hold bills, checkout, receipt) · products · stock
overview with batches and expiry · stock alerts · sales invoices and payments ·
sale returns · purchases and GRN · suppliers and supplier payments · customers
and credit · expenses · POS shifts · users and permissions · warehouses ·
categories, brands and units · the sales, inventory, products, customers,
purchases, ageing and P&L reports.

**Deliberately off** — the optional modules are switched off in the seeded
`moduleFlags`, so their nav entries are hidden rather than left as dead links:
promotions, stock-take, loyalty, quotations, WhatsApp, data management, audit
trail, product export.

Any endpoint with no handler returns a 404 and logs
`[demo] no handler for METHOD /path` to the console. Every page reachable from
the demo's nav was swept and none appear.

---

## 4. Mobile

The app was built for a desktop Electron window: of 33 page components, all but
two carried no responsive classes. Three changes make it usable on a phone.

1. **`AppShell`** — below `lg` the sidebar becomes an off-canvas drawer with a
   top bar, backdrop, and close-on-navigate. The desktop collapse preference no
   longer strips labels out of the drawer.
2. **`src/styles/responsive.css`** — one rescue layer for the structural
   problems: page-level horizontal overflow, fixed multi-column grids, tables
   that need to scroll inside their own box, 40px touch targets, and the 16px
   input rule that stops iOS zooming on focus and never zooming back.
3. **`POSPage`** — below `lg` the resizable split collapses to the products
   pane, and the cart becomes a full-screen sheet reached from a basket bar
   showing count and total. The cart's product-name column is pinned so it stays
   readable while the rest of the row scrolls.

**Every rule is behind a `lg:` prefix or `@media (max-width: 1023.98px)`.**
Verified at 1440×900: the rail is `position: static`, 240px, untransformed; the
mobile top bar is `display: none`; `main` has `padding-top: 0`; `body` has
`overflow-x: visible`. Desktop and Electron render exactly as before.

---

## 5. The safety rules, and how they are enforced

Three things must never happen. None of them rely on being remembered.

### The production build must not contain the demo

`npm run verify:demo` greps both bundles and fails the build otherwise. This is
CLAUDE.md §12.2 applied — and it earned its keep immediately: the first
production build **did** contain `demo@akeel-hardware.lk`, `modernerp-demo-db`
and the whole fictional catalogue. The guarded branches were eliminated, but
Rollup keeps an imported module whose exports are all unused when no
`sideEffects` field says otherwise.

Rather than trust that heuristic with demo credentials and invented trading
figures, `vite.config.ts` now severs the import: outside `--mode demo`, any
relative import into `src/demo/` resolves to an inert stub and the real files
never enter the graph. `dist/` is now ~103 KB smaller and carries none of it.

```bash
npm run build            # normal build → dist/
npm run build:demo       # demo build   → dist-demo/
npm run verify:demo      # asserts the separation
```

### The demo must build to `dist-demo/`, never `dist/`

The Electron app packages `frontend/dist/`. A demo build landing there would
ship fictional data and demo credentials to a real client, with nothing to say
so — the same class of failure as CLAUDE.md §12.2's stale-dist trap.

### `src/demo` must not import from `src/services`

`services/api.ts` imports the demo installer, so any import back the other way
closes a cycle. This is not theoretical: importing `ALL_PERMISSIONS` from
`services/users.ts` threw `Cannot access 'ALL_PERMISSIONS' before
initialization` at module-evaluation time and took every page down. The
permission list is restated in `src/demo/permissions.ts` instead, and
`verify:demo` fails if the rule is broken again.

### No real data, ever

Every product, customer, supplier, phone number and figure is invented in
`src/demo/catalogue.ts`. No ACM data was read, copied or derived from. The
repo's `demo_data.sql` was not used. Brand and supplier names are composites
that do not correspond to real companies.

---

## 6. Deploying

The demo is static and uses `HashRouter`, so every route is `/#/...` and the
host only ever serves `/` — **no SPA rewrite rules are needed**. `base: './'`
makes the asset paths relative, so it works from any path.

```bash
cd frontend
npm run build:demo
npm run verify:demo      # do not deploy if this fails
npx vercel deploy --prod
```

`frontend/vercel.json` sets the build command, the output directory, long cache
lives for hashed assets, and `X-Robots-Tag: noindex` — the demo carries a named
prospect's branding and should not turn up in a search for their business.
`public/robots.txt` says the same for crawlers that read it first.

To preview the real bundle locally before deploying:

```bash
cd frontend
npm run preview:demo     # http://localhost:4173
```

---

## 7. If you need to change the demo data

`src/demo/catalogue.ts` holds the products, categories, brands, warehouses,
suppliers, customers and expense categories. `src/demo/db.ts` turns those into
75 days of trading history — sales, purchases, expenses, shifts, stock batches.

After changing the **shape** of anything in `db.ts`, bump `DEMO_DB_VERSION` in
`src/demo/config.ts`. Visitors carrying an older shape in `localStorage` are
re-seeded rather than merged into, which avoids a half-migrated store.

The generator is seeded (`mulberry32(20260904)`), so the shop looks identical to
every visitor until they touch it — a screenshot taken today matches what the
client sees.
