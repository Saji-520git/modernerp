import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { whatsappService } from '../modules/whatsapp/whatsapp.service.js';

const prisma = new PrismaClient();

async function main() {

  // ── Admin User ───────────────────────────────────────────────────────────
  const adminPass = await bcrypt.hash('admin123', 12);
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

  // ── Units ────────────────────────────────────────────────────────────────
  const units = [
    { name: 'Piece',      shortCode: 'pcs',  allowDecimal: false, type: 'COUNT'  as const },
    { name: 'Kilogram',   shortCode: 'kg',   allowDecimal: true,  type: 'WEIGHT' as const },
    { name: 'Gram',       shortCode: 'g',    allowDecimal: true,  type: 'WEIGHT' as const },
    { name: 'Liter',      shortCode: 'l',    allowDecimal: true,  type: 'VOLUME' as const },
    { name: 'Milliliter', shortCode: 'ml',   allowDecimal: true,  type: 'VOLUME' as const },
    { name: 'Box',        shortCode: 'box',  allowDecimal: false, type: 'COUNT'  as const },
    { name: 'Pack',       shortCode: 'pack', allowDecimal: false, type: 'COUNT'  as const },
    { name: 'Carton',     shortCode: 'ctn',  allowDecimal: false, type: 'COUNT'  as const },
    { name: 'Bottle',     shortCode: 'btl',  allowDecimal: false, type: 'COUNT'  as const },
    { name: 'Bag',        shortCode: 'bag',  allowDecimal: false, type: 'COUNT'  as const },
    { name: 'Case',       shortCode: 'case', allowDecimal: false, type: 'COUNT'  as const },
  ];

  for (const u of units) {
    await prisma.unit.upsert({
      where: { shortCode: u.shortCode },
      update: { isActive: true },
      create: u,
    });
  }

  // ── Default Warehouse ────────────────────────────────────────────────────
  await prisma.warehouse.upsert({
    where: { code: 'MAIN' },
    update: {},
    create: {
      name: 'Main Warehouse',
      code: 'MAIN',
      isDefault: true,
    },
  });

  // ── AppSettings defaults ─────────────────────────────────────────────────
  const existing = await prisma.appSettings.findFirst();
  if (!existing) {
    await prisma.appSettings.create({
      data: {
        businessName:        'ACM Groceries',
        businessAddress:     'Hurimaluwa, Rambukkana',
        businessPhone:       '0752345685',
        currencySymbol:      'Rs.',
        currencyCode:        'LKR',
        currencyPosition:    'before',
        posReceiptFooter:    'Thank You! Come Again',
        taxEnabled:          true,
        receiptShowTax:      true,
        receiptShowBarcode:  true,
        receiptShowCashier:  true,
        receiptLanguage:     'en',
        receiptPaperWidth:   '80mm',
        invoicePrefix:       'INV',
        invoiceStartNo:      1,
        purchasePrefix:      'PO',
        invoiceShowLogo:     false,
        posRequireShift:     true,
        posAllowDiscount:    true,
        posMaxDiscountPct:   100,
        posPrintReceipt:     true,
        alertLowStockEnabled:   true,
        alertExpiryEnabled:     true,
        alertExpiryDays:        30,
        alertShowInDashboard:   true,
        alertBellEnabled:       true,
        sessionTimeoutMin:      60,
      },
    });
  }

  // ── WhatsApp default templates ───────────────────────────────────────────
  const tplCreated = await whatsappService.seedDefaultTemplates();
  process.stdout.write(`   📱 WhatsApp templates seeded (${tplCreated} new)\n`);

  process.stdout.write('✅ Seed complete — system ready for deployment\n');
  process.stdout.write('   ⚠️  Login: admin@modernerp.local / admin123\n');
  process.stdout.write('   ⚠️  CHANGE PASSWORD immediately via User Management!\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());