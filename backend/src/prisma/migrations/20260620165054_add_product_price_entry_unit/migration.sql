-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "priceEntryUnitId" TEXT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_priceEntryUnitId_fkey" FOREIGN KEY ("priceEntryUnitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
