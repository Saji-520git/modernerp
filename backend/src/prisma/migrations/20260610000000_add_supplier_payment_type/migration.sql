-- AlterTable: add paymentType to distinguish regular payments from credit received
ALTER TABLE "supplier_payments" ADD COLUMN "paymentType" TEXT NOT NULL DEFAULT 'PAYMENT';
