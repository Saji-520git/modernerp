-- Purchase payable follows delivered value (Increment 1).
-- Additive + idempotent: safe under `migrate deploy` on shared/prod DBs.

ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "receivedValueCents" INTEGER NOT NULL DEFAULT 0;

-- Backfill (a): POs that HAVE GRN receipts → sum of received value (received qty ×
-- actual unit cost). Legacy receipt lines may have unitCostCents = 0 (cost not
-- captured before G1/G2); for those fall back to the PO line cost so the received
-- value reflects what was actually received.
UPDATE "Purchase" p
SET "receivedValueCents" = COALESCE(sub.v, 0)
FROM (
  SELECT r."purchaseId" AS pid,
         ROUND(SUM(rl."qty" * COALESCE(NULLIF(rl."unitCostCents", 0), pl."unitCostCents")))::int AS v
  FROM "purchase_receipt_lines" rl
  JOIN "purchase_receipts" r  ON rl."receiptId"      = r."id"
  JOIN "PurchaseLine"       pl ON rl."purchaseLineId" = pl."id"
  GROUP BY r."purchaseId"
) sub
WHERE p."id" = sub.pid;

-- Backfill (b): CONFIRMED POs with NO receipts (legacy FULL confirm) → keep ordered
-- total, so existing outstanding balances are unchanged (zero disruption to legacy).
UPDATE "Purchase" p
SET "receivedValueCents" = p."totalCents"
WHERE p."status" = 'CONFIRMED'
  AND NOT EXISTS (SELECT 1 FROM "purchase_receipts" r WHERE r."purchaseId" = p."id");
