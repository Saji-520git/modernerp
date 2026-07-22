-- Loyalty module (optional feature "loyalty"). Adopts the v2 physical shape.
-- Fully idempotent: no-op where the tables/columns already exist (this dev DB),
-- creates them on fresh/ACM databases. Money & points are integers.

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "loyaltyPoints"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Sale"     ADD COLUMN IF NOT EXISTS "pointsEarned"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Sale"     ADD COLUMN IF NOT EXISTS "pointsRedeemed" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "LoyaltyConfig" (
  "id"              TEXT NOT NULL,
  "isEnabled"       BOOLEAN NOT NULL DEFAULT true,
  "pointsPerAmount" INTEGER NOT NULL DEFAULT 100,
  "amountPerPoint"  INTEGER NOT NULL DEFAULT 100,
  "minRedeemPoints" INTEGER NOT NULL DEFAULT 100,
  "pointValueCents" INTEGER NOT NULL DEFAULT 100,
  "expiryDays"      INTEGER,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LoyaltyConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LoyaltyTransaction" (
  "id"            TEXT NOT NULL,
  "customerId"    TEXT NOT NULL,
  "saleId"        TEXT,
  "type"          TEXT NOT NULL,
  "points"        INTEGER NOT NULL,
  "balanceBefore" INTEGER NOT NULL,
  "balanceAfter"  INTEGER NOT NULL,
  "note"          TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoyaltyTransaction_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LoyaltyTransaction_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_customerId_idx" ON "LoyaltyTransaction" ("customerId");
CREATE INDEX IF NOT EXISTS "LoyaltyTransaction_saleId_idx"     ON "LoyaltyTransaction" ("saleId");
