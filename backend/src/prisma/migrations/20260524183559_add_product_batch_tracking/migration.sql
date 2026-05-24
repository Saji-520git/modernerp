-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isBatchTracked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "stock_batches" ADD COLUMN     "batchNumber" TEXT;
