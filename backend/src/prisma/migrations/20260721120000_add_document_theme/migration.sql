-- PDF document theme (dark | light), selectable per business.
-- Additive + idempotent. Default 'light' (ink-friendly white letterhead).
ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "documentTheme" TEXT NOT NULL DEFAULT 'light';
