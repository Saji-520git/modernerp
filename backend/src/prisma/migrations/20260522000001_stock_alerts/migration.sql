-- Add alert threshold fields to app_settings
ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "alertLowStockEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "alertExpiryEnabled"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "alertExpiryDays"       INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "alertLowStockEmail"    TEXT,
  ADD COLUMN IF NOT EXISTS "alertShowInDashboard"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "alertBellEnabled"      BOOLEAN NOT NULL DEFAULT true;

-- Create stock_alerts table
CREATE TABLE IF NOT EXISTS "stock_alerts" (
  "id"          TEXT        NOT NULL,
  "type"        TEXT        NOT NULL,
  "severity"    TEXT        NOT NULL,
  "productId"   TEXT        NOT NULL,
  "warehouseId" TEXT,
  "qty"         DOUBLE PRECISION NOT NULL,
  "threshold"   DOUBLE PRECISION NOT NULL,
  "expiryDate"  TIMESTAMP(3),
  "message"     TEXT        NOT NULL,
  "isRead"      BOOLEAN     NOT NULL DEFAULT false,
  "isDismissed" BOOLEAN     NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_alerts_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'stock_alerts_productId_fkey') THEN
    ALTER TABLE "stock_alerts"
      ADD CONSTRAINT "stock_alerts_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'stock_alerts_warehouseId_fkey') THEN
    ALTER TABLE "stock_alerts"
      ADD CONSTRAINT "stock_alerts_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
