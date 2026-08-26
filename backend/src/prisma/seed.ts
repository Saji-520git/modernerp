import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_UNITS } from '../utils/default-units.js';
import { SETTINGS_ID } from '../modules/settings/settings.service.js';

const prisma = new PrismaClient();

async function main() {

  // ── Vendor super-admin ───────────────────────────────────────────────────
  //
  // The ONLY account a fresh install carries. It belongs to the vendor, not the
  // client: it is the account that turns optional modules on, and users.service
  // hides SUPER_ADMIN rows from everyone who is not one, so the client never
  // sees it in User Management. The client's own ADMIN is created from here,
  // after signing in once.
  //
  // Overridable by env so a deployment can carry its own credentials without
  // this file — and so the password is not forced to live in git.
  const superEmail = process.env.SUPER_ADMIN_EMAIL    ?? 'modernerp@gmail.com';
  const superPass  = process.env.SUPER_ADMIN_PASSWORD ?? 'superadmin123';
  await prisma.user.upsert({
    where:  { email: superEmail },
    update: {},
    create: {
      email:        superEmail,
      passwordHash: await bcrypt.hash(superPass, 12),
      fullName:     'System Administrator',
      role:         'SUPER_ADMIN',
    },
  });

  // ── Units ────────────────────────────────────────────────────────────────
  for (const u of DEFAULT_UNITS) {
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
  // AppSettings is a singleton keyed by SETTINGS_ID ('singleton') — every read
  // in the app is findUnique({ id: SETTINGS_ID }) and settingsService upserts
  // that exact id. Seeding with findFirst() + create() minted a SECOND row
  // under a generated cuid that nothing ever read: the app then upserted
  // 'singleton' with bare schema defaults, so every value seeded here —
  // business name, address, receipt footer, invoice prefix, tax flags — was
  // silently discarded. The two rows can also hold contradictory settings, and
  // data-management's backup uses findMany(), so a restore faithfully
  // recreates the duplicate.
  //
  // Upserting the real id makes the seed authoritative on a fresh install and
  // idempotent on an existing one: an empty update never overwrites settings
  // an operator has since changed.
  await prisma.appSettings.upsert({
    where:  { id: SETTINGS_ID },
    update: {},
    create: {
      id: SETTINGS_ID,
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

  process.stdout.write('✅ Seed complete — system ready for deployment\n');
  // The account itself is named, never its password: seed output is routinely
  // pasted into logs and tickets, and this one unlocks the module switches.
  process.stdout.write(`   ⚠️  Super-admin: ${superEmail} (password from SUPER_ADMIN_PASSWORD, or the seed default)\n`);
  process.stdout.write('   ⚠️  Sign in once and create the client ADMIN from User Management.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());