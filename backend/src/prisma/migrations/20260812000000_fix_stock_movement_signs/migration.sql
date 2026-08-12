-- Backfill: StockMovement.qty must be signed by direction (+in / -out), which is
-- what the schema has always declared. Two writers stored a POSITIVE qty for
-- stock that was leaving the warehouse:
--   * the non-POS sale confirm  (SALE_OUT)   — sales.service.ts
--   * the purchase return       (RETURN_OUT) — purchase-return.service.ts
-- so the audit history showed sales as inbound movements. The write sites are
-- fixed in code by routing every insert through utils/stock-movement.ts, which
-- derives the sign from the movement type. This corrects the existing rows.
--
-- Scope: OUT types only. ADJUSTMENT is deliberately untouched — it is the one
-- genuinely bidirectional type and carries a caller-signed delta. IN types are
-- left alone as well; no incorrectly-signed inbound rows were observed.
--
-- Idempotent: after this runs, no OUT-type row has a positive qty, so a re-run
-- matches zero rows.
--
-- Stock quantities are NOT affected. Nothing in the application derives on-hand
-- quantity from this table — Stock and StockBatch own that, and both are
-- adjusted independently of the ledger row.
UPDATE "StockMovement"
SET "qty" = -"qty"
WHERE "type" IN ('SALE_OUT', 'RETURN_OUT', 'TRANSFER_OUT', 'WRITE_OFF')
  AND "qty" > 0;
