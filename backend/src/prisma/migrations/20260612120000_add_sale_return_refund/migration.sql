-- v1.0.54 — Sales Return refund fields (cash/card/bank refund support)
-- Idempotent (IF NOT EXISTS) so this is safe to re-run on any existing DB.

ALTER TABLE "SaleReturn"
  ADD COLUMN IF NOT EXISTS "refundMethod" TEXT NOT NULL DEFAULT 'NONE';

ALTER TABLE "SaleReturn"
  ADD COLUMN IF NOT EXISTS "refundedCents" INTEGER NOT NULL DEFAULT 0;
