# Module: POS (Point of Sale)

## Purpose
The POS module is the fast over-the-counter sales terminal used by cashiers to ring up
products, collect payment, and print receipts. It is intentionally simple: scan or search
a product, set quantity, pick payment method, and confirm. Stock is decremented and a Sale
record (isPos = true) is created in a single database transaction.

## User Stories
- As a CASHIER, I can search or scan products so that I can quickly add them to the cart.
- As a CASHIER, I can adjust item quantities in the cart so that I can fix mistakes.
- As a CASHIER, I can choose a payment method (Cash, Card, Wallet, etc.) so that the
  sale is recorded correctly.
- As a CASHIER, I can complete a checkout so that stock is decremented and a receipt is generated.
- As a MANAGER/ADMIN, I can view the POS sales list so that I can audit daily transactions.
- As any user, I can reprint a receipt by its sale number so that customers can get a copy.

## Data Model
Uses the existing **Sale** and **SaleLine** models (isPos = true) plus:

| Table | Key Fields |
|---|---|
| sales | id, number (INV-YYYY-NNNN), isPos=true, warehouseId, customerId?, paymentMethod, subtotalCents, taxCents, discountCents, totalCents, paidCents, status=CONFIRMED |
| sale_lines | saleId, productId, qty, unitPriceCents, taxPercent, discountCents, lineTotalCents |
| stocks | qty is decremented per product+warehouse |
| stock_movements | type=SALE_OUT, qty signed negative |

No new tables needed — all models already exist in schema.prisma.

## API Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | /api/v1/pos/warehouses | Any auth | List active warehouses for selector |
| GET | /api/v1/pos/products | Any auth | Search products with stock qty |
| POST | /api/v1/pos/checkout | CASHIER+ | Complete a sale in one transaction |
| GET | /api/v1/pos/receipt/:id | Any auth | Fetch a single receipt |
| GET | /api/v1/pos/sales | Any auth | List all POS sales (paginated) |

## UI Screens

### 1. POS Terminal (`/pos`)
Two-panel layout:
- **Left (2/3 width):** Warehouse selector + product search bar + product grid cards.
  Each card shows name, SKU, stock qty, and price. Click to add to cart.
- **Right (1/3 width):** Cart list with qty controls (−/+) and remove button.
  Totals (subtotal / tax / discount / total). Payment method selector. Checkout button.

### 2. Receipt Modal
Shown immediately after successful checkout:
- Sale number, date, cashier name
- Line items table
- Subtotal, tax, discount, total
- "New Sale" button to clear cart

### 3. Sales History (part of this page, tab/route extension)
Accessible from the Reports or POS menu — shows paginated POS sales with number, date, total, cashier.

## Acceptance Criteria
- [ ] Cashier can search products by name, SKU, or barcode.
- [ ] Products show real-time stock qty for the selected warehouse.
- [ ] Products with 0 stock are disabled in the grid (cannot be added to cart).
- [ ] Cart correctly computes subtotal, tax, and total in integer cents.
- [ ] Checkout rejects if any item stock is insufficient (shows clear error).
- [ ] Checkout creates Sale + SaleLines + decrements Stock + inserts StockMovement in ONE transaction.
- [ ] Sale number is generated as INV-YYYY-NNNN (no duplicates).
- [ ] Receipt modal shows all line items, totals, and sale number.
- [ ] "New Sale" clears the cart and returns to product grid.
- [ ] Role guard: only ADMIN, MANAGER, CASHIER can POST /checkout.

## Out of Scope (for now)
- Customer loyalty points
- Split payment (multiple payment methods per sale)
- Offline / offline-first mode
- Barcode scanner hardware integration (search field serves as manual entry)
- Cash drawer open command
- POS-specific discount codes / promotions
