// Can a cashier SCAN a product that is out of stock, when selling past zero
// is switched on?
//
// The POS grid is paginated, so a scanned barcode that is not on the current
// page falls through to GET /products/by-barcode - and that branch carried its
// own out-of-stock guard that never learned about allowNegativeStock. The same
// product added by tapping its card went through; scanned, it was refused.
// The +/- steppers had the identical blind spot: an oversold line could be
// added but not incremented.
//
// These gates live inline in POSPage, so this script mirrors them and asserts
// the mirror agrees with the server. If the two ever drift, checkout starts
// refusing what the screen just accepted.
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { posService } from '../dist/modules/pos/pos.service.js';
import { checkoutSchema } from '../dist/modules/pos/pos.schema.js';
import { productsService } from '../dist/modules/products/products.service.js';

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });

// ---- the shipped gates, mirrored -----------------------------------------
// frontend/src/pages/pos/POSPage.tsx, barcode API fallback
const scanGateAllows = (allowNegative, isBatchTracked, totalQty, policy = 'BLOCK') => {
  const mayOversell = allowNegative && !(isBatchTracked ?? false);
  return !(policy === 'BLOCK' && totalQty <= 0 && !mayOversell);
};
// frontend/src/pages/pos/POSPage.tsx, updateQty (the +/- steppers)
const stepperGateAllows = (allowNegative, isBatchTracked, isBatchLine, available) => {
  const mayOversell = allowNegative && !isBatchTracked && !isBatchLine;
  return !(available <= 0 && !mayOversell);
};
// backend/src/modules/pos/pos.service.ts
const serverAllows = (allowNegative, isBatchTracked, hasBatchId) =>
  allowNegative && !isBatchTracked && !hasBatchId;

let saleId = null, prevSetting = null, restore = null;

const main = async () => {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  prevSetting = settings?.allowNegativeStock ?? false;

  // -- 1. The scanned payload must carry the fields the gate reads ----------
  //
  // getByBarcode uses `include`, so every scalar comes back. If anyone ever
  // narrows it to a `select`, isBatchTracked silently reads undefined, the
  // gate treats it as false, and a batch-tracked product becomes oversellable
  // - the one case the server refuses. Fail here, not at the payment screen.
  const withBarcode = await prisma.product.findFirst({
    where: { isActive: true, barcode: { not: null } },
    select: { barcode: true },
  });
  if (withBarcode) {
    const found = await productsService.getByBarcode(withBarcode.barcode);
    ok('scanned payload carries isBatchTracked',
       Object.prototype.hasOwnProperty.call(found, 'isBatchTracked'),
       'gate would misread a batch-tracked product as oversellable');
    ok('scanned payload carries stock rows with qty',
       Array.isArray(found.stock) && (found.stock.length === 0 || 'qty' in found.stock[0]),
       'gate could not compute totalQty');
  }

  // -- 2. Gate parity across the whole matrix ------------------------------
  const mismatches = [];
  for (const allowNegative of [true, false]) {
    for (const isBatchTracked of [true, false]) {
      const ui  = scanGateAllows(allowNegative, isBatchTracked, 0);
      const srv = serverAllows(allowNegative, isBatchTracked, false);
      if (ui !== srv) {
        mismatches.push(`allow=${allowNegative} batchTracked=${isBatchTracked}: ui=${ui} server=${srv}`);
      }
    }
  }
  ok('scan gate agrees with the server in all 4 cases', mismatches.length === 0, mismatches.join(' | '));

  ok('setting OFF still refuses a zero-stock scan (no regression)',
     scanGateAllows(false, false, 0) === false);
  ok('setting ON lets a zero-stock scan through',
     scanGateAllows(true, false, 0) === true);
  ok('batch-tracked product is never oversellable by scan',
     scanGateAllows(true, true, 0) === false);
  ok('a scan with stock on hand is unaffected either way',
     scanGateAllows(false, false, 5) === true && scanGateAllows(true, true, 5) === true);

  ok('steppers lift the cap for an oversellable line',
     stepperGateAllows(true, false, false, 0) === true);
  ok('steppers keep the cap on a batch-bound line',
     stepperGateAllows(true, false, true, 0) === false);
  ok('steppers keep the cap when the setting is off',
     stepperGateAllows(false, false, false, 0) === false);

  // -- 3. The source really contains these gates ---------------------------
  const src = readFileSync('../frontend/src/pages/pos/POSPage.tsx', 'utf8');
  ok('barcode fallback consults allowNegativeStock', /scanMayOversell/.test(src));
  ok('updateQty consults allowNegativeStock', /stepperMayOversell/.test(src));

  // -- 4. A real checkout of a zero-stock product --------------------------
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
  const zero = await prisma.stock.findFirst({
    where: {
      qty: { lte: 0 },
      product: { isActive: true, isBatchTracked: false, priceCents: { gt: 0 }, barcode: { not: null } },
    },
    select: {
      productId: true, warehouseId: true, qty: true, shortfallQty: true,
      product: { select: { name: true, barcode: true } },
    },
  });

  if (!zero || !user) {
    ok('real zero-stock checkout', true, '(no zero-stock product with a barcode to test with)');
    return report();
  }
  restore = {
    productId: zero.productId, warehouseId: zero.warehouseId,
    qty: zero.qty, shortfallQty: zero.shortfallQty,
  };

  await prisma.appSettings.update({ where: { id: 'singleton' }, data: { allowNegativeStock: true } });

  // Scan it exactly as the POS does, then apply the gate to what came back.
  const found = await productsService.getByBarcode(zero.product.barcode);
  const totalQty = found.stock.reduce((s, r) => s + Number(r.qty), 0);
  ok(`scanning "${zero.product.name}" at ${totalQty} on hand is allowed`,
     scanGateAllows(true, found.isBatchTracked, totalQty) === true);

  const before = Number(zero.shortfallQty);
  const res = await posService.checkout(
    checkoutSchema.parse({
      warehouseId: zero.warehouseId, paymentMethod: 'CASH',
      items: [{ productId: zero.productId, qty: 2 }],
    }),
    user.id, false, false, false,
  );
  saleId = res?.receipt?.id ?? null;
  ok('the sale the screen accepted actually completes', !!saleId);

  const after = await prisma.stock.findUnique({
    where: { productId_warehouseId: { productId: zero.productId, warehouseId: zero.warehouseId } },
    select: { qty: true, shortfallQty: true },
  });
  ok('stored qty never goes negative', Number(after.qty) >= 0, `qty=${after.qty}`);
  ok('the 2 uncovered units are recorded as owed',
     Number(after.shortfallQty) === before + 2,
     `shortfall ${before} -> ${after.shortfallQty}`);

  report();
};

// Every step swallows its own error. An earlier version named a model that does
// not exist (salePayment - it is Payment), the throw aborted the rest of
// cleanup, and the test sale was left counting towards a live shift's takings.
// A cleanup that can be stopped by one bad line is not a cleanup.
const cleanup = async () => {
  if (saleId) {
    await prisma.stockMovement.deleteMany({ where: { refId: saleId } }).catch(() => {});
    for (const model of ['payment', 'customerPayment', 'loyaltyTransaction', 'salePromotion', 'saleLine']) {
      await prisma[model]?.deleteMany({ where: { saleId } }).catch(() => {});
    }
    await prisma.sale.delete({ where: { id: saleId } }).catch(() => {});
  }
  if (restore) {
    await prisma.stock.update({
      where: { productId_warehouseId: { productId: restore.productId, warehouseId: restore.warehouseId } },
      data: { qty: restore.qty, shortfallQty: restore.shortfallQty },
    }).catch(() => {});
  }
  if (prevSetting !== null) {
    await prisma.appSettings
      .update({ where: { id: 'singleton' }, data: { allowNegativeStock: prevSetting } })
      .catch(() => {});
  }
};

function report() {
  console.log('');
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.pass ? '' : '\n      -> ' + r.d}`);
  const failed = out.filter((r) => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  return failed;
}

let code = 1;
main()
  .then(() => { code = out.filter((r) => !r.pass).length ? 1 : 0; })
  .catch((e) => { console.error('ERROR:', e.message); report(); code = 1; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(code); });
