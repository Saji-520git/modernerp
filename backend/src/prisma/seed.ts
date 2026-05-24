import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // ── Users ────────────────────────────────────────────────────────────────
  const adminPass = await bcrypt.hash('admin123', 12);
  const cashierPass = await bcrypt.hash('cashier123', 12);

  await prisma.user.upsert({
    where: { email: 'admin@modernerp.local' },
    update: {},
    create: {
      email: 'admin@modernerp.local',
      passwordHash: adminPass,
      fullName: 'System Admin',
      role: 'ADMIN',
    },
  });

  await prisma.user.upsert({
    where: { email: 'cashier@modernerp.local' },
    update: {},
    create: {
      email: 'cashier@modernerp.local',
      passwordHash: cashierPass,
      fullName: 'Demo Cashier',
      role: 'CASHIER',
    },
  });

  // ── Units ────────────────────────────────────────────────────────────────
  const pcs = await prisma.unit.upsert({
    where: { shortCode: 'pcs' },
    update: { type: 'COUNT', isActive: true },
    create: { name: 'Piece', shortCode: 'pcs', allowDecimal: false, type: 'COUNT' },
  });

  const kg = await prisma.unit.upsert({
    where: { shortCode: 'kg' },
    update: { type: 'WEIGHT', isActive: true },
    create: { name: 'Kilogram', shortCode: 'kg', allowDecimal: true, type: 'WEIGHT' },
  });

  const box = await prisma.unit.upsert({
    where: { shortCode: 'box' },
    update: { type: 'COUNT', isActive: true },
    create: { name: 'Box', shortCode: 'box', allowDecimal: false, type: 'COUNT' },
  });

  // Additional units from spec
  const pack = await prisma.unit.upsert({
    where: { shortCode: 'pack' },
    update: { type: 'COUNT', isActive: true },
    create: { name: 'Pack', shortCode: 'pack', allowDecimal: false, type: 'COUNT' },
  });

  const ctn = await prisma.unit.upsert({
    where: { shortCode: 'ctn' },
    update: { type: 'COUNT', isActive: true },
    create: { name: 'Carton', shortCode: 'ctn', allowDecimal: false, type: 'COUNT' },
  });

  const _case = await prisma.unit.upsert({
    where: { shortCode: 'case' },
    update: { type: 'COUNT', isActive: true },
    create: { name: 'Case', shortCode: 'case', allowDecimal: false, type: 'COUNT' },
  });

  const btl = await prisma.unit.upsert({
    where: { shortCode: 'btl' },
    update: { type: 'COUNT', isActive: true },
    create: { name: 'Bottle', shortCode: 'btl', allowDecimal: false, type: 'COUNT' },
  });

  const bag = await prisma.unit.upsert({
    where: { shortCode: 'bag' },
    update: { type: 'COUNT', isActive: true },
    create: { name: 'Bag', shortCode: 'bag', allowDecimal: false, type: 'COUNT' },
  });

  const g = await prisma.unit.upsert({
    where: { shortCode: 'g' },
    update: { type: 'WEIGHT', isActive: true },
    create: { name: 'Gram', shortCode: 'g', allowDecimal: true, type: 'WEIGHT' },
  });

  const liter = await prisma.unit.upsert({
    where: { shortCode: 'l' },
    update: { type: 'VOLUME', isActive: true },
    create: { name: 'Liter', shortCode: 'l', allowDecimal: true, type: 'VOLUME' },
  });

  const ml = await prisma.unit.upsert({
    where: { shortCode: 'ml' },
    update: { type: 'VOLUME', isActive: true },
    create: { name: 'Milliliter', shortCode: 'ml', allowDecimal: true, type: 'VOLUME' },
  });

  // Suppress unused variable warnings
  void pack; void ctn; void _case; void btl; void bag; void g; void liter; void ml;

  // ── Warehouse ────────────────────────────────────────────────────────────
  const mainWh = await prisma.warehouse.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: { name: 'Main Warehouse', code: 'MAIN' },
  });

  // ── Categories ───────────────────────────────────────────────────────────
  const catBeverages = await prisma.category.upsert({
    where: { name: 'Beverages' },
    update: {},
    create: { name: 'Beverages' },
  });

  const catSnacks = await prisma.category.upsert({
    where: { name: 'Snacks' },
    update: {},
    create: { name: 'Snacks' },
  });

  const catDairy = await prisma.category.upsert({
    where: { name: 'Dairy' },
    update: {},
    create: { name: 'Dairy' },
  });

  const catElectronics = await prisma.category.upsert({
    where: { name: 'Electronics' },
    update: {},
    create: { name: 'Electronics' },
  });

  // ── Brands ───────────────────────────────────────────────────────────────
  const brandGeneric = await prisma.brand.upsert({
    where: { name: 'Generic' },
    update: {},
    create: { name: 'Generic' },
  });

  const brandFresh = await prisma.brand.upsert({
    where: { name: 'FreshFarm' },
    update: {},
    create: { name: 'FreshFarm' },
  });

  // ── Demo Products ─────────────────────────────────────────────────────────
  // Prices stored as integer cents (e.g. 150 = $1.50)
  const products = [
    {
      sku: 'BEV-001',
      barcode: '8901234560001',
      name: 'Mineral Water 500ml',
      categoryId: catBeverages.id,
      brandId: brandGeneric.id,
      unitId: pcs.id,
      baseUnitId: pcs.id,
      purchaseUnitId: box.id,
      salesUnitId: pcs.id,
      costCents: 30,
      priceCents: 75,
      taxPercent: 0,
      reorderLevel: 20,
      stockQty: 150,
    },
    {
      sku: 'BEV-002',
      barcode: '8901234560002',
      name: 'Orange Juice 1L',
      categoryId: catBeverages.id,
      brandId: brandFresh.id,
      unitId: pcs.id,
      baseUnitId: pcs.id,
      purchaseUnitId: null,
      salesUnitId: null,
      costCents: 120,
      priceCents: 250,
      taxPercent: 5,
      reorderLevel: 10,
      stockQty: 60,
    },
    {
      sku: 'BEV-003',
      barcode: '8901234560003',
      name: 'Cola Can 330ml',
      categoryId: catBeverages.id,
      brandId: brandGeneric.id,
      unitId: pcs.id,
      baseUnitId: pcs.id,
      purchaseUnitId: box.id,
      salesUnitId: pcs.id,
      costCents: 45,
      priceCents: 100,
      taxPercent: 5,
      reorderLevel: 24,
      stockQty: 240,
    },
    {
      sku: 'SNK-001',
      barcode: '8901234560004',
      name: 'Potato Chips 150g',
      categoryId: catSnacks.id,
      brandId: brandGeneric.id,
      unitId: pcs.id,
      baseUnitId: pcs.id,
      purchaseUnitId: null,
      salesUnitId: null,
      costCents: 80,
      priceCents: 175,
      taxPercent: 5,
      reorderLevel: 12,
      stockQty: 80,
    },
    {
      sku: 'SNK-002',
      barcode: '8901234560005',
      name: 'Chocolate Bar 50g',
      categoryId: catSnacks.id,
      brandId: brandGeneric.id,
      unitId: pcs.id,
      baseUnitId: pcs.id,
      purchaseUnitId: null,
      salesUnitId: null,
      costCents: 60,
      priceCents: 150,
      taxPercent: 5,
      reorderLevel: 10,
      stockQty: 100,
    },
    {
      sku: 'DAI-001',
      barcode: '8901234560006',
      name: 'Fresh Milk 1L',
      categoryId: catDairy.id,
      brandId: brandFresh.id,
      unitId: pcs.id,
      baseUnitId: pcs.id,
      purchaseUnitId: null,
      salesUnitId: null,
      costCents: 90,
      priceCents: 200,
      taxPercent: 0,
      reorderLevel: 15,
      stockQty: 45,
    },
    {
      sku: 'DAI-002',
      barcode: '8901234560007',
      name: 'Greek Yogurt 200g',
      categoryId: catDairy.id,
      brandId: brandFresh.id,
      unitId: pcs.id,
      baseUnitId: pcs.id,
      purchaseUnitId: null,
      salesUnitId: null,
      costCents: 110,
      priceCents: 250,
      taxPercent: 0,
      reorderLevel: 8,
      stockQty: 30,
    },
    {
      sku: 'ELC-001',
      barcode: '8901234560008',
      name: 'AA Battery (4-pack)',
      categoryId: catElectronics.id,
      brandId: brandGeneric.id,
      unitId: pcs.id,
      baseUnitId: pcs.id,
      purchaseUnitId: box.id,
      salesUnitId: pcs.id,
      costCents: 180,
      priceCents: 399,
      taxPercent: 10,
      reorderLevel: 5,
      stockQty: 50,
    },
    {
      sku: 'ELC-002',
      barcode: '8901234560009',
      name: 'USB-C Cable 1m',
      categoryId: catElectronics.id,
      brandId: brandGeneric.id,
      unitId: pcs.id,
      baseUnitId: pcs.id,
      purchaseUnitId: null,
      salesUnitId: null,
      costCents: 350,
      priceCents: 799,
      taxPercent: 10,
      reorderLevel: 5,
      stockQty: 25,
    },
    {
      sku: 'SNK-003',
      barcode: '8901234560010',
      name: 'Mixed Nuts 200g',
      categoryId: catSnacks.id,
      brandId: brandGeneric.id,
      unitId: pcs.id,
      baseUnitId: pcs.id,
      purchaseUnitId: null,
      salesUnitId: null,
      costCents: 200,
      priceCents: 450,
      taxPercent: 5,
      reorderLevel: 8,
      stockQty: 40,
    },
  ];

  for (const p of products) {
    const { stockQty, ...productData } = p;

    const product = await prisma.product.upsert({
      where: { sku: productData.sku },
      update: {},
      create: productData,
    });

    await prisma.stock.upsert({
      where: { productId_warehouseId: { productId: product.id, warehouseId: mainWh.id } },
      update: {},
      create: { productId: product.id, warehouseId: mainWh.id, qty: stockQty },
    });
  }

  // ── Demo unit conversions ─────────────────────────────────────────────────
  // Find the seeded products by SKU and add box→piece conversions
  const waterProduct = await prisma.product.findUnique({ where: { sku: 'BEV-001' } });
  const colaProduct  = await prisma.product.findUnique({ where: { sku: 'BEV-003' } });

  if (waterProduct?.baseUnitId) {
    await prisma.productUnitConversion.upsert({
      where: { productId_fromUnitId_toUnitId: { productId: waterProduct.id, fromUnitId: box.id, toUnitId: pcs.id } },
      update: { conversionQty: 12, isActive: true },
      create: { productId: waterProduct.id, fromUnitId: box.id, toUnitId: pcs.id, conversionQty: 12 },
    });
  }

  if (colaProduct?.baseUnitId) {
    await prisma.productUnitConversion.upsert({
      where: { productId_fromUnitId_toUnitId: { productId: colaProduct.id, fromUnitId: box.id, toUnitId: pcs.id } },
      update: { conversionQty: 24, isActive: true },
      create: { productId: colaProduct.id, fromUnitId: box.id, toUnitId: pcs.id, conversionQty: 24 },
    });
  }

  console.log('✅ Seed complete');
  // SECURITY: Default passwords are intentionally NOT logged here.
  // Change them immediately via Settings → Users after first login.
  console.log('   ⚠️  Change default passwords via User Management before going live!');
  console.log(`   ${products.length} demo products added with stock`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
