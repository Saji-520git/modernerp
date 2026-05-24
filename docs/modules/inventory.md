# Module: Inventory

## Purpose
The Inventory module gives managers and staff complete visibility and control over stock
levels across all warehouses. It supports manual stock adjustments (corrections), stock
transfers between warehouses, and provides a full append-only ledger of every stock
movement. No stock can change without a corresponding movement record — this is enforced
at the service layer.

## User Stories
- As a MANAGER/ADMIN, I can adjust stock quantity for a product so that the system
  reflects physical counts after a stocktake.
- As a MANAGER/ADMIN, I can transfer stock from one warehouse to another so that
  distribution between locations is tracked accurately.
- As any authenticated user, I can view current stock levels for all products so that
  I know what is available.
- As any authenticated user, I can filter products below their reorder level so that
  I can raise purchase orders before running out.
- As any authenticated user, I can view the full stock movement history so that I can
  audit every change with a reason and timestamp.

## Data Model
No new tables — uses existing schema:

| Table | Role in this module |
|---|---|
| stock | Read and update qty (upsert on adjustment/transfer) |
| stock_movements | Append-only row for every change (ADJUSTMENT, TRANSFER_IN, TRANSFER_OUT) |
| products | Joined for name, SKU, reorder level |
| warehouses | Joined for warehouse name |

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /api/v1/inventory/stock | Any auth | List stock levels, paginated + searchable |
| GET | /api/v1/inventory/low-stock | Any auth | Products at or below reorder level |
| POST | /api/v1/inventory/adjustments | MANAGER+ | Manual stock adjustment (+/-) |
| POST | /api/v1/inventory/transfers | MANAGER+ | Move stock between warehouses |
| GET | /api/v1/inventory/movements | Any auth | Full movement history ledger |

## UI Screens

### 1. Inventory Page (`/inventory`) — 4 tabs

**Tab 1 — Stock Levels**
Searchable table: Product | SKU | Warehouse | Qty | Reorder Level | Status badge
Filter: warehouse selector, "Low stock only" toggle
Row action: "Adjust" shortcut button

**Tab 2 — Adjust Stock**
Form: Product (searchable), Warehouse, Quantity (signed +/-), Reason (required)
Submit creates StockMovement (ADJUSTMENT) + updates stock.qty

**Tab 3 — Transfer**
Form: Product, From Warehouse, To Warehouse, Quantity, Note
Submit creates TRANSFER_OUT + TRANSFER_IN movements + updates both stock rows

**Tab 4 — Movement History**
Table: Date | Product | Warehouse | Type | Qty | Reference | Note
Filters: product search, warehouse, movement type, date range

## Acceptance Criteria
- [ ] Stock levels table shows real qty from `stock` table, joined with product/warehouse.
- [ ] Low-stock filter returns only products where qty <= reorderLevel.
- [ ] Adjustment creates a StockMovement (type=ADJUSTMENT) and updates stock.qty in one transaction.
- [ ] Adjustment rejects if resulting qty would go negative.
- [ ] Transfer creates TRANSFER_OUT + TRANSFER_IN in one transaction.
- [ ] Transfer rejects if source stock is insufficient.
- [ ] Transfer rejects if fromWarehouseId === toWarehouseId.
- [ ] All write endpoints require MANAGER or ADMIN role.
- [ ] Movement history is read-only — no delete/edit endpoint exists.

## Out of Scope (for now)
- Batch adjustments (multiple products at once)
- Inventory valuation reports (FIFO/LIFO/Average cost)
- Barcode scanner integration for stocktake
- Scheduled low-stock email alerts
