-- Add paymentType to customer_payments to mark credit-funded payment rows.
-- ADDITIVE ONLY. Mirrors the existing supplier_payments.paymentType column
-- (migration 20260610000000). Backfills 'PAYMENT' on all existing rows, so
-- every currently-recorded customer payment keeps its exact prior meaning.
-- "PAYMENT"        = cash/card/etc. tendered by the customer (existing behavior)
-- "CREDIT_APPLIED" = funded from the customer's unallocated credit balance
--
-- Touches NONE of the pre-existing drift objects (see CLAUDE.md §12.1).

-- AlterTable
ALTER TABLE "customer_payments" ADD COLUMN     "paymentType" TEXT NOT NULL DEFAULT 'PAYMENT';
