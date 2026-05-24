-- Add imageUrl column to Product table
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
