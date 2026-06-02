-- CreateTable
CREATE TABLE "client_config" (
    "id" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "businessType" TEXT NOT NULL DEFAULT 'general',
    "modules" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_config_pkey" PRIMARY KEY ("id")
);
