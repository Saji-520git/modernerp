-- AlterEnum
ALTER TYPE "StockMoveType" ADD VALUE 'WRITE_OFF';

-- DropForeignKey
ALTER TABLE "stock_alerts" DROP CONSTRAINT "stock_alerts_productId_fkey";

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "app_settings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stock_alerts" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "warehouses" RENAME CONSTRAINT "Warehouse_pkey" TO "warehouses_pkey";

-- AddForeignKey
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "Warehouse_code_key" RENAME TO "warehouses_code_key";

-- RenameIndex
ALTER INDEX "Warehouse_name_key" RENAME TO "warehouses_name_key";
