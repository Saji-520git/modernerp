-- Where WhatsApp deep-links open: "app" (WhatsApp Desktop) | "browser" (wa.me).
-- Additive + idempotent. Default 'app' opens the desktop app directly.
ALTER TABLE "app_settings"
  ADD COLUMN IF NOT EXISTS "whatsappOpenMode" TEXT NOT NULL DEFAULT 'app';
