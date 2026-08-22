// Does an oversold product actually reach the owner's attention?
//
// The gap this closes: every low-stock path required reorderLevel > 0, so a
// product nobody had set a level for could sit at -5 and raise nothing at all.
// Checks the alert generator, the dashboard count, and the dashboard list —
// the three surfaces an owner would look at.
import { PrismaClient } from '@prisma/client';
import { generateAlerts } from '../dist/modules/inventory/alerts.service.js';
import { dashboardService } from '../dist/modules/dashboard/dashboard.service.js';

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });

let target = null, snapshot = null, prevLevel = null, createdAlertIds = [];

const main = async () => {
  const row = await prisma.stock.findFirst({
    where: { product: { isActive: true } },
    select: { productId: true, warehouseId: true, product: { select: { name: true, reorderLevel: true } } },
  });
  target = row;
  const { productId, warehouseId } = row;

  snapshot = await prisma.stock.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { qty: true, shortfallQty: true },
  });
  prevLevel = row.product.reorderLevel;

  // The exact blind spot: NO reorder level, and oversold.
  await prisma.product.update({ where: { id: productId }, data: { reorderLevel: 0 } });
  await prisma.stock.update({
    where: { productId_warehouseId: { productId, warehouseId } },
    data: { qty: 0, shortfallQty: 3 },
  });

  // ── 1. Alert generator ───────────────────────────────────────────────────
  await generateAlerts();
  const alert = await prisma.stockAlert.findFirst({
    where: { productId, warehouseId, type: 'LOW_STOCK' },
    select: { id: true, severity: true, qty: true, message: true },
  });
  if (alert) createdAlertIds.push(alert.id);
  ok('an oversold product with NO reorder level raises an alert', !!alert,
     'no alert row was created');
  ok('raised as CRITICAL', alert?.severity === 'CRITICAL', `severity=${alert?.severity}`);
  ok('alert reports the negative the counter sees (-3)', Number(alert?.qty) === -3,
     `qty=${alert?.qty}`);
  ok('message says oversold, not "below reorder level"',
     /oversold/i.test(alert?.message ?? ''), alert?.message ?? '');

  // ── 2. Dashboard count ───────────────────────────────────────────────────
  const kpis = await dashboardService.kpis();
  ok('dashboard low-stock count includes it', Number(kpis.lowStockCount ?? 0) > 0,
     `lowStockCount=${kpis.lowStockCount}`);

  // ── 3. Dashboard list ────────────────────────────────────────────────────
  const list = await dashboardService.lowStockAlerts();
  const listed = list.find((r) => r.id === productId);
  ok('dashboard low-stock list includes it', !!listed,
     `list=${list.map(r => r.name).join(', ')}`);
  ok('listed with its negative quantity', listed && Number(listed.totalQty) === -3,
     `totalQty=${listed?.totalQty}`);
  ok('oversold sorts above merely-low products', list[0]?.id === productId,
     `first=${list[0]?.name}`);

  // ── 4. Once settled, the alert clears ────────────────────────────────────
  await prisma.stock.update({
    where: { productId_warehouseId: { productId, warehouseId } },
    data: { qty: 5, shortfallQty: 0 },
  });
  await generateAlerts();
  const cleared = await prisma.stockAlert.findFirst({
    where: { productId, warehouseId, type: 'LOW_STOCK' },
  });
  ok('alert clears once the debt is settled', !cleared,
     cleared ? `still present: ${cleared.message}` : '');

  await cleanup();
  report();
};

async function cleanup() {
  const { productId, warehouseId } = target;
  for (const id of createdAlertIds) {
    await prisma.stockAlert.deleteMany({ where: { id } });
  }
  await prisma.stockAlert.deleteMany({ where: { productId, warehouseId, type: 'LOW_STOCK' } });
  await prisma.product.update({ where: { id: productId }, data: { reorderLevel: prevLevel } });
  await prisma.stock.update({
    where: { productId_warehouseId: { productId, warehouseId } },
    data: { qty: snapshot.qty, shortfallQty: snapshot.shortfallQty },
  });
  const restored = await prisma.stock.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
    select: { qty: true, shortfallQty: true },
  });
  ok('cleanup restored stock and reorder level',
     Number(restored.qty) === Number(snapshot.qty) &&
     Number(restored.shortfallQty) === Number(snapshot.shortfallQty),
     `${Number(restored.qty)} vs ${Number(snapshot.qty)}`);
}

function report() {
  console.log('');
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.pass ? '' : '\n      -> ' + r.d}`);
  const failed = out.filter(r => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error('ERROR:', e.message); await cleanup().catch(() => {}); report(); })
  .finally(() => prisma.$disconnect());
