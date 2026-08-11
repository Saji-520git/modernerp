-- Batch-level selling price + supplier, and per-sale-line batch selection.
-- Additive + idempotent — safe under `migrate deploy` on shared/prod DBs.
-- Existing batches default to sellingPriceCents = 0 / supplierId = NULL; the
-- merge-match logic (added in the app layer, not here) treats 0/NULL as just
-- another value to match on, so pre-existing batches are never silently merged
-- with a newly-priced one unless a future GRN happens to also come in at 0.

ALTER TABLE "stock_batches" ADD COLUMN IF NOT EXISTS "sellingPriceCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "stock_batches" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;

DO $$ BEGIN
  ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Backfill: existing batches' supplier is derivable via purchaseLineId → PurchaseLine
-- → Purchase → supplierId. Populate it so pre-existing batches participate correctly
-- in future merge-matching instead of always reading as "no supplier".
UPDATE "stock_batches" sb
SET "supplierId" = p."supplierId"
FROM "PurchaseLine" pl
JOIN "Purchase" p ON p."id" = pl."purchaseId"
WHERE sb."purchaseLineId" = pl."id"
  AND sb."supplierId" IS NULL;

-- GRN receiving line: selling price captured alongside the existing unit cost.
ALTER TABLE "purchase_receipt_lines" ADD COLUMN IF NOT EXISTS "sellingPriceCents" INTEGER;

-- Sale line: which batch this line was sold from (manual pick at POS/Invoice).
-- Null = automatic FEFO, i.e. today's existing behavior, unchanged.
ALTER TABLE "SaleLine" ADD COLUMN IF NOT EXISTS "batchId" TEXT;

DO $$ BEGIN
  ALTER TABLE "SaleLine" ADD CONSTRAINT "SaleLine_batchId_fkey"
    FOREIGN KEY ("batchId") REFERENCES "stock_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
