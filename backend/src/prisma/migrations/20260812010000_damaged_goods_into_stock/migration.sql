-- Accepted damaged goods enter stock as their own batch.
--
-- Until now, damaged units were excluded from stock whether or not they were
-- accepted — so accepting damaged goods charged the supplier's price but put
-- nothing in inventory to sell. These two columns let an accepted-damaged
-- quantity become its own batch, carrying the negotiated lower cost and a
-- separate (lower) selling price.
--
-- isDamaged also joins the batch-matching key, so a later delivery of GOOD
-- stock can never merge into a damaged batch even if cost, price and supplier
-- happen to coincide.
--
-- Both columns are additive with defaults, so existing rows are unaffected:
-- every existing batch is good stock (false), and receipts recorded before
-- this change have no damaged selling price (NULL).
ALTER TABLE "stock_batches"
  ADD COLUMN "isDamaged" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "purchase_receipt_lines"
  ADD COLUMN "damagedSellingPriceCents" INTEGER;
