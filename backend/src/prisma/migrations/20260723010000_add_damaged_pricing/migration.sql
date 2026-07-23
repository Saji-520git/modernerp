-- Damaged-goods pricing (Increment 2): accept damaged at a negotiated cost, or
-- reject (default, unpaid). Additive + idempotent — safe under `migrate deploy`.
-- No backfill: existing damaged stays rejected/unpaid (= Increment-1 behavior).

ALTER TABLE "purchase_receipt_lines" ADD COLUMN IF NOT EXISTS "damagedAccepted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "purchase_receipt_lines" ADD COLUMN IF NOT EXISTS "damagedUnitCostCents" INTEGER;
