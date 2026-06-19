-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "costEntryUnitId" TEXT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_costEntryUnitId_fkey" FOREIGN KEY ("costEntryUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
