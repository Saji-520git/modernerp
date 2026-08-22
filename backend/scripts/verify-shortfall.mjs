// Live exercise of the shortfall helpers against real Postgres, inside a
// transaction that is always rolled back — real Decimal handling, real CHECK
// constraint, no residue.
import { PrismaClient } from '@prisma/client';
import { addShortfall, settleShortfall } from './dist/utils/stock-utils.js';

const prisma = new PrismaClient();
const results = [];
const ok = (name, pass, detail) => results.push({ name, pass, detail });

const ROLLBACK = Symbol('rollback');

async function scenario(label, fn) {
  try {
    await prisma.$transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) { ok(label, false, e.message); }
  }
}

const read = async (tx, productId, warehouseId) => {
  const s = await tx.stock.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { qty: true, shortfallQty: true },
  });
  return { qty: Number(s.qty), short: Number(s.shortfallQty) };
};

const main = async () => {
  const stock = await prisma.stock.findFirst({
    where: { qty: { gt: 0 } },
    select: { productId: true, warehouseId: true, qty: true },
  });
  if (!stock) throw new Error('no stock row to test against');
  const { productId, warehouseId } = stock;

  // 1 — oversell then a delivery that covers it exactly
  await scenario('settles fully when the delivery covers the debt', async (tx) => {
    await tx.stockBatch.deleteMany({ where: { productId, warehouseId } });
    await tx.stock.update({
      where: { productId_warehouseId: { productId, warehouseId } },
      data: { qty: 0, shortfallQty: 0 },
    });
    await addShortfall(tx, productId, warehouseId, 3);
    const owed = await read(tx, productId, warehouseId);
    ok('debt recorded, qty stays 0', owed.qty === 0 && owed.short === 3, JSON.stringify(owed));

    // goods arrive: a batch of 10, aggregate recomputed the way receiving does
    await tx.stockBatch.create({ data: { productId, warehouseId, qty: 10 } });
    await tx.stock.update({
      where: { productId_warehouseId: { productId, warehouseId } },
      data: { qty: 10 },
    });
    const settled = await settleShortfall(tx, productId, warehouseId);
    const after = await read(tx, productId, warehouseId);
    ok('10 received against 3 owed leaves 7', after.qty === 7 && after.short === 0,
       `settled=${settled} ${JSON.stringify(after)}`);

    const batchSum = await tx.stockBatch.aggregate({
      where: { productId, warehouseId, qty: { gt: 0 } }, _sum: { qty: true },
    });
    ok('invariant qty === SUM(batches) holds', Number(batchSum._sum.qty) === after.qty,
       `batches=${Number(batchSum._sum.qty)} qty=${after.qty}`);
  });

  // 2 — delivery smaller than the debt
  await scenario('partial settlement', async (tx) => {
    await tx.stockBatch.deleteMany({ where: { productId, warehouseId } });
    await tx.stock.update({
      where: { productId_warehouseId: { productId, warehouseId } },
      data: { qty: 0, shortfallQty: 0 },
    });
    await addShortfall(tx, productId, warehouseId, 3);
    await tx.stockBatch.create({ data: { productId, warehouseId, qty: 2 } });
    await tx.stock.update({
      where: { productId_warehouseId: { productId, warehouseId } },
      data: { qty: 2 },
    });
    await settleShortfall(tx, productId, warehouseId);
    const after = await read(tx, productId, warehouseId);
    ok('2 received against 3 owed leaves 0 on hand, 1 still owed',
       after.qty === 0 && after.short === 1, JSON.stringify(after));
  });

  // 3 — no-op when nothing is owed (the feature-off case, every call site)
  await scenario('no-op when nothing owed', async (tx) => {
    await tx.stock.update({
      where: { productId_warehouseId: { productId, warehouseId } },
      data: { qty: 5, shortfallQty: 0 },
    });
    const settled = await settleShortfall(tx, productId, warehouseId);
    const after = await read(tx, productId, warehouseId);
    ok('untouched when no debt', settled === 0 && after.qty === 5 && after.short === 0,
       `settled=${settled} ${JSON.stringify(after)}`);
  });

  // 4 — debt owed but nothing has arrived
  await scenario('debt survives an empty shelf', async (tx) => {
    await tx.stockBatch.deleteMany({ where: { productId, warehouseId } });
    await tx.stock.update({
      where: { productId_warehouseId: { productId, warehouseId } },
      data: { qty: 0, shortfallQty: 0 },
    });
    await addShortfall(tx, productId, warehouseId, 4);
    const settled = await settleShortfall(tx, productId, warehouseId);
    const after = await read(tx, productId, warehouseId);
    ok('nothing to settle against — debt stands', settled === 0 && after.short === 4,
       `settled=${settled} ${JSON.stringify(after)}`);
  });

  // 5 — accumulation across two oversells
  await scenario('accumulates', async (tx) => {
    await tx.stockBatch.deleteMany({ where: { productId, warehouseId } });
    await tx.stock.update({
      where: { productId_warehouseId: { productId, warehouseId } },
      data: { qty: 0, shortfallQty: 0 },
    });
    await addShortfall(tx, productId, warehouseId, 2);
    await addShortfall(tx, productId, warehouseId, 1);
    const after = await read(tx, productId, warehouseId);
    ok('two oversells accumulate to 3', after.short === 3, JSON.stringify(after));
  });

  // 6 — the DB refuses an impossible row
  await scenario('CHECK constraint rejects a negative debt', async (tx) => {
    let rejected = false;
    try {
      await tx.stock.update({
        where: { productId_warehouseId: { productId, warehouseId } },
        data: { shortfallQty: -1 },
      });
    } catch { rejected = true; }
    ok('negative shortfallQty rejected by the database', rejected, '');
  });

  // residue check
  const final = await prisma.stock.aggregate({ _sum: { shortfallQty: true } });
  ok('no residue left behind', Number(final._sum.shortfallQty ?? 0) === 0,
     `total shortfall in DB = ${Number(final._sum.shortfallQty ?? 0)}`);

  console.log('');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : '  <- ' + r.detail}`);
  }
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
};

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
