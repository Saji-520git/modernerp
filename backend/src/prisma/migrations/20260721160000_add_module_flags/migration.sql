-- Optional feature module on/off map, per business (promotions, stockTake,
-- loyalty, quotations). Additive + idempotent. Default '{}' = all optional
-- features off until explicitly enabled in Settings > Modules.
ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "moduleFlags" JSONB NOT NULL DEFAULT '{}';
