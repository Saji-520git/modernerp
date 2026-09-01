-- Quotation.number: add the missing UNIQUE constraint.
--
-- Why this was a bug, not a tidy-up: quotations.service issues the number
-- inside withNumberRetry(), and that helper only retries on P2002 (a unique
-- violation). Quotation was the ONLY document model without the constraint —
-- Purchase, Sale, SaleReturn, PurchaseReturn and StockTake all have it — so the
-- database never raised P2002, the retry never engaged, and two people saving a
-- quotation at the same moment both succeeded with the same number, silently.
--
-- Order matters. CREATE UNIQUE INDEX fails outright if duplicates already
-- exist, and that would abort `migrate deploy` and leave the app unable to
-- start. So any duplicate already in the table is repaired FIRST.

-- 1. Repair existing duplicates.
--    The earliest row (by createdAt, id as tiebreak) keeps the original number;
--    every later collision gets a "-DUP<n>" suffix. Suffixing rather than
--    renumbering is deliberate: it never collides with a number the sequence
--    might legitimately issue later, and it leaves the duplicate visible so it
--    can be reissued by hand. No-op on a healthy database.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "number" ORDER BY "createdAt", id) AS rn
  FROM "Quotation"
)
UPDATE "Quotation" q
SET    "number" = q."number" || '-DUP' || r.rn
FROM   ranked r
WHERE  q.id = r.id
  AND  r.rn > 1;

-- 2. Add the constraint. Named to Prisma's @unique convention
--    (<Table>_<field>_key) so the schema and the database agree and drift
--    detection stays quiet. IF NOT EXISTS keeps this idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "Quotation_number_key" ON "Quotation" ("number");
