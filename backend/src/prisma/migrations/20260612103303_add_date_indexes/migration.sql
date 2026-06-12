-- Performance: date indexes for date-range filtered list pages (v1.0.53)
-- Idempotent (IF NOT EXISTS) so this is safe to re-run on any existing DB.

-- Expense (table "expenses")
CREATE INDEX IF NOT EXISTS "expenses_date_idx" ON "expenses"("date");
CREATE INDEX IF NOT EXISTS "expenses_createdAt_idx" ON "expenses"("createdAt");

-- PosShift (table "pos_shifts")
CREATE INDEX IF NOT EXISTS "pos_shifts_openedAt_idx" ON "pos_shifts"("openedAt");
CREATE INDEX IF NOT EXISTS "pos_shifts_closedAt_idx" ON "pos_shifts"("closedAt");
CREATE INDEX IF NOT EXISTS "pos_shifts_createdAt_idx" ON "pos_shifts"("createdAt");

-- SaleReturn (table "SaleReturn")
CREATE INDEX IF NOT EXISTS "SaleReturn_createdAt_idx" ON "SaleReturn"("createdAt");

-- PurchaseReturn (table "purchase_returns")
CREATE INDEX IF NOT EXISTS "purchase_returns_createdAt_idx" ON "purchase_returns"("createdAt");
