# Module: Purchases

## Purpose

The Purchases module lets managers create Purchase Orders (POs) for suppliers, track their status (Draft → Confirmed → Cancelled), and automatically receive stock into a warehouse when a PO is confirmed. Every confirmed PO generates `PURCHASE_IN` stock movements and updates the product's last cost price.

## User Stories

- As a Manager, I can create a draft purchase order with one or more line items so that I can plan what to buy.
- As a Manager, I can confirm a draft PO so that stock is automatically added to the warehouse.
- As a Manager, I can cancel a draft PO so that it doesn't show as pending.
- As any staff, I can view all purchase orders and their status so that I know what stock is incoming.

## Data Model

Uses existing Prisma models:

| Table | Key Fields |
|---|---|
| `Purchase` | id, number (PO-YYYY-NNNN), supplierId, warehouseId, status (DRAFT/CONFIRMED/CANCELLED), subtotalCents, taxCents, totalCents, date, note |
| `PurchaseLine` | id, purchaseId, productId, qty, unitCostCents, taxPercent, lineTotalCents |
| `Supplier` | id, name, phone, email |
| `StockMovement` | type=PURCHASE_IN, refType='Purchase', refId=purchaseId |

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /purchases/suppliers | Any auth | Dropdown list of active suppliers |
| GET | /purchases/products | Any auth | Dropdown list of active products (for line items) |
| GET | /purchases | Any auth | Paginated list with search + status filter |
| GET | /purchases/:id | Any auth | Full PO detail with lines |
| POST | /purchases | ADMIN/MANAGER | Create a draft PO |
| PATCH | /purchases/:id/confirm | ADMIN/MANAGER | Confirm → adds stock in $transaction |
| PATCH | /purchases/:id/cancel | ADMIN/MANAGER | Cancel (DRAFT only) |

## UI Screens

### Tab 1: Purchase Orders (list)
- Status filter pills: All / Draft / Confirmed / Cancelled
- Search by PO number or supplier name
- Table: PO# | Supplier | Warehouse | Date | Lines | Total | Status | Actions
- Actions per row: View (modal) | Confirm ✓ | Cancel ✗ (DRAFT rows only)

### Tab 2: New Order (form)
- Supplier dropdown, Warehouse dropdown, Date, Note
- Dynamic lines table: Product, Qty, Unit Cost ($), Tax %, Line Total (computed)
- Order summary: Subtotal / Tax / Total
- Save as Draft button

### Detail Modal
- Full PO info and all line items
- Confirm & Receive Stock / Cancel buttons (DRAFT only)

## Business Logic

- PO number auto-generated: `PO-YYYY-NNNN` (sequential per year)
- All money stored as **integer cents** — UI converts dollars ↔ cents on input/display
- Line total = round(qty × unitCostCents) + round(qty × unitCostCents × taxPercent/100)
- **Confirm transaction** (atomic):
  1. Set status = CONFIRMED
  2. For each line: upsert Stock (increment qty), create PURCHASE_IN movement, update product.costCents
- Cancel only allowed on DRAFT status
- Confirm only allowed on DRAFT status

## Acceptance Criteria

- [x] Can create a PO with multiple lines; PO number is unique and sequential
- [x] Confirming a PO adds qty to the correct warehouse's Stock
- [x] Confirming a PO creates PURCHASE_IN movement in StockMovement
- [x] Product.costCents updated to latest unitCostCents on confirm
- [x] Cannot confirm or cancel an already-confirmed PO
- [x] All writes use Prisma $transaction
- [x] CASHIER/STAFF can only read; ADMIN/MANAGER can write

## Out of Scope (for now)

- Partial receipts / GRN workflow
- Supplier payment tracking
- Purchase returns
- Barcode scanning on receive
