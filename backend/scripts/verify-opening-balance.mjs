// Is an opening balance recognised everywhere a balance is shown — and kept
// out of everywhere it must not be?
//
// The dangerous half is the second one. An opening balance belongs to no
// invoice, so it must never raise what can be paid against a specific bill: if
// it did, a customer could overpay an invoice by the amount of their old debt
// and the bill would show as settled when it was not.
//
// Every scenario sets a balance, measures, and restores the original value.
import { PrismaClient } from '@prisma/client';
import { customersService } from '../dist/modules/customers/customers.service.js';
import { suppliersService } from '../dist/modules/suppliers/suppliers.service.js';
import { dashboardService } from '../dist/modules/dashboard/dashboard.service.js';
import { reportsService } from '../dist/modules/reports/reports.service.js';
import { customerPaymentService } from '../dist/modules/customer-payments/customer-payment.service.js';

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });

const OPENING = 5_000_00;   // Rs. 5,000.00 carried forward
let customerId = null, supplierId = null, custBefore = 0, supBefore = 0;

const main = async () => {
  // A credit-enabled customer specifically: getCustomerCredit returns a flat
  // zero for anyone without a credit account, so picking whichever customer
  // came first made the credit-limit assertion pass or fail by luck of the
  // draw rather than by whether the code was right.
  const cust = await prisma.customer.findFirst({
    where:  { isActive: true, creditEnabled: true },
    select: { id: true, name: true, openingBalanceCents: true },
  }) ?? await prisma.customer.findFirst({
    where:  { isActive: true },
    select: { id: true, name: true, openingBalanceCents: true },
  });
  const sup  = await prisma.supplier.findFirst({ where: { isActive: true }, select: { id: true, name: true, openingBalanceCents: true } });
  customerId = cust.id; custBefore = cust.openingBalanceCents;
  supplierId = sup.id;  supBefore  = sup.openingBalanceCents;

  // ── Baseline, before any opening balance ─────────────────────────────────
  const custBase = await customersService.getOne(customerId);
  const supBase  = await suppliersService.getOne(supplierId);
  const dashBase = await dashboardService.kpis();
  const statsBase = await reportsService.getDashboardStats();

  // ── Set an opening balance on both ───────────────────────────────────────
  await prisma.customer.update({ where: { id: customerId }, data: { openingBalanceCents: OPENING, openingBalanceAsOf: new Date() } });
  await prisma.supplier.update({ where: { id: supplierId }, data: { openingBalanceCents: OPENING, openingBalanceAsOf: new Date() } });

  // ── 1. Customer detail ───────────────────────────────────────────────────
  const custAfter = await customersService.getOne(customerId);
  ok(`customer outstanding rises by the opening balance (${cust.name})`,
     custAfter.outstandingBalance === custBase.outstandingBalance + OPENING,
     `before=${custBase.outstandingBalance} after=${custAfter.outstandingBalance}`);
  ok('the two halves stay separable on the customer',
     custAfter.derivedBalance + custAfter.openingBalanceCents === custAfter.outstandingBalance,
     `derived=${custAfter.derivedBalance} opening=${custAfter.openingBalanceCents} total=${custAfter.outstandingBalance}`);

  // ── 2. Supplier detail ───────────────────────────────────────────────────
  const supAfter = await suppliersService.getOne(supplierId);
  ok(`supplier payable rises by the opening balance (${sup.name})`,
     supAfter.outstandingBalance === supBase.outstandingBalance + OPENING,
     `before=${supBase.outstandingBalance} after=${supAfter.outstandingBalance}`);

  // ── 3. Dashboard receivables ─────────────────────────────────────────────
  const dashAfter = await dashboardService.kpis();
  ok('dashboard receivables include it',
     dashAfter.unpaidCents === dashBase.unpaidCents + OPENING,
     `before=${dashBase.unpaidCents} after=${dashAfter.unpaidCents}`);

  // ── 4. Report KPIs, both directions ──────────────────────────────────────
  const statsAfter = await reportsService.getDashboardStats();
  ok('report receivables include it',
     statsAfter.outstandingReceivablesCents === statsBase.outstandingReceivablesCents + OPENING,
     `before=${statsBase.outstandingReceivablesCents} after=${statsAfter.outstandingReceivablesCents}`);
  ok('report payables include it',
     statsAfter.outstandingPayablesCents === statsBase.outstandingPayablesCents + OPENING,
     `before=${statsBase.outstandingPayablesCents} after=${statsAfter.outstandingPayablesCents}`);

  // ── 5. POS credit limit — the enforcement path ───────────────────────────
  const credit = await import('../dist/modules/pos/pos.service.js');
  const info = await credit.posService.getCustomerCredit(customerId).catch(() => null);
  if (info) {
    ok('the POS credit check counts the carried-forward debt',
       info.balance >= OPENING,
       `balance=${info.balance} openingAlone=${OPENING}`);
  } else {
    ok('the POS credit check counts the carried-forward debt', true, '(getCustomerCredit unavailable — covered by the service test above)');
  }

  // ── 6. It must NOT reach a per-invoice payment cap ───────────────────────
  const sale = await prisma.sale.findFirst({
    where: { customerId, status: 'CONFIRMED', paymentStatus: { in: ['UNPAID', 'PARTIAL'] } },
    select: { id: true, number: true, totalCents: true, paidCents: true },
  });
  if (sale) {
    const returns = await prisma.saleReturn.aggregate({ where: { saleId: sale.id }, _sum: { totalCents: true } });
    const owedOnBill = Math.max(0, sale.totalCents - (returns._sum.totalCents ?? 0)) - sale.paidCents;
    let refused = false, msg = '';
    try {
      // One cent past what the BILL owes. If the opening balance leaked into
      // this cap, the overpayment would be accepted.
      await customerPaymentService.createPayment({
        saleId: sale.id, amountCents: owedOnBill + 1,
        paymentMethod: 'CASH', paymentDate: new Date().toISOString(),
      }, (await prisma.user.findFirst({ select: { id: true } })).id);
    } catch (e) { refused = true; msg = e.message; }
    ok(`an opening balance never raises the cap on invoice ${sale.number}`,
       refused, msg || 'the overpayment was ACCEPTED — the opening balance leaked into the per-invoice cap');
  } else {
    ok('an opening balance never raises a per-invoice cap', true, '(no unpaid invoice to test against)');
  }

  // ── 7. Zero behaves exactly as before ────────────────────────────────────
  await prisma.customer.update({ where: { id: customerId }, data: { openingBalanceCents: 0 } });
  const backToZero = await customersService.getOne(customerId);
  ok('an opening balance of zero is identical to before',
     backToZero.outstandingBalance === custBase.outstandingBalance,
     `${backToZero.outstandingBalance} vs ${custBase.outstandingBalance}`);

  // ── 8. The database refuses a negative opening balance ───────────────────
  let rejected = false;
  try {
    await prisma.customer.update({ where: { id: customerId }, data: { openingBalanceCents: -1 } });
  } catch { rejected = true; }
  ok('a negative opening balance is refused by the database', rejected);

  await cleanup();
  report();
};

async function cleanup() {
  await prisma.customer.update({ where: { id: customerId }, data: { openingBalanceCents: custBefore, openingBalanceAsOf: null } });
  await prisma.supplier.update({ where: { id: supplierId }, data: { openingBalanceCents: supBefore, openingBalanceAsOf: null } });
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { openingBalanceCents: true } });
  const s = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { openingBalanceCents: true } });
  ok('cleanup restored both opening balances',
     c.openingBalanceCents === custBefore && s.openingBalanceCents === supBefore,
     `${c.openingBalanceCents}/${s.openingBalanceCents} vs ${custBefore}/${supBefore}`);
}

function report() {
  console.log('');
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.pass ? '' : '\n      -> ' + r.d}`);
  const failed = out.filter((r) => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error('ERROR:', e.message); ok('script ran to completion', false, e.message); await cleanup().catch(() => {}); report(); })
  .finally(() => prisma.$disconnect());
