-- Migration: Add expense_categories and expenses tables

CREATE TABLE "expense_categories" (
  "id"       TEXT    NOT NULL,
  "name"     TEXT    NOT NULL,
  "color"    TEXT    NOT NULL DEFAULT '#6366f1',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

CREATE TABLE "expenses" (
  "id"            TEXT           NOT NULL,
  "categoryId"    TEXT           NOT NULL,
  "amount"        INTEGER        NOT NULL,
  "description"   TEXT           NOT NULL,
  "date"          TIMESTAMP(3)   NOT NULL,
  "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
  "reference"     TEXT,
  "createdById"   TEXT           NOT NULL,
  "createdAt"     TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey"
  FOREIGN KEY ("categoryId")  REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")               ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed a few default categories
INSERT INTO "expense_categories" ("id", "name", "color") VALUES
  (gen_random_uuid()::text, 'Rent',        '#3b82f6'),
  (gen_random_uuid()::text, 'Utilities',   '#f59e0b'),
  (gen_random_uuid()::text, 'Salaries',    '#10b981'),
  (gen_random_uuid()::text, 'Supplies',    '#8b5cf6'),
  (gen_random_uuid()::text, 'Marketing',   '#ef4444'),
  (gen_random_uuid()::text, 'Other',       '#6366f1');
