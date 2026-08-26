// Does the aging report bucket debt correctly, and do the buckets add up?
//
// An aging report that does not reconcile to the outstanding total is worse
// than none: it looks precise while quietly losing money between buckets.
// These check the arithmetic against the same figures the rest of the app
// reports, and that a debt lands in the bucket its age actually says.
import { PrismaClient } from '@prisma/client';
import { reportsService } from '../dist/modules/reports/reports.service.js';

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });
const rs = (c) => `Rs. ${(c / 100).toFixed(2)}`;

let custId = null, custBefore = 0, custDateBefore = null;

const main = async () => {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  const dueDays  = settings?.invoiceDueDays ?? 30;

  // ── Receivables ───────────────────────────────────────────────────────────
  const recv = await reportsService.aging('receivable');
  ok(`report knows the terms (${recv.dueDays}-day)`, recv.dueDays === dueDays, `${recv.dueDays} vs ${dueDays}`);

  const bucketSum = recv.rows.reduce(
    (s, r) => s + r.current + r.d1_30 + r.d31_60 + r.d61_90 + r.d90_plus, 0);
  ok('every row\'s buckets add up to its own total',
     recv.rows.every((r) => r.current + r.d1_30 + r.d31_60 + r.d61_90 + r.d90_plus === r.total),
     recv.rows.map((r) => `${r.name}:${r.total}`).join(' '));
  ok('bucket totals reconcile to the grand total',
     bucketSum === recv.totals.grand, `buckets=${bucketSum} grand=${recv.totals.grand}`);
  ok('overdue is the grand total minus current',
     recv.totals.overdue === recv.totals.grand - recv.totals.current,
     `overdue=${recv.totals.overdue} grand-current=${recv.totals.grand - recv.totals.current}`);

  // Cross-check against what the customer service says each contact owes.
  let matched = 0, mismatch = [];
  for (const row of recv.rows) {
    const detail = await (await import('../dist/modules/customers/customers.service.js'))
      .customersService.getOne(row.id);
    if (detail.outstandingBalance === row.total) matched++;
    else mismatch.push(`${row.name}: aging=${row.total} detail=${detail.outstandingBalance}`);
  }
  ok(`each contact's aging total matches their outstanding balance (${matched}/${recv.rows.length})`,
     mismatch.length === 0, mismatch.join(' | '));

  // ── Payables ──────────────────────────────────────────────────────────────
  const pay = await reportsService.aging('payable');
  ok('payable buckets reconcile too',
     pay.rows.reduce((s, r) => s + r.current + r.d1_30 + r.d31_60 + r.d61_90 + r.d90_plus, 0) === pay.totals.grand,
     `grand=${pay.totals.grand}`);
  ok('payables are a different population from receivables',
     pay.type === 'payable' && recv.type === 'receivable');

  // ── An opening balance is aged, not ignored ───────────────────────────────
  const c = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true, name: true, openingBalanceCents: true, openingBalanceAsOf: true } });
  custId = c.id; custBefore = c.openingBalanceCents; custDateBefore = c.openingBalanceAsOf;

  // Dated 200 days ago: comfortably past due, so it must land in 90+.
  const old = new Date(Date.now() - 200 * 86_400_000);
  await prisma.customer.update({ where: { id: custId }, data: { openingBalanceCents: 7_000_00, openingBalanceAsOf: old } });
  const withOpening = await reportsService.aging('receivable');
  const row = withOpening.rows.find((r) => r.id === custId);
  ok('an opening balance appears in the aging report', !!row && row.openingCents === 7_000_00,
     `opening=${row?.openingCents}`);
  ok('a 200-day-old opening balance lands in 90+, not current',
     !!row && row.d90_plus >= 7_000_00 && row.current === 0,
     `90+=${row?.d90_plus} current=${row?.current}`);
  ok('the report says how much of the total is opening balance',
     withOpening.totals.openingCents >= 7_000_00, `${rs(withOpening.totals.openingCents)}`);

  // Undated opening balance must be treated as OLD, never as current — an
  // unknown age on carried-forward debt is far likelier to be stale.
  await prisma.customer.update({ where: { id: custId }, data: { openingBalanceAsOf: null } });
  const undated = await reportsService.aging('receivable');
  const uRow = undated.rows.find((r) => r.id === custId);
  ok('an undated opening balance is aged as oldest, not newest',
     !!uRow && uRow.d90_plus >= 7_000_00 && uRow.current === 0,
     `90+=${uRow?.d90_plus} current=${uRow?.current}`);

  // ── asOf moves the buckets ────────────────────────────────────────────────
  await prisma.customer.update({ where: { id: custId }, data: { openingBalanceAsOf: old } });
  const backThen = await reportsService.aging('receivable', new Date(Date.now() - 190 * 86_400_000));
  const bRow = backThen.rows.find((r) => r.id === custId);
  ok('asOf re-ages the debt — 10 days after it was raised it is not yet 90+',
     !!bRow && bRow.d90_plus === 0,
     `90+=${bRow?.d90_plus} current=${bRow?.current} 1-30=${bRow?.d1_30}`);

  // ── Nothing owed is not an error ──────────────────────────────────────────
  ok('rows are sorted with the largest debt first',
     recv.rows.every((r, i, a) => i === 0 || a[i - 1].total >= r.total));

  await cleanup();
  report();
};

async function cleanup() {
  if (custId) {
    await prisma.customer.update({
      where: { id: custId },
      data:  { openingBalanceCents: custBefore, openingBalanceAsOf: custDateBefore },
    });
    const back = await prisma.customer.findUnique({ where: { id: custId }, select: { openingBalanceCents: true } });
    ok('cleanup restored the opening balance', back.openingBalanceCents === custBefore,
       `${back.openingBalanceCents} vs ${custBefore}`);
  }
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
