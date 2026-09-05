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
| **Live** | **https://modernerp-demo.vercel.app** (project `sajithfaiz1999-1725/modernerp-demo`) |
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
a Rs. 4,950 cash sale took socket outlets 74 → 71 and hammers 23 → 21, wrote a
`SALE_OUT` movement for each line, and moved the dashboard's "today" tile from
Rs. 225.6K/8 orders to Rs. 230.6K/9.

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

**Sales and billing — the flow the client cares about most, verified click by
click in the browser:** raise a manual invoice (customer, warehouse, product
search or barcode) → confirm, which deducts stock and writes the `SALE_OUT`
movement → record a full or part payment → the list shows PARTIAL with the
balance → open the detail, which carries the lines and the payment history →
Download PDF → Process Return, capped per line at what is still returnable, and
the credit note puts the stock back.

Proved on `INV-2026-0656`: Rs. 26,500 for Silva Construction, stock 180 → 170 on
confirm, Rs. 10,000 part payment leaving Rs. 16,500 outstanding, then
`CRN-2026-0001` for 3 bags taking stock back to 173.

**Also working:** dashboard · POS (search, barcode, unit conversion, batch
picking, credit limits, hold bills, checkout, receipt) · products · stock
overview with batches and expiry · stock alerts · purchases, partial GRN
receipts and debit notes · suppliers and supplier payments · customers and
credit · expenses · POS shifts · users and permissions · warehouses ·
categories, brands and units · the sales, inventory, products, customers,
purchases, ageing and P&L reports.

**Also walked click by click:** warehouses (list, detail, stats), users (create,
deactivate, permissions), stock adjustments, warehouse transfers, batch write-off
with its automatic loss expense, barcode labels, product import, and document
attachments.

**Deliberately off** — the optional modules are switched off in the seeded
`moduleFlags`, so their nav entries are hidden rather than left as dead links:
promotions, stock-take, loyalty, quotations, WhatsApp, data management, audit
trail, product export.

> **Out-of-scope is a claim about the NAV, not a convenience.** `/import` was on
> that list and should not have been: Import Products sits in the ADMIN nav with
> no module flag, so a visitor reaches it and can upload a file — which would
> have answered a client's own product list with "not included in the demo".
> Attachments were listed too, and `AttachmentPanel` is mounted on every
> purchase order, where it rendered a red "Could not load attachments." Both are
> implemented now. Before adding anything to `OUT_OF_SCOPE`, check `AppShell`:
> an entry is only unreachable if a module flag or a role gate actually hides it.

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

Four things must never happen. None of them rely on being remembered.

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

### Every endpoint must be registered on the method the app actually calls

`npm run verify:demo` runs `scripts/check-demo-routes.mjs` first. It walks the
source for `api.<verb>(...)` call sites and compares them with the route table.

This was added after the route table was found to have `confirm`, `cancel` and
`pay` registered as **POST** when `salesApi` calls them with **PATCH** — so
confirming an invoice and taking a payment both 404'd, while every page still
loaded perfectly. A page load only issues GETs, which is exactly why clicking
through the nav had not caught it. `updateSale`, `deleteSale`,
`recordPaymentNew`, the whole purchase-returns module and several others had no
handler at all. 24 verb mismatches and 20 in-scope gaps, all closed.

Endpoints belonging to the switched-off modules are listed in `OUT_OF_SCOPE` in
that script, with the reason. Anything not on that list is a real gap and fails.

### A matching method is not a matching SHAPE

The route check proves an endpoint exists on the right verb. It cannot prove the
RESPONSE is shaped the way the screen reads it — and a wrong shape fails at
render, *after* the write has already landed, which is the worst place for it.
Three were found by walking the pages:

- `POST /customer-payments/lump-sum` returned `{ applied, unappliedCents }`;
  the modal maps `result.allocations` and reads `appliedCents` /
  `creditAddedCents`. The money moved correctly and the screen went blank.
- `GET /expenses/summary` takes `{ year, month }`, not `{ from, to }`. Reading
  from/to matched nothing, so every expense fell inside the window: the page
  showed the whole year as "This Month" and Rs. 0.00 as "Last Month".
- The `Expense` entity uses `amount`, not `amountCents` — the one place in the
  app that breaks the `…Cents` convention. Emitting `amountCents` blanked the
  money column, and reading it on create rejected every expense.

The lesson is the same each time: read the declared type, do not infer it from
the neighbours. `demo.test.ts` now asserts the exact fields each modal
destructures, because TypeScript cannot check a shape the demo invents at
runtime.

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

### The deployment, as it stands

Client-facing: **https://modernerp-demo.vercel.app**
Also public: `https://frontend-mu-khaki-19.vercel.app` (the domain the project
was first created with; kept because it works, harmless to leave).

⚠️ **Not every Vercel URL for this project is public.** Vercel's default
Standard Protection puts an SSO login wall in front of *deployment* URLs —
`modernerp-demo-hfrskbifz-….vercel.app` and anything aliased directly to a
deployment both redirect to `vercel.com/login`. Only a domain attached to the
PROJECT is public. `modernerp-demo.vercel.app` is public because it was added
with `vercel domains add <domain> <project>`, not with `vercel alias set`.

That distinction is easy to miss, because a protected URL still ends in a 200 —
just on Vercel's sign-in page. When checking a URL, confirm it SERVES the demo
(grep the HTML for the business name, or the bundle for `__MODERNERP_DEMO__`),
never just that it responds.

Verified against the LIVE site, not a local copy — the served bundle carries
`__MODERNERP_DEMO__`, the demo credentials and the fictional catalogue, and
carries neither production seed credential. Headers confirmed on the wire:
`X-Robots-Tag: noindex, nofollow`, `nosniff`, `strict-origin-when-cross-origin`,
`max-age=0, must-revalidate` on the HTML and `immutable` on hashed assets.
`robots.txt` serves `Disallow: /`. Signed in, the dashboard renders and
attachments upload — no console errors.

Three things to know about this deployment:

1. **Renamed** to `modernerp-demo` (`vercel project rename`). Note that a
   rename does NOT rename the existing auto-generated domain — the project
   domain had to be added separately, as above.
2. **GitHub is not connected** — the CLI reported *"You need to add a Login
   Connection to your GitHub account first (400)"*. Nothing is broken by it;
   it only means no automatic redeploy on push. Re-run the deploy command to
   publish an update, or connect GitHub in Vercel's account settings.
3. **`vercel.json` is load-bearing.** Vercel auto-detected Vite and would have
   run `vite build` into `dist/` — the PRODUCTION bundle, with the demo layer
   stripped out and no backend to talk to. The config's explicit
   `buildCommand`/`outputDirectory` is what makes the deploy build `dist-demo`.
   Do not remove it.

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
