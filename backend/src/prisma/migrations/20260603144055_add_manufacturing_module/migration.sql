-- CreateTable
CREATE TABLE "BOM" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "yieldQty" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BOM_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BOMLine" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "qty" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BOMLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "bomId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalCostCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "plannedQty" DECIMAL(18,4) NOT NULL,
    "actualQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitCostCents" INTEGER NOT NULL DEFAULT 0,
    "lineCostCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BOM_productId_key" ON "BOM"("productId");

-- CreateIndex
CREATE INDEX "BOM_productId_idx" ON "BOM"("productId");

-- CreateIndex
CREATE INDEX "BOMLine_bomId_idx" ON "BOMLine"("bomId");

-- CreateIndex
CREATE INDEX "BOMLine_materialId_idx" ON "BOMLine"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionOrder_number_key" ON "ProductionOrder"("number");

-- CreateIndex
CREATE INDEX "ProductionOrder_productId_idx" ON "ProductionOrder"("productId");

-- CreateIndex
CREATE INDEX "ProductionOrder_warehouseId_idx" ON "ProductionOrder"("warehouseId");

-- CreateIndex
CREATE INDEX "ProductionOrder_status_idx" ON "ProductionOrder"("status");

-- CreateIndex
CREATE INDEX "ProductionOrder_createdAt_idx" ON "ProductionOrder"("createdAt");

-- CreateIndex
CREATE INDEX "ProductionOrderLine_orderId_idx" ON "ProductionOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "ProductionOrderLine_materialId_idx" ON "ProductionOrderLine"("materialId");

-- AddForeignKey
ALTER TABLE "BOM" ADD CONSTRAINT "BOM_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOMLine" ADD CONSTRAINT "BOMLine_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "BOM"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOMLine" ADD CONSTRAINT "BOMLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrder" ADD CONSTRAINT "ProductionOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ProductionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionOrderLine" ADD CONSTRAINT "ProductionOrderLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
