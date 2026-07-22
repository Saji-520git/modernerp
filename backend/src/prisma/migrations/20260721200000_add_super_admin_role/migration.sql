-- Add the vendor SUPER_ADMIN role (above the client's ADMIN). Idempotent.
-- Postgres 12+ supports ADD VALUE IF NOT EXISTS; the value is only added here,
-- not used in this same migration, so it commits cleanly.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
