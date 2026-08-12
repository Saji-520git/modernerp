-- Close-short: let a buyer finish a purchase order that will never be fully
-- delivered.
--
-- Until now a PO could only reach DELIVERED by receiving every ordered unit.
-- Any shortfall — damaged goods the supplier never replaced, a discontinued
-- line — left the order stuck on PARTIAL forever.
--
-- CLOSED_SHORT is a distinct status rather than reusing DELIVERED on purpose:
-- reports must never claim a supplier delivered in full when they did not.
-- The audit columns record who closed it, when, and why.
--
-- Purely additive. Existing rows keep their current deliveryStatus and get
-- NULL audit columns; nothing is reclassified.
ALTER TYPE "DeliveryStatus" ADD VALUE 'CLOSED_SHORT';

ALTER TABLE "Purchase"
  ADD COLUMN "closedShortAt"     TIMESTAMP(3),
  ADD COLUMN "closedShortById"   TEXT,
  ADD COLUMN "closedShortReason" TEXT;

ALTER TABLE "Purchase"
  ADD CONSTRAINT "Purchase_closedShortById_fkey"
  FOREIGN KEY ("closedShortById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
