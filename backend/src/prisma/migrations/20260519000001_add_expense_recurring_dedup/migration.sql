-- Add recurringTemplateId and monthYear to expenses table.
-- These fields link a recorded occurrence back to its isRecurring=true template
-- and identify which calendar month it was recorded for.
-- The unique index enforces one occurrence per template per month at the DB level.

ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "recurringTemplateId" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "monthYear"           TEXT;

-- IF NOT EXISTS makes this idempotent — safe to run more than once.
-- NULL values in PostgreSQL are treated as distinct in unique indexes, so regular
-- expenses (recurringTemplateId IS NULL) are never affected by this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS "expenses_recurringTemplateId_monthYear_key"
  ON "expenses"("recurringTemplateId", "monthYear");
