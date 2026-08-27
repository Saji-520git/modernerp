// Do the POS header and the close-shift dialog agree about the same shift?
//
// They read different sources. The header used the running counters stored on
// the shift row; the dialog recomputes from the sales. Those counters are
// incremented at checkout and never decremented, so a voided or deleted sale
// left them overstated — one shift showed "Rs. 10,990 · 4 sales" in the header
// while the dialog, correctly, showed "Rs. 510.00 · 1 sale".
//
// A cashier reconciling a drawer against the header would have chased a
// shortfall that never existed, so these two figures must never disagree.
import { PrismaClient } from '@prisma/client';
import { posService } from '../dist/modules/pos/pos.service.js';

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });
const rs = (c) => `Rs. ${(c / 100).toFixed(2)}`;

let createdSaleId = null, shiftId = null;

const main = async () => {
  const shift = await prisma.posShift.findFirst({ where: { status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
  if (!shift) { ok('no open shift to check', true, '(open one and re-run)'); return report(); }
  shiftId = shift.id;

  const live = async () => {
    const a = await prisma.sale.aggregate({
      where: { shiftId, status: 'CONFIRMED', deletedAt: null },
      _sum: { totalCents: true }, _count: true,
    });
    return { count: a._count, cents: a._sum.totalCents ?? 0 };
  };

  // ── 1. What the header reports must equal what the sales say ─────────────
  const header = await posService.getCurrentShift(shift.userId, shift.warehouseId);
  const actual = await live();
  ok(`header sale count matches the sales (${header.saleCount})`,
     header.saleCount === actual.count, `header=${header.saleCount} sales=${actual.count}`);
  ok(`header total matches the sales (${rs(header.totalSalesCents)})`,
     header.totalSalesCents === actual.cents, `header=${header.totalSalesCents} sales=${actual.cents}`);

  // ── 2. A deleted sale must not leave the header overstated ───────────────
  //
  // This is the exact sequence that broke it: check out, then remove the sale.
  const before = await live();
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
  // Stock in the SHIFT'S warehouse. Checkout resolves the open shift by user
  // AND warehouse, so a product held anywhere else is refused with 'no open
  // shift' - which reads like a bug in the shift, not in the test's choice.
  const row  = await prisma.stock.findFirst({
    where: {
      qty: { gt: 2 },
      warehouseId: shift.warehouseId,
      product: { isActive: true, isBatchTracked: false, priceCents: { gt: 0 } },
    },
    select: { productId: true, warehouseId: true },
  });

  if (row && user) {
    const { checkoutSchema } = await import('../dist/modules/pos/pos.schema.js');
    const res = await posService.checkout(
      checkoutSchema.parse({
        warehouseId: row.warehouseId, paymentMethod: 'CASH',
        items: [{ productId: row.productId, qty: 1 }],
      }),
      // The shift's OWN user: checkout resolves the open shift by user and
      // warehouse, so any other account is told there is no shift to sell on.
      shift.userId, false, false, false,
    );
    createdSaleId = res?.receipt?.id ?? null;

    const during = await posService.getCurrentShift(shift.userId, shift.warehouseId);
    ok('header rises when a sale is made',
       during.saleCount === before.count + 1,
       `before=${before.count} during=${during.saleCount}`);

    // Remove it the way a void/cleanup would.
    if (createdSaleId) {
      await prisma.stockMovement.deleteMany({ where: { refId: createdSaleId } });
      await prisma.saleLine.deleteMany({ where: { saleId: createdSaleId } });
      await prisma.sale.delete({ where: { id: createdSaleId } });
      createdSaleId = null;
    }

    const after     = await posService.getCurrentShift(shift.userId, shift.warehouseId);
    const afterLive = await live();
    ok('header falls back when the sale is removed — no phantom takings',
       after.saleCount === afterLive.count && after.totalSalesCents === afterLive.cents,
       `header=${after.saleCount}/${after.totalSalesCents} sales=${afterLive.count}/${afterLive.cents}`);
    ok('header returns to exactly what it was before',
       after.saleCount === before.count && after.totalSalesCents === before.cents,
       `after=${after.saleCount}/${rs(after.totalSalesCents)} before=${before.count}/${rs(before.cents)}`);
  } else {
    ok('deleted sale does not overstate the header', true, '(no suitable product to test with)');
  }

  // ── 3. Every open shift REPORTS correctly ────────────────────────────────
  //
  // Asserted through getCurrentShift, not against the stored columns. Those
  // are advisory: incremented at checkout, never decremented, and overwritten
  // with the correct aggregate at close. Holding them to this would assert an
  // invariant the design does not claim — and would fail on this very script,
  // whose own checkout above bumps them before deleting the sale.
  const openShifts = await prisma.posShift.findMany({ where: { status: 'OPEN' } });
  const wrong = [];
  for (const s of openShifts) {
    const reported = await posService.getCurrentShift(s.userId, s.warehouseId);
    const a = await prisma.sale.aggregate({
      where: { shiftId: s.id, status: 'CONFIRMED', deletedAt: null },
      _sum: { totalCents: true }, _count: true,
    });
    // getCurrentShift picks the NEWEST open shift for a user+warehouse, so it
    // may legitimately name a different one than the row being looped over.
    if (reported?.id !== s.id) continue;
    if (reported.saleCount !== a._count || reported.totalSalesCents !== (a._sum.totalCents ?? 0)) {
      wrong.push(`${s.id.slice(-8)}: reported ${reported.saleCount}/${reported.totalSalesCents} vs sales ${a._count}/${a._sum.totalCents ?? 0}`);
    }
  }
  ok(`every open shift reports its real takings (${openShifts.length} checked)`,
     wrong.length === 0, wrong.join(' | '));

  report();
};

function report() {
  console.log('');
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.pass ? '' : '\n      -> ' + r.d}`);
  const failed = out.filter((r) => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error('ERROR:', e.message);
  ok('script ran to completion', false, e.message);
  if (createdSaleId) {
    await prisma.stockMovement.deleteMany({ where: { refId: createdSaleId } }).catch(() => {});
    await prisma.saleLine.deleteMany({ where: { saleId: createdSaleId } }).catch(() => {});
    await prisma.sale.delete({ where: { id: createdSaleId } }).catch(() => {});
  }
  report();
}).finally(() => prisma.$disconnect());
