-- Add global POS toggle: auto-apply product/unit preset (default) discounts.
-- Idempotent + additive so it is a no-op where the column already exists and
-- is safe to run via `migrate deploy` on any environment.
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "posApplyDefaultDiscount" BOOLEAN NOT NULL DEFAULT true;
