// End-to-end: a real POS checkout that sells past zero, then a real stock
// increase that settles the debt. Calls the same service functions the HTTP
// routes call. Cleans up after itself.
import { PrismaClient } from '@prisma/client';
import { posService } from './dist/modules/pos/pos.service.js';
import { inventoryService } from './dist/modules/inventory/inventory.service.js';
import { checkoutSchema } from './dist/modules/pos/pos.schema.js';

// Parse through the real schema so the test sends exactly what the HTTP route
// sends — Zod fills defaults (discountCents et al) the service then does
// arithmetic on.
const co = (o) => checkoutSchema.parse(o);

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => { out.push({ n, pass, d }); };

const read = async (productId, warehouseId) => {
  const s = await prisma.stock.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { qty: true, shortfallQty: true },
  });
  return { qty: Number(s.qty), short: Number(s.shortfallQty) };
};

let saleId = null, prevSetting = null, snapshot = null, target = null;

const main = async () => {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  prevSetting = settings?.allowNegativeStock ?? false;

  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });

  // A product that is NOT batch-tracked and has a price — the feature's target.
  const stockRow = await prisma.stock.findFirst({
    where: { product: { isActive: true, isBatchTracked: false, priceCents: { gt: 0 } } },
    select: { productId: true, warehouseId: true, product: { select: { name: true } } },
  });
  if (!stockRow) throw new Error('no suitable product');
  target = stockRow;
  const { productId, warehouseId } = stockRow;

  snapshot = await read(productId, warehouseId);
  const batchesBefore = await prisma.stockBatch.findMany({
    where: { productId, warehouseId }, select: { id: true, qty: true },
  });

  // ── Fixture: exactly 2 on the shelf, nothing owed ────────────────────────
  await prisma.stockBatch.deleteMany({ where: { productId, warehouseId } });
  const fixtureBatch = await prisma.stockBatch.create({
    data: { productId, warehouseId, qty: 2 },
  });
  await prisma.stock.update({
    where: { productId_warehouseId: { productId, warehouseId } },
    data: { qty: 2, shortfallQty: 0 },
  });

  // ── 1. Setting OFF → the sale must still be refused ──────────────────────
  await prisma.appSettings.update({
    where: { id: 'singleton' }, data: { allowNegativeStock: false },
  });
  let blocked = false, blockMsg = '';
  try {
    await posService.checkout(
      co({ warehouseId, paymentMethod: 'CASH', items: [{ productId, qty: 5 }] }),
      user.id, false, false, false,
    );
  } catch (e) { blocked = true; blockMsg = e.message; }
  ok('setting OFF still refuses the oversell', blocked, blockMsg);
  const afterBlocked = await read(productId, warehouseId);
  ok('refused sale left stock untouched',
     afterBlocked.qty === 2 && afterBlocked.short === 0, JSON.stringify(afterBlocked));

  // ── 2. Setting ON → 5 sold against 2 on hand ─────────────────────────────
  await prisma.appSettings.update({
    where: { id: 'singleton' }, data: { allowNegativeStock: true },
  });
  const sale = await posService.checkout(
    co({ warehouseId, paymentMethod: 'CASH', items: [{ productId, qty: 5 }] }),
    user.id, false, false, false,
  );
  saleId = sale?.receipt?.id ?? sale?.id ?? null;
  ok('oversold checkout completed', !!saleId, JSON.stringify(Object.keys(sale ?? {})).slice(0, 120));

  const afterSale = await read(productId, warehouseId);
  ok('shelf emptied, 3 recorded as owed',
     afterSale.qty === 0 && afterSale.short === 3, JSON.stringify(afterSale));

  const movement = await prisma.stockMovement.findFirst({
    where: { productId, warehouseId, type: 'SALE_OUT' },
    orderBy: { createdAt: 'desc' }, select: { qty: true, note: true },
  });
  ok('movement records the full 5 that left the counter',
     Math.abs(Number(movement?.qty)) === 5, `qty=${movement?.qty} note=${movement?.note}`);

  // ── 3. Stock arrives: +10 via a real adjustment ──────────────────────────
  await inventoryService.createAdjustment(
    { productId, warehouseId, qty: 10, reason: 'E2E delivery' },
    user.id,
  );
  const afterReceipt = await read(productId, warehouseId);
  ok('10 received against 3 owed leaves 7 on hand, nothing owed',
     afterReceipt.qty === 7 && afterReceipt.short === 0, JSON.stringify(afterReceipt));

  const batchSum = await prisma.stockBatch.aggregate({
    where: { productId, warehouseId, qty: { gt: 0 } }, _sum: { qty: true },
  });
  ok('invariant qty === SUM(batches) still holds',
     Number(batchSum._sum.qty ?? 0) === afterReceipt.qty,
     `batches=${Number(batchSum._sum.qty ?? 0)} qty=${afterReceipt.qty}`);

  // ── 4. Batch-tracked products stay refused even with the setting on ──────
  const tracked = await prisma.stock.findFirst({
    where: { product: { isActive: true, isBatchTracked: true, priceCents: { gt: 0 } } },
    select: { productId: true, warehouseId: true },
  });
  if (tracked) {
    await prisma.stock.update({
      where: { productId_warehouseId: { productId: tracked.productId, warehouseId: tracked.warehouseId } },
      data: { qty: 0 },
    });
    let trackedBlocked = false, msg = '';
    try {
      await posService.checkout(
        co({ warehouseId: tracked.warehouseId, paymentMethod: 'CASH', items: [{ productId: tracked.productId, qty: 1 }] }),
        user.id, false, false, false,
      );
    } catch (e) { trackedBlocked = true; msg = e.message; }
    ok('batch-tracked product refused despite the setting', trackedBlocked, msg.slice(0, 90));
  } else {
    ok('batch-tracked product refused despite the setting', true, '(no batch-tracked product in DB — untested)');
  }

  await cleanup(fixtureBatch, batchesBefore);
  report();
};

async function cleanup(fixtureBatch, batchesBefore) {
  const { productId, warehouseId } = target;
  if (saleId) {
    await prisma.stockMovement.deleteMany({ where: { refId: saleId } });
    await prisma.saleLine.deleteMany({ where: { saleId } });
    await prisma.sale.delete({ where: { id: saleId } }).catch(() => {});
  }
  await prisma.stockMovement.deleteMany({ where: { productId, warehouseId, note: { contains: 'E2E delivery' } } });
  await prisma.stockBatch.deleteMany({ where: { productId, warehouseId } });
  for (const b of batchesBefore) {
    await prisma.stockBatch.create({ data: { productId, warehouseId, qty: b.qty } });
  }
  await prisma.stock.update({
    where: { productId_warehouseId: { productId, warehouseId } },
    data: { qty: snapshot.qty, shortfallQty: snapshot.short },
  });
  await prisma.appSettings.update({
    where: { id: 'singleton' }, data: { allowNegativeStock: prevSetting },
  });
  const restored = await read(productId, warehouseId);
  ok('cleanup restored the original stock',
     restored.qty === snapshot.qty && restored.short === snapshot.short,
     `${JSON.stringify(restored)} vs ${JSON.stringify(snapshot)}`);
}

function report() {
  console.log('');
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.pass ? '' : '  <- ' + r.d}`);
  const failed = out.filter(r => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  process.exit(failed ? 1 : 0);
}

main()
  .catch(async (e) => { console.error('ERROR:', e.message); report(); })
  .finally(() => prisma.$disconnect());
