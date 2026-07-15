-- Add WhatsApp messaging settings to the singleton app_settings row.
-- Idempotent (IF NOT EXISTS) so it is safe on databases where the columns
-- may already exist (e.g. dev boxes that ran an ad-hoc ALTER).

ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "whatsappPhone" TEXT;
ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "waReceiptTemplate" TEXT;
ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "waOutstandingTemplate" TEXT;
ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "waOfferTemplate" TEXT;
