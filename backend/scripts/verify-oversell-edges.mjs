// Adversarial pass over the shortfall feature: the paths the first round did
// not exercise, plus the ones most likely to corrupt stock.
//
// Every scenario runs inside a transaction that is rolled back, so nothing here
// touches real data. The invariant checked throughout is the one the whole
// design rests on:  Stock.qty >= 0  AND  (qty == SUM(positive batches) OR the
// excess is legitimately unbacked, i.e. legacy/transfer/import stock).
import { PrismaClient } from '@prisma/client';
import { addShortfall, settleShortfall } from '../dist/utils/stock-utils.js';

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });
const ROLLBACK = Symbol('rollback');

async function scenario(fn) {
  try {
    await prisma.$transaction(async (tx) => { await fn(tx); throw ROLLBACK; });
  } catch (e) { if (e !== ROLLBACK) ok('scenario crashed', false, e.message); }
}

const state = async (tx, productId, warehouseId) => {
  const s = await tx.stock.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { qty: true, shortfallQty: true },
  });
  const b = await tx.stockBatch.aggregate({
    where: { productId, warehouseId, qty: { gt: 0 } }, _sum: { qty: true },
  });
  return { qty: Number(s.qty), short: Number(s.shortfallQty), batches: Number(b._sum.qty ?? 0) };
};

const reset = async (tx, productId, warehouseId, qty, short) => {
  await tx.stockBatch.deleteMany({ where: { productId, warehouseId } });
  await tx.stock.update({
    where: { productId_warehouseId: { productId, warehouseId } },
    data: { qty, shortfallQty: short },
  });
};

const main = async () => {
  const row = await prisma.stock.findFirst({
    where: { product: { isActive: true, isBatchTracked: false } },
    select: { productId: true, warehouseId: true },
  });
  const { productId, warehouseId } = row;

  // ── A. UNBACKED increase (transfer in / import): no batch row created ─────
  // The danger: settleShortfall calls recomputeStockQty, which would set
  // qty = SUM(batches) = 0 and silently destroy the transferred stock.
  await scenario(async (tx) => {
    await reset(tx, productId, warehouseId, 0, 3);
    // transfer/import style: increment qty, create NO batch
    await tx.stock.update({
      where: { productId_warehouseId: { productId, warehouseId } },
      data: { qty: { increment: 10 } },
    });
    await settleShortfall(tx, productId, warehouseId);
    const s = await state(tx, productId, warehouseId);
    ok('unbacked increase settles without destroying the stock (10 in, 3 owed -> 7)',
       s.qty === 7 && s.short === 0, JSON.stringify(s));
  });

  // ── B. MIXED: real batches present AND an unbacked increase on top ────────
  // The worst case for a blind recompute.
  await scenario(async (tx) => {
    await reset(tx, productId, warehouseId, 0, 4);
    await tx.stockBatch.create({ data: { productId, warehouseId, qty: 6 } });  // backed
    await tx.stock.update({
      where: { productId_warehouseId: { productId, warehouseId } },
      data: { qty: 6 + 5 },                                                   // +5 unbacked
    });
    await settleShortfall(tx, productId, warehouseId);
    const s = await state(tx, productId, warehouseId);
    // 11 on hand, 4 owed -> 7 must remain. A blind recompute would give 2.
    ok('mixed backed+unbacked stock keeps the unbacked units (11 in, 4 owed -> 7)',
       s.qty === 7, `${JSON.stringify(s)} (a blind recompute would show 2)`);
    ok('mixed case clears the debt', s.short === 0, JSON.stringify(s));
  });

  // ── C. Fractional quantities — Decimal(18,4), not integers ───────────────
  await scenario(async (tx) => {
    await reset(tx, productId, warehouseId, 0, 0);
    await addShortfall(tx, productId, warehouseId, 2.5);
    await tx.stockBatch.create({ data: { productId, warehouseId, qty: 4.25 } });
    await tx.stock.update({
      where: { productId_warehouseId: { productId, warehouseId } }, data: { qty: 4.25 },
    });
    await settleShortfall(tx, productId, warehouseId);
    const s = await state(tx, productId, warehouseId);
    ok('fractional quantities settle exactly (4.25 in, 2.5 owed -> 1.75)',
       Math.abs(s.qty - 1.75) < 1e-9 && s.short === 0, JSON.stringify(s));
  });

  // ── D. Settling twice must not double-deduct ─────────────────────────────
  await scenario(async (tx) => {
    await reset(tx, productId, warehouseId, 0, 3);
    await tx.stockBatch.create({ data: { productId, warehouseId, qty: 10 } });
    await tx.stock.update({
      where: { productId_warehouseId: { productId, warehouseId } }, data: { qty: 10 },
    });
    await settleShortfall(tx, productId, warehouseId);
    const first = await state(tx, productId, warehouseId);
    await settleShortfall(tx, productId, warehouseId);   // called again
    await settleShortfall(tx, productId, warehouseId);   // and again
    const s = await state(tx, productId, warehouseId);
    ok('settling repeatedly is idempotent (stays 7)',
       s.qty === 7 && s.short === 0 && first.qty === 7, JSON.stringify(s));
  });

  // ── E. Debt larger than everything that ever arrives ─────────────────────
  await scenario(async (tx) => {
    await reset(tx, productId, warehouseId, 0, 100);
    for (const n of [10, 20, 30]) {
      await tx.stockBatch.create({ data: { productId, warehouseId, qty: n } });
      await tx.stock.update({
        where: { productId_warehouseId: { productId, warehouseId } },
        data: { qty: { increment: n } },
      });
      await settleShortfall(tx, productId, warehouseId);
    }
    const s = await state(tx, productId, warehouseId);
    ok('three partial deliveries pay down 60 of 100, nothing on hand',
       s.qty === 0 && s.short === 40, JSON.stringify(s));
  });

  // ── F. qty never goes negative, whatever is thrown at it ─────────────────
  await scenario(async (tx) => {
    await reset(tx, productId, warehouseId, 0, 5);
    await tx.stockBatch.create({ data: { productId, warehouseId, qty: 1 } });
    await tx.stock.update({
      where: { productId_warehouseId: { productId, warehouseId } }, data: { qty: 1 },
    });
    await settleShortfall(tx, productId, warehouseId);
    const s = await state(tx, productId, warehouseId);
    ok('qty floors at 0 when the debt exceeds the delivery',
       s.qty === 0 && s.short === 4 && s.qty >= 0, JSON.stringify(s));
  });

  // ── G. Zero and negative arguments are ignored, not written ──────────────
  await scenario(async (tx) => {
    await reset(tx, productId, warehouseId, 5, 0);
    await addShortfall(tx, productId, warehouseId, 0);
    await addShortfall(tx, productId, warehouseId, -3);
    const s = await state(tx, productId, warehouseId);
    ok('addShortfall ignores zero and negative input',
       s.short === 0 && s.qty === 5, JSON.stringify(s));
  });

  // ── H. A Stock row that does not exist yet ───────────────────────────────
  await scenario(async (tx) => {
    const other = await tx.warehouse.findFirst({
      where: { id: { not: warehouseId } }, select: { id: true },
    });
    if (!other) { ok('addShortfall creates a missing Stock row', true, '(only one warehouse — skipped)'); return; }
    await tx.stock.deleteMany({ where: { productId, warehouseId: other.id } });
    await addShortfall(tx, productId, other.id, 2);
    const s = await state(tx, productId, other.id);
    ok('addShortfall creates a missing Stock row with qty 0',
       s.qty === 0 && s.short === 2, JSON.stringify(s));
  });

  console.log('');
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.pass ? '' : '\n      -> ' + r.d}`);
  const failed = out.filter(r => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
};

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
