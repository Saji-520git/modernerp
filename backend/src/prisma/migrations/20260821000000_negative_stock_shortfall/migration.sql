-- Let the POS counter sell past zero, without ever storing negative stock.
--
-- The problem this solves is data lag, not overselling: the goods are on the
-- shelf, the GRN just has not been keyed in yet, and the cashier is blocked
-- from taking money for something the customer is holding.
--
-- Stock.qty is NOT made negative. It is a derived value — recomputeStockQty
-- sets it to SUM(stock_batches WHERE qty > 0) — so a negative there would be
-- erased the next time any code path recomputed it, resurrecting units that
-- were already sold. Instead the uncovered quantity is recorded beside it as a
-- debt. qty keeps matching the batch sum, which means inventory valuation,
-- stock-take variance, FEFO deduction, low-stock alerts and every report keep
-- working with no changes and cannot drift.
--
-- The debt is settled by the next stock increase (purchase confirm, GRN,
-- adjustment increase, transfer in, import), which consumes it through the
-- normal FEFO path before the goods land on the shelf. Screens display
-- qty - shortfallQty, so the counter still sees -2.
--
-- Purely additive with defaults. Existing rows get 0 / false, the feature is
-- off until switched on in Settings, and every code path behaves exactly as it
-- did before. shortfallQty lives on Stock rather than its own table so the
-- SELECT ... FOR UPDATE row lock already taken during checkout covers it —
-- no new concurrency design.
--
-- Reverse with:
--   ALTER TABLE "Stock"        DROP COLUMN "shortfallQty";
--   ALTER TABLE "app_settings" DROP COLUMN "allowNegativeStock";

ALTER TABLE "Stock"
  ADD COLUMN IF NOT EXISTS "shortfallQty" DECIMAL(18,4) NOT NULL DEFAULT 0;

ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false;

-- A debt is meaningless against stock that is also on hand: one or the other,
-- never both. Enforced in code, asserted here so a future bug cannot quietly
-- persist an impossible row.
ALTER TABLE "Stock"
  DROP CONSTRAINT IF EXISTS "Stock_shortfall_nonneg";
ALTER TABLE "Stock"
  ADD CONSTRAINT "Stock_shortfall_nonneg" CHECK ("shortfallQty" >= 0);
