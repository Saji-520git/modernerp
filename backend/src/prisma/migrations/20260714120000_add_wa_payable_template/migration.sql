-- Add supplier-payable WhatsApp template to the singleton app_settings row.
-- Idempotent (IF NOT EXISTS) so re-running on any DB is safe.

ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "waPayableTemplate" TEXT;
