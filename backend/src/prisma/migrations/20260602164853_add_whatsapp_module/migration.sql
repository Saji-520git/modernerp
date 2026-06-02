-- CreateTable
CREATE TABLE "whatsapp_config" (
    "id" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'WEB',
    "provider" TEXT NOT NULL DEFAULT 'NONE',
    "apiKey" TEXT,
    "apiSecret" TEXT,
    "phoneNumberId" TEXT,
    "businessId" TEXT,
    "twilioSid" TEXT,
    "twilioToken" TEXT,
    "twilioFrom" TEXT,
    "ownerPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT,
    "bodyEn" TEXT NOT NULL,
    "bodySi" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isEditable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_log" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "customerId" TEXT,
    "templateId" TEXT,
    "message" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_template_name_key" ON "whatsapp_template"("name");

-- CreateIndex
CREATE INDEX "whatsapp_log_customerId_idx" ON "whatsapp_log"("customerId");

-- CreateIndex
CREATE INDEX "whatsapp_log_status_idx" ON "whatsapp_log"("status");

-- CreateIndex
CREATE INDEX "whatsapp_log_createdAt_idx" ON "whatsapp_log"("createdAt");
