-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "receiptName" TEXT,
ADD COLUMN     "serviceChargeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "serviceChargeLabel" TEXT;

-- AlterTable
ALTER TABLE "app_settings" ADD COLUMN     "returnPolicy" TEXT NOT NULL DEFAULT '';
