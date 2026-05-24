-- Add new columns to pos_shifts
ALTER TABLE "pos_shifts"
  ADD COLUMN IF NOT EXISTS "warehouseId"        TEXT,
  ADD COLUMN IF NOT EXISTS "cashSalesCents"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cardSalesCents"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "bankTransferCents"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "qrPayCents"         INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creditSalesCents"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "saleCount"          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "expectedCashCents"  INTEGER,
  ADD COLUMN IF NOT EXISTS "varianceCents"      INTEGER,
  ADD COLUMN IF NOT EXISTS "note"               TEXT,
  ADD COLUMN IF NOT EXISTS "forceClosedById"    TEXT;

-- Backfill warehouseId with the first active warehouse for any existing rows
-- (existing shifts pre-date warehouseId; pick any valid warehouse so FK doesn't fail)
UPDATE "pos_shifts" SET "warehouseId" = (SELECT id FROM "Warehouse" LIMIT 1)
  WHERE "warehouseId" IS NULL;

-- Now make warehouseId NOT NULL
ALTER TABLE "pos_shifts" ALTER COLUMN "warehouseId" SET NOT NULL;

-- FK: pos_shifts → warehouses
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pos_shifts_warehouseId_fkey'
  ) THEN
    ALTER TABLE "pos_shifts"
      ADD CONSTRAINT "pos_shifts_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- FK: pos_shifts → users (force-close)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pos_shifts_forceClosedById_fkey'
  ) THEN
    ALTER TABLE "pos_shifts"
      ADD CONSTRAINT "pos_shifts_forceClosedById_fkey"
      FOREIGN KEY ("forceClosedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Add shiftId to Sale
ALTER TABLE "Sale"
  ADD COLUMN IF NOT EXISTS "shiftId" TEXT;

-- FK: Sale → pos_shifts
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Sale_shiftId_fkey'
  ) THEN
    ALTER TABLE "Sale"
      ADD CONSTRAINT "Sale_shiftId_fkey"
      FOREIGN KEY ("shiftId") REFERENCES "pos_shifts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
