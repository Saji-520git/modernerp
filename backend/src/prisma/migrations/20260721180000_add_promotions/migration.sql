-- Promotions module (optional feature "promotions"). Additive + idempotent.
-- Two new tables; no changes to existing tables' columns. Money in integer cents.

CREATE TABLE IF NOT EXISTS "promotions" (
  "id"               TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "description"      TEXT,
  "type"             TEXT NOT NULL DEFAULT 'PERCENT_OFF',
  "scope"            TEXT NOT NULL DEFAULT 'ALL',
  "scopeCategoryId"  TEXT,
  "scopeBrandId"     TEXT,
  "scopeProductId"   TEXT,
  "value"            INTEGER NOT NULL DEFAULT 0,
  "minQty"           DECIMAL(18,4),
  "minCartCents"     INTEGER,
  "startsAt"         TIMESTAMP(3),
  "endsAt"           TIMESTAMP(3),
  "priority"         INTEGER NOT NULL DEFAULT 0,
  "stackable"        BOOLEAN NOT NULL DEFAULT false,
  "maxDiscountCents" INTEGER,
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "usageLimit"       INTEGER,
  "timesUsed"        INTEGER NOT NULL DEFAULT 0,
  "createdById"      TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "promotions_active_idx" ON "promotions" ("active");
CREATE INDEX IF NOT EXISTS "promotions_scope_idx"  ON "promotions" ("scope");

CREATE TABLE IF NOT EXISTS "sale_promotions" (
  "id"            TEXT NOT NULL,
  "saleId"        TEXT NOT NULL,
  "promotionId"   TEXT NOT NULL,
  "label"         TEXT NOT NULL,
  "discountCents" INTEGER NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sale_promotions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sale_promotions_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "sale_promotions_promotionId_fkey"
    FOREIGN KEY ("promotionId") REFERENCES "promotions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "sale_promotions_saleId_idx"      ON "sale_promotions" ("saleId");
CREATE INDEX IF NOT EXISTS "sale_promotions_promotionId_idx" ON "sale_promotions" ("promotionId");
