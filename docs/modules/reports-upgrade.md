# Sprint 11 — Reports Upgrade

**Status:** Spec (not yet built)  
**Phase:** Phase 3  
**Depends on:** Reports module (#13), Expenses module (Sprint 9), Dashboard v2 (#15)

---

## Context — What Already Exists

Before listing what to build, here is the baseline each section upgrades from:

| Area | Current state |
|---|---|
| `GET /reports/sales` | Returns `summary`, `byPeriod` (day/week/month), `byWarehouse`, `byPayment`. No top-products slice, no CSV endpoint. |
| `GET /reports/inventory` | Returns `items[]` with `costValueCents`, `isLowStock`; `totals` with aggregate counts. No slow-mover query. |
| `GET /reports/profit-loss` | Returns `summary`, `expensesByCategory`, `byPeriod` (monthly gross profit). No gross-margin column per period row. |
| Dashboard `revenueChart()` | Hard-coded `NOW() - INTERVAL '14 days'`. No toggle, no expense overlay. |

Nothing is deleted or rewritten — every change is additive.

---

## 1. Sales Report Upgrade

### 1.1 Backend changes — `reports.service.ts` → `salesReport()`

**Add `topProducts` query (new parallel query inside the same `Promise.all`):**

```sql
SELECT p.id AS "productId", p.name, p.sku,
  SUM(sl."lineTotalCents")::bigint  AS revenue,
  SUM(sl.qty)::float                AS qtySold,
  COALESCE(SUM(sl.qty * p."costCents"), 0)::bigint AS cogs
FROM "SaleLine" sl
JOIN "Product"  p ON p.id = sl."productId"
JOIN "Sale"     s ON s.id = sl."saleId"
WHERE s.status = 'CONFIRMED'
  AND s."deletedAt" IS NULL
  AND s.date >= $from AND s.date <= $to
GROUP BY p.id, p.name, p.sku
ORDER BY revenue DESC
LIMIT 10
```

Return shape added to `salesReport` response:
```typescript
topProducts: {
  productId:       string;
  name:            string;
  sku:             string;
  revenueCents:    number;
  qtySold:         number;
  cogsCents:       number;
  grossProfitCents:number;
  marginPct:       number;   // (revenue - cogs) / revenue * 100, 1dp
}[]
```

**No schema migration needed.** No new endpoint needed — the extra field is added to the existing `GET /reports/sales` response.

---

**Add CSV export endpoint:**

```
GET /reports/sales/csv?from=&to=&groupBy=day|week|month
```

Returns `Content-Type: text/csv` with `Content-Disposition: attachment; filename="sales-report-YYYY-MM-DD.csv"`.

CSV columns:
```
Period, Revenue (Rs.), Orders, Avg Order (Rs.)
```
One row per period bucket. Simple — reuses the same `byPeriodRaw` query already executed.

Controller: `salesCsv` handler in `reports.controller.ts`.  
Route: `router.get('/sales/csv', ctrl.salesCsv)` — registered before the existing `/sales` route.

---

### 1.2 Frontend changes — `ReportsPage.tsx` → `SalesTab`

**New: `TopProductsTable` component** (inside `ReportsPage.tsx` or extracted to `components/reports/TopProductsTable.tsx`)

Renders a sortable table below the payment-method breakdown:

| # | Product | SKU | Qty Sold | Revenue | COGS | Gross Profit | Margin % |
|---|---|---|---|---|---|---|---|

- Default sort: Revenue desc
- Click column header to re-sort client-side (no extra API call)
- Margin % cell uses colour coding: ≥ 30% green, 10–29% yellow, < 10% red

**New: `ExportCsvButton`** — small button next to "Export PDF":
- Calls `GET /reports/sales/csv` with current `from`/`to`/`groupBy` params
- Uses `window.open(url)` or `<a download>` pattern — no new service method needed beyond the URL builder

**Update `services/reports.ts`:**
- Add `topProducts` array to `SalesReportData` interface
- Add `reportsApi.salesCsv(params)` → returns `Blob` (or just the URL string for direct link)

---

### 1.3 Acceptance criteria

- [ ] Sales tab shows "Top 10 Products" table when data exists; shows "No data" empty state otherwise
- [ ] Table is client-side sortable by Revenue, Qty, and Margin columns
- [ ] Margin % cells are colour-coded correctly
- [ ] "Export CSV" button downloads a valid `.csv` file named `sales-report-YYYY-MM-DD.csv`
- [ ] CSV contains one row per period bucket matching what the bar chart shows
- [ ] Payment method breakdown section renders for all 5 methods (CASH, CARD, BANK\_TRANSFER, QR\_PAY, CREDIT) — methods with zero revenue are omitted (already the case)
- [ ] Changing `groupBy` (day/week/month) updates both the chart AND the top-products table without a full page reload

---

## 2. P&L Report Upgrade

### 2.1 Backend changes — `reports.service.ts` → `profitLoss()`

**Add `grossMarginPct` to every `byPeriod` row.**

Currently each `byPeriod` row contains:
```typescript
{ period, revenueCents, cogsCents, grossProfitCents, marginPct }
```

`marginPct` is already calculated as `(rev - cogs) / rev * 100`. The field exists but is named `marginPct`. **No backend change required** — it just needs to be exposed correctly in the frontend table (see §2.2).

**Add `netProfitCents` per period row (new):**

The current `byPeriod` query joins `Sale` + `SaleLine` + `Product` for gross profit only. Expenses are aggregated globally. To get net profit per period, expenses must also be grouped by month and joined.

New shape for `byPeriod`:
```typescript
byPeriod: {
  period:            string;   // YYYY-MM-DD
  revenueCents:      number;
  cogsCents:         number;
  grossProfitCents:  number;
  grossMarginPct:    number;   // renamed from marginPct for clarity
  expensesCents:     number;   // NEW — sum of expenses in that month
  netProfitCents:    number;   // NEW — grossProfit − expenses
  netMarginPct:      number;   // NEW — netProfit / revenue
}[]
```

Backend implementation: run a second `$queryRaw` grouping `expenses` by `DATE_TRUNC('month', date)` for the same date range, then merge into the `byPeriod` map by period key. No new endpoint.

**Verify expense section renders:** The `expensesByCategory` array is already in the response. The bug is likely that the frontend renders it conditionally with a length check that fails when the array is empty but defined. Spec requires the section to render with a "No expenses recorded" message when empty, not be hidden entirely.

---

### 2.2 Frontend changes — `ReportsPage.tsx` → `ProfitLossTab`

**Update monthly trend table** — add three new columns:

| Month | Revenue | COGS | Gross Profit | **Gross Margin %** | **Expenses** | **Net Profit** |
|---|---|---|---|---|---|---|

The `marginPct` field is renamed to `grossMarginPct` in the response (requires updating the `ProfitLossData` type in `services/reports.ts`).

**Fix expense section render guard:**

Current pattern (likely):
```tsx
{data.expensesByCategory.length > 0 && <ExpenseSection ... />}
```

Change to always render the section, showing a "No expenses in this period" row when the array is empty:
```tsx
<ExpenseSection data={data.expensesByCategory} />
// Inside ExpenseSection:
{items.length === 0
  ? <p className="text-slate-400 text-sm py-2">No expenses recorded in this period</p>
  : items.map(...)}
```

**Update `services/reports.ts`:**
- Rename `marginPct` → `grossMarginPct` in `ProfitLossData.byPeriod`
- Add `expensesCents`, `netProfitCents`, `netMarginPct` to `ProfitLossData.byPeriod`

---

### 2.3 Acceptance criteria

- [ ] Monthly trend table shows Gross Margin %, Expenses, and Net Profit columns
- [ ] Expenses column is populated for months that have expense data; shows Rs. 0.00 for months without
- [ ] Expense breakdown section renders even when `expensesByCategory` is an empty array — shows "No expenses recorded in this period" message
- [ ] Net Profit row in the waterfall summary is green for positive, red for negative — already implemented; verify it still works after refactor
- [ ] `grossMarginPct` (renamed from `marginPct`) renders correctly — no NaN or undefined
- [ ] PDF export includes all new columns in the monthly table

---

## 3. Inventory Report Upgrade

### 3.1 Backend changes — `reports.service.ts` → `inventoryReport()`

**Add `slowMovers` query (new parallel query):**

A slow-mover is a product that has stock on hand but zero confirmed sales in the last 30 days.

```sql
SELECT p.id AS "productId", p.name, p.sku,
  p."costCents",
  COALESCE(SUM(s.qty), 0)::float AS "totalQty",
  MAX(sale.date)                  AS "lastSaleDate"
FROM "Product" p
LEFT JOIN "Stock"   s    ON s."productId" = p.id
LEFT JOIN "SaleLine" sl  ON sl."productId" = p.id
LEFT JOIN "Sale"    sale ON sale.id = sl."saleId"
                         AND sale.status = 'CONFIRMED'
                         AND sale.date >= NOW() - INTERVAL '30 days'
WHERE p."isActive" = true
GROUP BY p.id, p.name, p.sku, p."costCents"
HAVING COALESCE(SUM(s.qty), 0) > 0   -- has stock
   AND COUNT(sale.id) = 0             -- zero sales in last 30 days
ORDER BY (COALESCE(SUM(s.qty), 0) * p."costCents") DESC
LIMIT 20
```

Return shape added to `inventoryReport` response:
```typescript
slowMovers: {
  productId:      string;
  name:           string;
  sku:            string;
  totalQty:       number;
  costCents:      number;
  costValueCents: number;   // totalQty * costCents
  lastSaleDate:   string | null;  // ISO date or null if never sold
}[]
```

**Add `lowStockList` to response (new — currently only `lowStockCount` is in `totals`):**

The existing `items[]` has `isLowStock: boolean` per row but the frontend must filter it client-side. Add a pre-filtered `lowStockItems` array to the response for direct rendering:

```typescript
lowStockItems: {
  productId:    string;
  name:         string;
  sku:          string;
  totalQty:     number;
  reorderLevel: number;
  deficit:      number;   // reorderLevel - totalQty (how many units short)
  costCents:    number;
}[]
```

Sourced from the existing `items` array after mapping — no additional DB query.

No new endpoint. Both additions go into the existing `GET /reports/inventory` response.

---

### 3.2 Frontend changes — `ReportsPage.tsx` → `InventoryTab`

**New: `SlowMoversTable` component**

Rendered below the main valuation table with a section header "Slow Movers (no sales in 30 days)":

| Product | SKU | Stock Qty | Stock Value | Last Sold |
|---|---|---|---|---|

- "Last Sold" column shows relative date (e.g. "45 days ago") or "Never"
- Rows sorted by stock value (deadstock cost) descending — highest-risk items first
- Shows max 20 rows; no pagination (backend limits to 20)
- Empty state: "All stocked products had sales activity in the last 30 days ✓"

**New: `LowStockPanel` component**

Rendered at top of InventoryTab as a collapsible alert panel (collapsed by default if `lowStockCount === 0`):

```
⚠ 4 products below reorder level  [Expand ▾]

┌────────────────────────────────────────────────────────┐
│ Product        │ SKU  │ In Stock │ Reorder │ Short By  │
│ Panadol Tablet │ PAN1 │     2    │   10    │    8      │
│ ...            │ ...  │ ...      │ ...     │ ...       │
└────────────────────────────────────────────────────────┘
```

**Update `services/reports.ts`:**
- Add `slowMovers` array to `InventoryReportData`
- Add `lowStockItems` array to `InventoryReportData`

---

### 3.3 Acceptance criteria

- [ ] Slow movers section appears when there are products with stock but no sales in 30 days
- [ ] Slow movers section shows "All products had recent sales" empty state when none qualify
- [ ] "Last Sold: Never" shown correctly for products that have never appeared on a confirmed invoice
- [ ] Low stock panel is collapsed by default when `lowStockCount === 0`
- [ ] Low stock panel auto-expands when `lowStockCount > 0`
- [ ] Deficit column (`reorderLevel − qty`) is correct for each row
- [ ] Existing valuation table and totals bar are unchanged
- [ ] Warehouse filter dropdown still filters both the valuation table and the slow-movers list

---

## 4. Dashboard Revenue Chart Upgrade

### 4.1 Backend changes — `dashboard.service.ts` → `revenueChart()`

**Accept a `days` parameter (30 | 60 | 90) instead of hard-coding 14:**

```typescript
revenueChart: async (days: 30 | 60 | 90 = 30) => {
  // replace hard-coded INTERVAL '14 days' with parameterised interval
}
```

**Add expenses series to the chart response:**

Run a second aggregation query grouping expenses by day for the same window, joining to the revenue series by date key.

Updated row shape:
```typescript
{
  date:            string;  // YYYY-MM-DD
  revenue:         number;  // cents
  orders:          number;
  expensesCents:   number;  // NEW — sum of non-template expenses that day
}
```

For days with no expenses, `expensesCents: 0`.

**Update dashboard controller** (`dashboard.controller.ts`):

```typescript
export const revenueChart: RequestHandler = async (req, res) => {
  const days = Number(req.query.days ?? 30) as 30 | 60 | 90;
  res.json(await dashboardService.revenueChart(days));
};
```

Update the `/summary` endpoint to pass `days: 30` as default so the dashboard summary call is backward-compatible.

---

### 4.2 Frontend changes — `DashboardPage.tsx`

**Add window-toggle pill strip** above the revenue chart:

```
[ 30 days ]  [ 60 days ]  [ 90 days ]
```

State: `const [chartDays, setChartDays] = useState<30 | 60 | 90>(30)`

The chart query uses `queryKey: ['revenue-chart', chartDays]` and passes `?days=chartDays` to the endpoint. Selecting a different pill invalidates and refetches.

**Add expenses trend line to `BarChart`:**

The existing `BarChart` component renders a single bar series. Extend it to accept an optional `overlayKey` and `overlayColor`:

```tsx
<BarChart
  data={chartData}
  labelKey="date"
  valueKey="revenue"
  overlayKey="expensesCents"   // ← new optional prop
  overlayColor="orange"
  color="indigo"
  maxBars={chartDays}
/>
```

Implementation: render expenses as a thinner bar (50% width, centred) overlaid on each revenue bar using CSS `position: absolute` within each column group. No chart library — stays pure CSS/Tailwind per CLAUDE.md.

Add a two-item legend below the chart:
```
● Revenue (indigo)   ● Expenses (orange)
```

**Update `services/dashboard.ts`:**
- Add `expensesCents: number` to the chart row type
- Add `days?: 30 | 60 | 90` param to `dashboardApi.revenueChart(days?)`

---

### 4.3 Acceptance criteria

- [ ] Default chart window is 30 days (not 14 as current)
- [ ] Toggling 30 / 60 / 90 pills refetches chart data and re-renders with the correct number of bars
- [ ] Active pill is visually highlighted; inactive pills are unselected
- [ ] Expense bars render over revenue bars for each day; orange colour does not obscure revenue readability
- [ ] Days with zero expenses show no orange bar (height 0), not an error
- [ ] Legend is visible and correctly labelled
- [ ] KPI cards above the chart are unaffected by the toggle (they remain month-to-date)
- [ ] Dashboard `/summary` endpoint remains backward-compatible (no query param = defaults to 30 days)

---

## File Checklist (implementation order)

```
backend/
  src/modules/reports/
    reports.service.ts   — add topProducts, slowMovers, lowStockItems, byPeriod netProfit
    reports.controller.ts — add salesCsv handler
    reports.routes.ts    — add GET /sales/csv route (before /sales)
  src/modules/dashboard/
    dashboard.service.ts — revenueChart(days), add expensesCents series
    dashboard.controller.ts — accept ?days query param

frontend/
  src/services/
    reports.ts           — update SalesReportData, ProfitLossData, InventoryReportData types
    dashboard.ts         — add expensesCents to chart row type; days param
  src/pages/
    reports/ReportsPage.tsx
      — TopProductsTable component
      — ExportCsvButton
      — P&L table: add grossMarginPct/expensesCents/netProfitCents columns
      — Fix expense section empty-state guard
      — SlowMoversTable component
      — LowStockPanel component
    dashboard/DashboardPage.tsx
      — 30/60/90 day toggle pills
      — BarChart overlayKey/overlayColor props + legend
```

---

## Out of Scope for This Sprint

- Purchases report changes (no request)
- Customer report changes (no request)
- New report tabs
- Exporting inventory or P&L as CSV (PDF already exists)
- Real-time dashboard (polling / websocket)
