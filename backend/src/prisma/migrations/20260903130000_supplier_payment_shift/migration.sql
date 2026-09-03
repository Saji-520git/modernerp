-- SupplierPayment.shiftId — which till the cash left.
--
-- A supplier's rep collects at the counter and the cashier pays from the
-- drawer. That money is gone, but nothing recorded which shift it left, so the
-- close expected it to still be there and reported a shortage of exactly the
-- amount handed over. The cashier was then asked to account for a discrepancy
-- the system had invented — the same class of bug that splitCashCents,
-- cashSettlementsCents and cashRefundsCents each fixed for their own movement.
--
-- Nullable, and null for every existing row: back-office payments move no
-- drawer cash and must stay outside shift reconciliation. Only payments made
-- with an open till attached will carry a shift from here on, so no historical
-- shift's arithmetic changes.
--
-- Mirrors CustomerPayment.shiftId exactly, including the index, because closing
-- a shift aggregates payouts by shiftId the same way it aggregates settlements.

ALTER TABLE "supplier_payments" ADD COLUMN "shiftId" TEXT;

CREATE INDEX "supplier_payments_shiftId_idx" ON "supplier_payments"("shiftId");

ALTER TABLE "supplier_payments"
  ADD CONSTRAINT "supplier_payments_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "pos_shifts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
