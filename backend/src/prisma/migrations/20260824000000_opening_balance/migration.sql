-- What a customer or supplier owed when this system went live.
--
-- Every outstanding figure in the app is derived purely from documents held
-- HERE — sales, purchases, returns, payments. A contact who owed money before
-- go-live therefore read as owing nothing, and that same zero drove the
-- Dashboard's receivables and payables tiles and the POS credit-limit check, so
-- a customer already at their limit appeared to have their full credit free.
--
-- The only way to record such a debt was to raise a back-dated invoice or
-- purchase order, which moves stock that never moved and inflates revenue or
-- spend that was never real. There was no non-destructive option at all.
--
-- Carried forward rather than modelled as a document: the amount is ADDED to
-- the derived balance, and deliberately never added to any per-invoice figure,
-- because it belongs to no invoice. Payment caps and the lump-sum allocator
-- keep working on real documents only.
--
-- Purely additive, defaulting to 0, so every existing contact and every figure
-- already on screen is unchanged until someone enters an amount.
--
-- Reverse with:
--   ALTER TABLE "Customer" DROP COLUMN "openingBalanceCents", DROP COLUMN "openingBalanceAsOf";
--   ALTER TABLE "Supplier" DROP COLUMN "openingBalanceCents", DROP COLUMN "openingBalanceAsOf";

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "openingBalanceCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "openingBalanceAsOf"  TIMESTAMP(3);

ALTER TABLE "Supplier"
  ADD COLUMN IF NOT EXISTS "openingBalanceCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "openingBalanceAsOf"  TIMESTAMP(3);

-- An opening balance is money owed, never negative. Prepaid credit already has
-- its own home in creditBalanceCents and its ledger; letting this column go
-- negative would give the same idea two contradictory representations.
ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS "Customer_openingBalance_nonneg";
ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_openingBalance_nonneg" CHECK ("openingBalanceCents" >= 0);

ALTER TABLE "Supplier" DROP CONSTRAINT IF EXISTS "Supplier_openingBalance_nonneg";
ALTER TABLE "Supplier"
  ADD CONSTRAINT "Supplier_openingBalance_nonneg" CHECK ("openingBalanceCents" >= 0);
