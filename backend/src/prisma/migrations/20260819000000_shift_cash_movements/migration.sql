-- Link the cash movements that are not sales to the till they passed through.
--
-- A shift's expected cash was openingFloat + CASH-method sale totals, and
-- nothing else. Three things move real money through a drawer without being a
-- CASH sale, and all three were invisible:
--
--   * split cash+credit sales — stored as paymentMethod CREDIT with paidCents
--     set, so the cash taken was filed under CREDIT and never expected back
--   * credit settlements — a customer paying off a bill in cash at the till
--   * cash refunds — a return handing money back out of the drawer
--
-- The first is already reachable: those sales carry shiftId. The other two had
-- no link to a shift at all, so this adds one. A cashier was left explaining a
-- variance the system invented.
--
-- Purely additive and nullable. Existing rows get NULL and are simply not
-- counted, so every shift already closed keeps its stored snapshot untouched
-- and no historical figure moves. ON DELETE SET NULL so removing a shift can
-- never cascade into financial records.
--
-- Reverse with:
--   ALTER TABLE "SaleReturn"        DROP COLUMN "shiftId";
--   ALTER TABLE "customer_payments" DROP COLUMN "shiftId";

ALTER TABLE "SaleReturn"        ADD COLUMN "shiftId" TEXT;
ALTER TABLE "customer_payments" ADD COLUMN "shiftId" TEXT;

CREATE INDEX "SaleReturn_shiftId_idx"        ON "SaleReturn"("shiftId");
CREATE INDEX "customer_payments_shiftId_idx" ON "customer_payments"("shiftId");

ALTER TABLE "SaleReturn"
  ADD CONSTRAINT "SaleReturn_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "pos_shifts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_payments"
  ADD CONSTRAINT "customer_payments_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "pos_shifts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
