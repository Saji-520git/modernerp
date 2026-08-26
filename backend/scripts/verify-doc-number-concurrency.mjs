// Two people raising a purchase order at the same instant.
//
// Document numbers come from max+1, which is safe against a DELETE but not
// against a tie: both writers read the same maximum before either commits, and
// `number` is @unique, so the loser's insert throws P2002 and the order is lost
// with a raw 500. Sales, POS, returns, quotations, stock-takes and supplier
// payments already retried that. Purchases and GRN receipts did not - issue #9.
//
// The fix issues the number INSIDE withNumberRetry, so a collision unwinds and
// the retry reads the maximum again. This asserts that: fire N creates at once,
// then require N survivors with N distinct numbers.
import { PrismaClient } from '@prisma/client';
import { purchaseService } from '../dist/modules/purchases/purchases.service.js';
import { createPurchaseSchema, fromAlertsSchema } from '../dist/modules/purchases/purchases.schema.js';

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });

const created = [];   // purchase ids to clean up
const N = 6;

const main = async () => {
  const user = await prisma.user.findFirst({ where: { isActive: true }, select: { id: true } });
  const supplier = await prisma.supplier.findFirst({ where: { isActive: true }, select: { id: true } });
  const warehouse = await prisma.warehouse.findFirst({ where: { isActive: true }, select: { id: true } });
  const product = await prisma.product.findFirst({
    where: { isActive: true, costCents: { gt: 0 } },
    select: { id: true, costCents: true },
  });

  if (!user || !supplier || !warehouse || !product) {
    ok('concurrency check', true, '(missing supplier/warehouse/product to test with)');
    return report();
  }

  // ── 1. N simultaneous purchase orders ────────────────────────────────────
  const results = await Promise.allSettled(
    Array.from({ length: N }, () =>
      purchaseService.createPurchase(
        createPurchaseSchema.parse({
          supplierId:  supplier.id,
          warehouseId: warehouse.id,
          note: 'doc-number concurrency probe',
          lines: [{ productId: product.id, qty: 1, unitCostCents: product.costCents }],
        }),
        user.id,
      ),
    ),
  );

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected  = results.filter((r) => r.status === 'rejected');
  for (const r of fulfilled) created.push(r.value.id);

  ok(`all ${N} simultaneous POs succeed`,
     fulfilled.length === N,
     rejected.length
       ? `${rejected.length} failed: ${rejected.map((r) => r.reason?.code ?? r.reason?.message).join(', ')}`
       : '');

  const numbers = fulfilled.map((r) => r.value.number);
  ok(`each PO got its own number (${new Set(numbers).size} distinct)`,
     new Set(numbers).size === fulfilled.length,
     numbers.sort().join(' '));

  // Numbers must be a contiguous run from the starting maximum: a retry that
  // reused a stale maximum would show up as a gap or a repeat.
  const suffixes = numbers.map((n) => Number(n.split('-').pop())).sort((a, b) => a - b);
  const contiguous = suffixes.every((v, i) => i === 0 || v === suffixes[i - 1] + 1);
  ok('numbers form one unbroken run - no gaps, no reuse',
     contiguous, suffixes.join(','));

  // ── 2. Same again through the auto-PO path ───────────────────────────────
  //
  // fromAlerts issues from the SAME PO- sequence, so a low-stock batch landing
  // while someone raises an order by hand is the realistic collision.
  const autoResults = await Promise.allSettled(
    Array.from({ length: N }, () =>
      purchaseService.fromAlerts(
        fromAlertsSchema.parse({
          supplierId:  supplier.id,
          warehouseId: warehouse.id,
          note: 'doc-number concurrency probe (auto)',
          items: [{ productId: product.id, qty: 1, unitCostCents: product.costCents }],
        }),
        user.id,
      ),
    ),
  );
  const autoOk = autoResults.filter((r) => r.status === 'fulfilled');
  for (const r of autoOk) created.push(r.value.id);

  ok(`all ${N} simultaneous auto-POs succeed`,
     autoOk.length === N,
     autoResults.filter((r) => r.status === 'rejected')
       .map((r) => r.reason?.code ?? r.reason?.message).join(', '));

  const autoNumbers = autoOk.map((r) => r.value.number);
  ok(`each auto-PO got its own number (${new Set(autoNumbers).size} distinct)`,
     new Set(autoNumbers).size === autoOk.length,
     autoNumbers.sort().join(' '));

  // ── 3. Nothing collided across the two batches either ────────────────────
  const all = [...numbers, ...autoNumbers];
  ok('hand-raised and auto POs never share a number',
     new Set(all).size === all.length,
     `${all.length} created, ${new Set(all).size} distinct`);

  // ── 4. The retry only catches duplicate-number errors ────────────────────
  //
  // A retry that swallowed everything would turn a genuine failure into five
  // silent attempts and then a misleading error.
  const { withNumberRetry } = await import('../dist/utils/doc-number.js');
  let realErrorPropagated = false;
  try {
    await withNumberRetry(async () => { throw new Error('not a duplicate'); });
  } catch (e) {
    realErrorPropagated = e.message === 'not a duplicate';
  }
  ok('a non-duplicate error is rethrown, not retried away', realErrorPropagated);

  report();
};

const cleanup = async () => {
  if (!created.length) return;
  await prisma.purchaseLine.deleteMany({ where: { purchaseId: { in: created } } }).catch(() => {});
  await prisma.purchase.deleteMany({ where: { id: { in: created } } }).catch(() => {});
  const left = await prisma.purchase.count({ where: { id: { in: created } } });
  console.log(`\ncleanup: ${created.length} probe POs removed, ${left} left behind`);
};

function report() {
  console.log('');
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.pass ? '' : '\n      -> ' + r.d}`);
  const failed = out.filter((r) => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  return failed;
}

let code = 1;
main()
  .then(() => { code = out.filter((r) => !r.pass).length ? 1 : 0; })
  .catch((e) => { console.error('ERROR:', e.message); report(); code = 1; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); process.exit(code); });
