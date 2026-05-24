-- Migration: Replace WALLET and OTHER with QR_PAY in PaymentMethod enum

-- Step 1: Drop column defaults that reference the old enum
ALTER TABLE "Sale"    ALTER COLUMN "paymentMethod" DROP DEFAULT;
ALTER TABLE "PosDraft" ALTER COLUMN "paymentMethod" DROP DEFAULT;

-- Step 2: Cast columns to text so we can update values freely
ALTER TABLE "Sale"    ALTER COLUMN "paymentMethod" TYPE TEXT USING "paymentMethod"::TEXT;
ALTER TABLE "PosDraft" ALTER COLUMN "paymentMethod" TYPE TEXT USING "paymentMethod"::TEXT;

-- Step 3: Convert any legacy WALLET/OTHER values to CASH
UPDATE "Sale"     SET "paymentMethod" = 'CASH' WHERE "paymentMethod" IN ('WALLET', 'OTHER');
UPDATE "PosDraft" SET "paymentMethod" = 'CASH' WHERE "paymentMethod" IN ('WALLET', 'OTHER');

-- Step 4: Drop the old enum (safe now — no dependents)
DROP TYPE "PaymentMethod";

-- Step 5: Create the new enum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'QR_PAY', 'CREDIT');

-- Step 6: Restore typed columns with new enum
ALTER TABLE "Sale"    ALTER COLUMN "paymentMethod" TYPE "PaymentMethod" USING "paymentMethod"::"PaymentMethod";
ALTER TABLE "PosDraft" ALTER COLUMN "paymentMethod" TYPE "PaymentMethod" USING "paymentMethod"::"PaymentMethod";

-- Step 7: Restore defaults
ALTER TABLE "Sale"    ALTER COLUMN "paymentMethod" SET DEFAULT 'CASH'::"PaymentMethod";
ALTER TABLE "PosDraft" ALTER COLUMN "paymentMethod" SET DEFAULT 'CASH'::"PaymentMethod";
