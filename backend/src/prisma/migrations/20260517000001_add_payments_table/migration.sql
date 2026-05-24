-- Migration: Add payments table + paidCents to purchases

-- Add paidCents to purchases (defaulting existing rows to 0)
ALTER TABLE "Purchase" ADD COLUMN "paidCents" INTEGER NOT NULL DEFAULT 0;

-- Create payments table
CREATE TABLE "payments" (
  "id"          TEXT NOT NULL,
  "saleId"      TEXT,
  "purchaseId"  TEXT,
  "amountCents" INTEGER NOT NULL,
  "method"      "PaymentMethod" NOT NULL,
  "date"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note"        TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- Foreign keys
ALTER TABLE "payments" ADD CONSTRAINT "payments_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
