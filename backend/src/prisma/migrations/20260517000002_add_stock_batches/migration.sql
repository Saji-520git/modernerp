-- Migration: Add stock_batches table and expiryDate to PurchaseLine

-- Add expiryDate to purchase lines (nullable — existing rows get NULL)
ALTER TABLE "PurchaseLine" ADD COLUMN "expiryDate" TIMESTAMP(3);

-- Create stock_batches table
CREATE TABLE "stock_batches" (
  "id"             TEXT         NOT NULL,
  "productId"      TEXT         NOT NULL,
  "warehouseId"    TEXT         NOT NULL,
  "purchaseLineId" TEXT,
  "qty"            DECIMAL(18,4) NOT NULL,
  "expiryDate"     TIMESTAMP(3),
  "receivedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_productId_fkey"
  FOREIGN KEY ("productId")   REFERENCES "Product"("id")   ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
