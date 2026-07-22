-- Stock-take / cycle count module (optional feature "stockTake"). Additive +
-- idempotent. Two new tables; no changes to existing tables' columns.

CREATE TABLE IF NOT EXISTS "stock_takes" (
  "id"            TEXT NOT NULL,
  "number"        TEXT NOT NULL,
  "warehouseId"   TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'DRAFT',
  "note"          TEXT,
  "createdById"   TEXT NOT NULL,
  "completedById" TEXT,
  "completedAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stock_takes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_takes_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "warehouses" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "stock_takes_number_key" ON "stock_takes" ("number");
CREATE INDEX IF NOT EXISTS "stock_takes_status_idx"      ON "stock_takes" ("status");
CREATE INDEX IF NOT EXISTS "stock_takes_warehouseId_idx" ON "stock_takes" ("warehouseId");

CREATE TABLE IF NOT EXISTS "stock_take_lines" (
  "id"            TEXT NOT NULL,
  "stockTakeId"   TEXT NOT NULL,
  "productId"     TEXT NOT NULL,
  "systemQty"     DECIMAL(18,4) NOT NULL,
  "countedQty"    DECIMAL(18,4),
  "appliedQty"    DECIMAL(18,4),
  "unitCostCents" INTEGER NOT NULL DEFAULT 0,
  "note"          TEXT,
  CONSTRAINT "stock_take_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_take_lines_stockTakeId_fkey"
    FOREIGN KEY ("stockTakeId") REFERENCES "stock_takes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stock_take_lines_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "stock_take_lines_stockTakeId_idx" ON "stock_take_lines" ("stockTakeId");
