// Do the two receiving paths actually clear a shortfall?
//
// They write stock differently — PO confirm recomputes the aggregate from the
// batch rows, a GRN increments it — so each needs proving separately. This runs
// both against real products carrying real debt, through the same service
// functions the API calls, then reverses everything it created.
import { PrismaClient } from '@prisma/client';
import { purchaseService } from '../dist/modules/purchases/purchases.service.js';
import { createReceipt } from '../dist/modules/purchases/purchase-receipt.service.js';

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });

const created = { purchaseIds: [], productSnapshots: [] };

const read = async (productId, warehouseId) => {
  const s = await prisma.stock.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { qty: true, shortfallQty: true },
  });
  const b = await prisma.stockBatch.aggregate({
    where: { productId, warehouseId, qty: { gt: 0 } }, _sum: { qty: true },
  });
  return { qty: Number(s.qty), short: Number(s.shortfallQty), batches: Number(b._sum.qty ?? 0) };
};

const snap = async (productId, warehouseId) => {
  const s = await prisma.stock.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { qty: true, shortfallQty: true },
  });
  const p = await prisma.product.findUnique({
    where: { id: productId }, select: { costCents: true, lastCostCents: true },
  });
  const batchIds = (await prisma.stockBatch.findMany({
    where: { productId, warehouseId }, select: { id: true },
  })).map((b) => b.id);
  return { productId, warehouseId, qty: s.qty, shortfallQty: s.shortfallQty,
           costCents: p.costCents, lastCostCents: p.lastCostCents, batchIds };
};

const main = async () => {
  const user     = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
  const supplier = await prisma.supplier.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!supplier) throw new Error('no supplier to raise a PO against');

  const oversold = await prisma.stock.findMany({
    where: { shortfallQty: { gt: 0 } },
    select: { productId: true, warehouseId: true, shortfallQty: true,
              product: { select: { name: true, sku: true } } },
    orderBy: { shortfallQty: 'desc' },
  });
  if (oversold.length < 2) throw new Error(`need 2 oversold products, found ${oversold.length}`);

  // ── PATH 1: confirm a PO (recomputes the aggregate from batch rows) ───────
  {
    const t = oversold[0];
    created.productSnapshots.push(await snap(t.productId, t.warehouseId));
    const owed   = Number(t.shortfallQty);
    const before = await read(t.productId, t.warehouseId);
    const order  = 10;

    const po = await purchaseService.createPurchase({
      supplierId: supplier.id, warehouseId: t.warehouseId,
      lines: [{ productId: t.productId, qty: order, unitCostCents: 1000, taxPercent: 0 }],
    }, user.id);
    created.purchaseIds.push(po.id);
    await purchaseService.confirmPurchase(po.id, user.id);

    const after = await read(t.productId, t.warehouseId);
    ok(`PO confirm settles the debt — ${t.product.sku}: ${order} in, ${owed} owed -> ${order - owed}`,
       after.qty === before.qty + order - owed && after.short === 0,
       `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    ok('PO confirm keeps qty === SUM(batches)', after.qty === after.batches,
       `qty=${after.qty} batches=${after.batches}`);
    ok('PO confirm leaves no negative qty', after.qty >= 0, `qty=${after.qty}`);
  }

  // ── PATH 2: GRN receipt (increments the aggregate) ────────────────────────
  {
    const t = oversold[1];
    created.productSnapshots.push(await snap(t.productId, t.warehouseId));
    const owed   = Number(t.shortfallQty);
    const before = await read(t.productId, t.warehouseId);
    const order  = 6;

    // AWAIT_GRN so confirming does not receive the goods — the GRN does.
    const po = await purchaseService.createPurchase({
      supplierId: supplier.id, warehouseId: t.warehouseId,
      lines: [{ productId: t.productId, qty: order, unitCostCents: 1000, taxPercent: 0 }],
    }, user.id);
    created.purchaseIds.push(po.id);
    await purchaseService.confirmPurchase(po.id, user.id, 'AWAIT_GRN');

    const awaiting = await read(t.productId, t.warehouseId);
    ok('AWAIT_GRN confirm does not move stock or settle early',
       awaiting.qty === before.qty && awaiting.short === owed,
       `before=${JSON.stringify(before)} after=${JSON.stringify(awaiting)}`);

    const full = await prisma.purchase.findUnique({
      where: { id: po.id }, select: { lines: { select: { id: true } } },
    });
    await createReceipt(po.id, [{ purchaseLineId: full.lines[0].id, qty: order }], user.id, 'oversell settle check');

    const after = await read(t.productId, t.warehouseId);
    ok(`GRN settles the debt — ${t.product.sku}: ${order} in, ${owed} owed -> ${order - owed}`,
       after.qty === before.qty + order - owed && after.short === 0,
       `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    ok('GRN leaves no negative qty', after.qty >= 0, `qty=${after.qty}`);
  }

  // ── PATH 3: a delivery smaller than the debt only settles part of it ──────
  if (oversold.length >= 3) {
    const t = oversold[2];
    created.productSnapshots.push(await snap(t.productId, t.warehouseId));
    const owed = Number(t.shortfallQty);
    // Push the debt above what will arrive, so a partial settlement is forced.
    await prisma.stock.update({
      where: { productId_warehouseId: { productId: t.productId, warehouseId: t.warehouseId } },
      data: { shortfallQty: owed + 4 },
    });
    const before = await read(t.productId, t.warehouseId);

    const po = await purchaseService.createPurchase({
      supplierId: supplier.id, warehouseId: t.warehouseId,
      lines: [{ productId: t.productId, qty: 2, unitCostCents: 1000, taxPercent: 0 }],
    }, user.id);
    created.purchaseIds.push(po.id);
    await purchaseService.confirmPurchase(po.id, user.id);

    const after = await read(t.productId, t.warehouseId);
    ok(`partial delivery pays down only what arrived — 2 in against ${before.short} owed`,
       after.qty === 0 && after.short === before.short - 2,
       `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }

  await cleanup();
  report();
};

async function cleanup() {
  // Remove the purchase documents this script raised, and everything they wrote.
  for (const id of created.purchaseIds) {
    await prisma.stockMovement.deleteMany({ where: { refId: id } });
    const receipts = await prisma.purchaseReceipt.findMany({
      where: { purchaseId: id }, select: { id: true },
    });
    for (const r of receipts) {
      await prisma.stockMovement.deleteMany({ where: { refId: r.id } });
      await prisma.purchaseReceiptLine.deleteMany({ where: { receiptId: r.id } });
    }
    await prisma.purchaseReceipt.deleteMany({ where: { purchaseId: id } });
    const lines = await prisma.purchaseLine.findMany({ where: { purchaseId: id }, select: { id: true } });
    await prisma.stockBatch.deleteMany({ where: { purchaseLineId: { in: lines.map((l) => l.id) } } });
    await prisma.purchaseLine.deleteMany({ where: { purchaseId: id } });
    await prisma.purchase.delete({ where: { id } }).catch(() => {});
  }

  // Put each product back exactly as it was.
  let restored = true;
  for (const s of created.productSnapshots) {
    await prisma.stockBatch.deleteMany({
      where: { productId: s.productId, warehouseId: s.warehouseId, id: { notIn: s.batchIds.length ? s.batchIds : ['-'] } },
    });
    await prisma.stock.update({
      where: { productId_warehouseId: { productId: s.productId, warehouseId: s.warehouseId } },
      data: { qty: s.qty, shortfallQty: s.shortfallQty },
    });
    await prisma.product.update({
      where: { id: s.productId },
      data: { costCents: s.costCents, lastCostCents: s.lastCostCents },
    });
    const now = await read(s.productId, s.warehouseId);
    if (now.qty !== Number(s.qty) || now.short !== Number(s.shortfallQty)) restored = false;
  }
  ok('every product restored to its original stock, debt and cost', restored);

  const leftover = await prisma.purchase.count({ where: { id: { in: created.purchaseIds } } });
  ok('every test purchase order removed', leftover === 0, `${leftover} left`);
}

function report() {
  console.log('');
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.pass ? '' : '\n      -> ' + r.d}`);
  const failed = out.filter((r) => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error('ERROR:', e.message); ok('script ran to completion', false, e.message); await cleanup().catch((c) => console.error('cleanup failed:', c.message)); report(); })
  .finally(() => prisma.$disconnect());
