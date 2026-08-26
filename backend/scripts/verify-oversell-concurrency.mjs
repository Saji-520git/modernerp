// Two cashiers, one product, not enough stock, at the same instant.
//
// The claim under test: shortfallQty lives on the Stock row, so the
// SELECT ... FOR UPDATE already taken during checkout serialises the two and
// neither can lose the other's update. If that were wrong, the two increments
// would race and the recorded debt would come out short.
import { PrismaClient } from '@prisma/client';
import { posService } from '../dist/modules/pos/pos.service.js';
import { checkoutSchema } from '../dist/modules/pos/pos.schema.js';

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });
const co = (o) => checkoutSchema.parse(o);

const saleIds = [];
let snapshot = null, prevSetting = null, target = null, batchesBefore = [];

const read = async (productId, warehouseId) => {
  const s = await prisma.stock.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { qty: true, shortfallQty: true },
  });
  return { qty: Number(s.qty), short: Number(s.shortfallQty) };
};

const main = async () => {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  prevSetting = settings?.allowNegativeStock ?? false;
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });

  const row = await prisma.stock.findFirst({
    where: { product: { isActive: true, isBatchTracked: false, priceCents: { gt: 0 } } },
    select: { productId: true, warehouseId: true },
  });
  target = row;
  const { productId, warehouseId } = row;

  snapshot = await read(productId, warehouseId);
  batchesBefore = await prisma.stockBatch.findMany({
    where: { productId, warehouseId }, select: { qty: true },
  });

  // Fixture: 2 on the shelf, nothing owed, feature on.
  await prisma.stockBatch.deleteMany({ where: { productId, warehouseId } });
  await prisma.stockBatch.create({ data: { productId, warehouseId, qty: 2 } });
  await prisma.stock.update({
    where: { productId_warehouseId: { productId, warehouseId } },
    data: { qty: 2, shortfallQty: 0 },
  });
  await prisma.appSettings.update({
    where: { id: 'singleton' }, data: { allowNegativeStock: true },
  });

  // Two checkouts of 3, fired together. 6 sold against 2 on hand => 4 owed.
  const mk = () => posService.checkout(
    co({ warehouseId, paymentMethod: 'CASH', items: [{ productId, qty: 3 }] }),
    user.id, false, false, false,
  );
  const results = await Promise.allSettled([mk(), mk()]);

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value?.receipt?.id) saleIds.push(r.value.receipt.id);
  }
  const completed = results.filter(r => r.status === 'fulfilled').length;
  ok('both concurrent sales completed', completed === 2,
     results.map(r => r.status === 'rejected' ? r.reason?.message : 'ok').join(' | '));

  const after = await read(productId, warehouseId);
  ok('no lost update: 6 sold against 2 on hand records exactly 4 owed',
     after.qty === 0 && after.short === 4, JSON.stringify(after));

  const sold = await prisma.stockMovement.aggregate({
    where: { productId, warehouseId, type: 'SALE_OUT', refId: { in: saleIds } },
    _sum: { qty: true },
  });
  ok('movements account for all 6 units', Math.abs(Number(sold._sum.qty ?? 0)) === 6,
     `sum=${Number(sold._sum.qty ?? 0)}`);

  // Books balance: what left the shop == what the shelf gave up + what is owed
  ok('units out == stock consumed + debt recorded',
     Math.abs(Number(sold._sum.qty ?? 0)) === (2 - after.qty) + after.short,
     `${Math.abs(Number(sold._sum.qty ?? 0))} vs ${(2 - after.qty) + after.short}`);

  await cleanup();
  report();
};

async function cleanup() {
  const { productId, warehouseId } = target;
  for (const id of saleIds) {
    await prisma.stockMovement.deleteMany({ where: { refId: id } });
    await prisma.saleLine.deleteMany({ where: { saleId: id } });
    await prisma.sale.delete({ where: { id } }).catch(() => {});
  }
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
  ok('cleanup restored original stock and setting',
     restored.qty === snapshot.qty && restored.short === snapshot.short,
     `${JSON.stringify(restored)} vs ${JSON.stringify(snapshot)}`);
}

function report() {
  console.log('');
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.pass ? '' : '\n      -> ' + r.d}`);
  const failed = out.filter(r => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error('ERROR:', e.message); ok('script ran to completion', false, e.message); await cleanup().catch(() => {}); report(); })
  .finally(() => prisma.$disconnect());
