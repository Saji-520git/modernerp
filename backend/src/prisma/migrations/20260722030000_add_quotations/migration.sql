-- Quotations module (optional feature "quotations"). Adopts the v2 physical
-- shape. Fully idempotent: no-op where the tables already exist (this dev DB,
-- 0 rows), creating them on fresh/ACM databases. Money in integer cents.

CREATE TABLE IF NOT EXISTS "Quotation" (
  "id"                TEXT NOT NULL,
  "number"            TEXT NOT NULL,
  "customerId"        TEXT,
  "title"             TEXT,
  "status"            TEXT NOT NULL DEFAULT 'DRAFT',
  "validUntil"        TIMESTAMP(3),
  "subtotalCents"     INTEGER NOT NULL DEFAULT 0,
  "discountCents"     INTEGER NOT NULL DEFAULT 0,
  "taxCents"          INTEGER NOT NULL DEFAULT 0,
  "totalCents"        INTEGER NOT NULL DEFAULT 0,
  "note"              TEXT,
  "termsConditions"   TEXT,
  "convertedToSaleId" TEXT,
  "convertedAt"       TIMESTAMP(3),
  "createdById"       TEXT NOT NULL,
  "deletedAt"         TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Quotation_customerId_fkey"  FOREIGN KEY ("customerId")  REFERENCES "Customer" ("id") ON DELETE SET NULL  ON UPDATE CASCADE,
  CONSTRAINT "Quotation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id")     ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Quotation_customerId_idx" ON "Quotation" ("customerId");
CREATE INDEX IF NOT EXISTS "Quotation_status_idx"     ON "Quotation" ("status");

CREATE TABLE IF NOT EXISTS "QuotationLine" (
  "id"             TEXT NOT NULL,
  "quotationId"    TEXT NOT NULL,
  "productId"      TEXT,
  "description"    TEXT NOT NULL,
  "qty"            DOUBLE PRECISION NOT NULL DEFAULT 1,
  "unitLabel"      TEXT NOT NULL DEFAULT 'pcs',
  "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
  "discountCents"  INTEGER NOT NULL DEFAULT 0,
  "totalCents"     INTEGER NOT NULL DEFAULT 0,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation" ("id") ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT "QuotationLine_productId_fkey"   FOREIGN KEY ("productId")   REFERENCES "Product" ("id")   ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "QuotationLine_quotationId_idx" ON "QuotationLine" ("quotationId");
