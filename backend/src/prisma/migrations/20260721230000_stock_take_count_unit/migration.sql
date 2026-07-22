-- Multi-unit stock-take: the unit each count was entered in (null = base unit).
-- Additive + idempotent. countedQty now holds the count in countUnit; confirm
-- converts it to base units before reconciling.
ALTER TABLE "stock_take_lines"
  ADD COLUMN IF NOT EXISTS "countUnitId" TEXT;
