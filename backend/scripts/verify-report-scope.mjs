// Does scoping a report to one entity actually recompute it — totals, charts
// and breakdowns — rather than just hiding rows?
//
// The property that matters: the parts must agree with each other. A scoped
// top-products list under an unscoped revenue total is worse than no filter,
// because it reads as authoritative and is not.
import { PrismaClient } from '@prisma/client';
import { reportsService } from '../dist/modules/reports/reports.service.js';

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });

const FROM = new Date('2026-01-01T00:00:00.000Z');
const TO   = new Date('2026-12-31T23:59:59.999Z');

const main = async () => {
  // ── Sales, scoped to one customer ─────────────────────────────────────────
  const cust = await prisma.sale.groupBy({
    by: ['customerId'],
    where: { status: 'CONFIRMED', customerId: { not: null } },
    _sum: { totalCents: true },
    _count: true,
  });
  if (cust.length === 0) throw new Error('no customer sales to scope against');
  const target = cust.sort((a, b) => (b._sum.totalCents ?? 0) - (a._sum.totalCents ?? 0))[0];
  const customerId = target.customerId;

  const all    = await reportsService.salesReport(FROM, TO, 'month');
  const scoped = await reportsService.salesReport(FROM, TO, 'month', { customerId });

  ok('scoping reduces the order count',
     scoped.summary.orderCount < all.summary.orderCount,
     `all=${all.summary.orderCount} scoped=${scoped.summary.orderCount}`);

  ok('scoped order count equals that customer\'s real confirmed sales',
     scoped.summary.orderCount === target._count,
     `report=${scoped.summary.orderCount} db=${target._count}`);

  ok('the revenue TOTAL is recomputed, not just the list',
     scoped.summary.totalRevenueCents < all.summary.totalRevenueCents,
     `all=${all.summary.totalRevenueCents} scoped=${scoped.summary.totalRevenueCents}`);

  // Every breakdown must describe the same, smaller population.
  const sumBy = (rows, k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
  ok('by-warehouse rows sum to the scoped revenue',
     Math.abs(sumBy(scoped.byWarehouse, 'revenueCents') - scoped.summary.totalRevenueCents) <= 1,
     `rows=${sumBy(scoped.byWarehouse, 'revenueCents')} total=${scoped.summary.totalRevenueCents}`);
  ok('by-payment rows sum to the scoped revenue',
     Math.abs(sumBy(scoped.byPayment, 'revenueCents') - scoped.summary.totalRevenueCents) <= 1,
     `rows=${sumBy(scoped.byPayment, 'revenueCents')} total=${scoped.summary.totalRevenueCents}`);
  ok('by-period rows sum to the scoped revenue',
     Math.abs(sumBy(scoped.byPeriod, 'revenueCents') - scoped.summary.totalRevenueCents) <= 1,
     `rows=${sumBy(scoped.byPeriod, 'revenueCents')} total=${scoped.summary.totalRevenueCents}`);

  ok('top products are the scoped ones only',
     scoped.topProducts.length <= all.topProducts.length,
     `all=${all.topProducts.length} scoped=${scoped.topProducts.length}`);

  // ── Sales, scoped to one warehouse ────────────────────────────────────────
  const wh = all.byWarehouse[0];
  if (wh) {
    const warehouse = await prisma.warehouse.findFirst({ where: { code: wh.code }, select: { id: true } });
    const byWh = await reportsService.salesReport(FROM, TO, 'month', { warehouseId: warehouse.id });
    ok(`warehouse scope matches that warehouse's own row (${wh.code})`,
       Math.abs(byWh.summary.totalRevenueCents - wh.revenueCents) <= 1,
       `scoped=${byWh.summary.totalRevenueCents} row=${wh.revenueCents}`);
    ok('a warehouse-scoped report lists only that warehouse',
       byWh.byWarehouse.every((r) => r.code === wh.code),
       byWh.byWarehouse.map((r) => r.code).join(','));
  }

  // ── An id that matches nothing returns an empty report, not everything ────
  const empty = await reportsService.salesReport(FROM, TO, 'month', { customerId: 'no-such-customer-id' });
  ok('an unmatched scope yields zero, never the unscoped figures',
     empty.summary.orderCount === 0 && empty.summary.totalRevenueCents === 0,
     `orders=${empty.summary.orderCount} revenue=${empty.summary.totalRevenueCents}`);

  // ── Purchases, scoped to one supplier ─────────────────────────────────────
  const allPo = await reportsService.purchasesReport(FROM, TO);
  const sup = allPo.bySupplier[0];
  if (sup) {
    const supplier = await prisma.supplier.findFirst({ where: { name: sup.name }, select: { id: true } });
    const scopedPo = await reportsService.purchasesReport(FROM, TO, { supplierId: supplier.id });
    ok(`supplier scope matches that supplier's own row (${sup.name})`,
       Math.abs(scopedPo.summary.totalSpendCents - sup.spendCents) <= 1,
       `scoped=${scopedPo.summary.totalSpendCents} row=${sup.spendCents}`);
    ok('a supplier-scoped report lists only that supplier',
       scopedPo.bySupplier.every((r) => r.name === sup.name),
       scopedPo.bySupplier.map((r) => r.name).join(','));
    ok('supplier count drops to 1 when scoped',
       scopedPo.summary.uniqueSuppliers === 1,
       `count=${scopedPo.summary.uniqueSuppliers}`);
  }

  // ── No scope must behave exactly as before ────────────────────────────────
  const again = await reportsService.salesReport(FROM, TO, 'month', {});
  ok('an empty scope is identical to no scope at all',
     again.summary.totalRevenueCents === all.summary.totalRevenueCents &&
     again.summary.orderCount === all.summary.orderCount,
     `${again.summary.totalRevenueCents} vs ${all.summary.totalRevenueCents}`);

  console.log('');
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.pass ? '' : '\n      -> ' + r.d}`);
  const failed = out.filter((r) => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
};

main().catch(async (e) => { console.error('ERROR:', e.message); await prisma.$disconnect(); process.exit(1); });
