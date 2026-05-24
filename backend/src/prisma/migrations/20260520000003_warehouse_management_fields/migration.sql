-- Rename table to "warehouses" and add new columns
ALTER TABLE "Warehouse" RENAME TO "warehouses";

-- Add new columns
ALTER TABLE "warehouses"
  ADD COLUMN IF NOT EXISTS "city"        TEXT,
  ADD COLUMN IF NOT EXISTS "phone"       TEXT,
  ADD COLUMN IF NOT EXISTS "email"       TEXT,
  ADD COLUMN IF NOT EXISTS "managerId"   TEXT,
  ADD COLUMN IF NOT EXISTS "type"        TEXT NOT NULL DEFAULT 'MAIN',
  ADD COLUMN IF NOT EXISTS "isDefault"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "notes"       TEXT;

-- Mark the existing "Main Warehouse" as default
UPDATE "warehouses" SET "isDefault" = true WHERE "code" = 'MAIN';

-- FK: warehouses.managerId → User
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'warehouses_managerId_fkey'
  ) THEN
    ALTER TABLE "warehouses"
      ADD CONSTRAINT "warehouses_managerId_fkey"
      FOREIGN KEY ("managerId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Update all FK references that pointed at "Warehouse" table
-- (Postgres renames the constraints automatically on table rename, so FKs on
--  Stock, StockMovement, Purchase, Sale, SaleReturn, PosDraft, PosShift, StockBatch
--  that reference the old table name should still work — Postgres follows the rename)
