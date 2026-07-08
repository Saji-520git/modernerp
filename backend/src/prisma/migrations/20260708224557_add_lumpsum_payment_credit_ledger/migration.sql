-- Lump-sum payment allocation + unallocated credit ledgers.
-- ADDITIVE ONLY. Hand-authored to avoid the destructive drops that a
-- datasource-diff produced due to pre-existing drift in the dev database
-- (phantom CRM/HR/manufacturing/loyalty/tenant/whatsapp tables not in this
-- branch's schema). This migration touches NONE of those objects.

-- AlterTable — new defaulted credit-balance columns (backfill 0 on existing rows)
ALTER TABLE "Customer" ADD COLUMN     "creditBalanceCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Supplier" ADD COLUMN     "creditBalanceCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable — nullable allocation grouping on existing payment tables
ALTER TABLE "customer_payments" ADD COLUMN     "allocationGroupId" TEXT;
ALTER TABLE "supplier_payments" ADD COLUMN     "allocationGroupId" TEXT;

-- CreateTable
CREATE TABLE "customer_credit_ledger" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "allocationGroupId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_credit_ledger" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "allocationGroupId" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_credit_ledger_customerId_idx" ON "customer_credit_ledger"("customerId");

-- CreateIndex
CREATE INDEX "customer_credit_ledger_allocationGroupId_idx" ON "customer_credit_ledger"("allocationGroupId");

-- CreateIndex
CREATE INDEX "supplier_credit_ledger_supplierId_idx" ON "supplier_credit_ledger"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_credit_ledger_allocationGroupId_idx" ON "supplier_credit_ledger"("allocationGroupId");

-- CreateIndex
CREATE INDEX "customer_payments_allocationGroupId_idx" ON "customer_payments"("allocationGroupId");

-- CreateIndex
CREATE INDEX "supplier_payments_allocationGroupId_idx" ON "supplier_payments"("allocationGroupId");

-- AddForeignKey
ALTER TABLE "customer_credit_ledger" ADD CONSTRAINT "customer_credit_ledger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_ledger" ADD CONSTRAINT "customer_credit_ledger_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_ledger" ADD CONSTRAINT "supplier_credit_ledger_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_credit_ledger" ADD CONSTRAINT "supplier_credit_ledger_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
