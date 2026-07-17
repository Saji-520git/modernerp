-- G1: Costing foundation — weighted-average cost + per-batch cost + GRN cost/damage.
-- All additive, idempotent (ADD COLUMN IF NOT EXISTS). No data destroyed.

-- Product: costCents now holds weighted-average; add lastCostCents for reference.
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "lastCostCents" INTEGER NOT NULL DEFAULT 0;

-- StockBatch: each batch carries its own per-base-unit cost.
ALTER TABLE "stock_batches"
  ADD COLUMN IF NOT EXISTS "unitCostCents" INTEGER NOT NULL DEFAULT 0;

-- PurchaseReceiptLine (GRN line): actual cost + damaged qty + note captured at receipt.
ALTER TABLE "purchase_receipt_lines"
  ADD COLUMN IF NOT EXISTS "unitCostCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "purchase_receipt_lines"
  ADD COLUMN IF NOT EXISTS "damagedQty" DECIMAL(18,4) NOT NULL DEFAULT 0;
ALTER TABLE "purchase_receipt_lines"
  ADD COLUMN IF NOT EXISTS "note" TEXT;
