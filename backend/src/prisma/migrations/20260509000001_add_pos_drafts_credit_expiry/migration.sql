-- ============================================================
-- Migration: add_pos_drafts_credit_expiry
-- Adds: PosDraft, PosDraftItem models
--       CREDIT payment method
--       Product expiry fields
--       Customer credit fields
-- ============================================================

-- 1. Add CREDIT to PaymentMethod enum
ALTER TYPE "PaymentMethod" ADD VALUE 'CREDIT';

-- 2. Product expiry tracking
ALTER TABLE "Product" ADD COLUMN "expiryDate"      TIMESTAMP(3);
ALTER TABLE "Product" ADD COLUMN "expiryAlertDays" INTEGER NOT NULL DEFAULT 30;

-- 3. Customer credit account
ALTER TABLE "Customer" ADD COLUMN "creditEnabled"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN "creditLimitCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Customer" ADD COLUMN "creditAlertPct"   INTEGER NOT NULL DEFAULT 80;
ALTER TABLE "Customer" ADD COLUMN "creditSettleDays" INTEGER;

-- 4. PosDraft table (hold / saved bills)
CREATE TABLE "PosDraft" (
    "id"            TEXT NOT NULL,
    "label"         TEXT,
    "warehouseId"   TEXT NOT NULL,
    "customerId"    TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "note"          TEXT,
    "createdById"   TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PosDraft_pkey" PRIMARY KEY ("id")
);

-- 5. PosDraftItem table (line items for each saved bill)
CREATE TABLE "PosDraftItem" (
    "id"             TEXT NOT NULL,
    "draftId"        TEXT NOT NULL,
    "productId"      TEXT NOT NULL,
    "qty"            INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,

    CONSTRAINT "PosDraftItem_pkey" PRIMARY KEY ("id")
);

-- 6. Foreign keys — PosDraft
ALTER TABLE "PosDraft" ADD CONSTRAINT "PosDraft_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PosDraft" ADD CONSTRAINT "PosDraft_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PosDraft" ADD CONSTRAINT "PosDraft_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. Foreign keys — PosDraftItem
ALTER TABLE "PosDraftItem" ADD CONSTRAINT "PosDraftItem_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "PosDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PosDraftItem" ADD CONSTRAINT "PosDraftItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
