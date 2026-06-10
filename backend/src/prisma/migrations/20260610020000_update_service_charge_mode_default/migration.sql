-- AlterColumn default
ALTER TABLE "Product" ALTER COLUMN "serviceChargeMode" SET DEFAULT 'per_unit';

-- Migrate legacy values: old "per_item" now multiplies by qty → "per_unit"
UPDATE "Product" SET "serviceChargeMode" = 'per_unit' WHERE "serviceChargeMode" = 'per_item';
