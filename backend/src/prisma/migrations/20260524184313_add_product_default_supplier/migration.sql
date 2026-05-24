-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "defaultSupplierId" TEXT;

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN     "sourceType" TEXT;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_defaultSupplierId_fkey" FOREIGN KEY ("defaultSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
