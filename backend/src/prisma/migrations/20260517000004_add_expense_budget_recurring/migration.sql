-- Migration: Add budget to expense_categories and recurring fields to expenses

ALTER TABLE "expense_categories" ADD COLUMN "monthlyBudget" INTEGER;

ALTER TABLE "expenses" ADD COLUMN "isRecurring"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "expenses" ADD COLUMN "recurringDay" INTEGER;
