-- Soft-delete columns for Sale
ALTER TABLE "Sale" ADD COLUMN "deletedAt"   TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_deletedById_fkey"
  FOREIGN KEY ("deletedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Soft-delete columns for Purchase
ALTER TABLE "Purchase" ADD COLUMN "deletedAt"   TIMESTAMP(3);
ALTER TABLE "Purchase" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_deletedById_fkey"
  FOREIGN KEY ("deletedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Soft-delete columns for Expense (table name from @@map)
ALTER TABLE "expenses" ADD COLUMN "deletedAt"   TIMESTAMP(3);
ALTER TABLE "expenses" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_deletedById_fkey"
  FOREIGN KEY ("deletedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Soft-delete columns for ExpenseCategory (table name from @@map)
ALTER TABLE "expense_categories" ADD COLUMN "deletedAt"   TIMESTAMP(3);
ALTER TABLE "expense_categories" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_deletedById_fkey"
  FOREIGN KEY ("deletedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
