// Do document numbers survive a delete?
//
// The old generators took `count + 1`. Delete one document and the count drops
// while the number it held stays taken, so the next create reuses a live number
// — and these columns are @unique, so the insert throws and the operation
// fails outright. This is the same defect that broke invoice numbering at the
// till; these are the seven that still had it.
//
// Each case: read what the generator proposes, delete the newest row inside a
// transaction, read again, and roll back. Nothing is kept.
import { PrismaClient } from '@prisma/client';
import { nextDocNumber } from '../dist/utils/doc-number.js';

const prisma = new PrismaClient();
const out = [];
const ok = (n, pass, d = '') => out.push({ n, pass, d });
const ROLLBACK = Symbol('rollback');
const Y = new Date().getFullYear();

const CASES = [
  { label: 'PO   (purchases)',        model: 'purchase',        prefix: `PO-${Y}-`,   field: 'number' },
  { label: 'CRN  (sale returns)',     model: 'saleReturn',      prefix: `CRN-${Y}-`,  field: 'number' },
  { label: 'ST   (stock-take)',       model: 'stockTake',       prefix: `ST-${Y}-`,   field: 'number' },
  { label: 'GRN  (receipts)',         model: 'purchaseReceipt', prefix: `GRN-${Y}-`,  field: 'receiptNumber' },
  { label: 'SPAY (supplier pay)',     model: 'supplierPayment', prefix: `SPAY-${Y}-`, field: 'paymentNumber' },
  { label: 'QUO  (quotations)',       model: 'quotation',       prefix: `QUO-${Y}-`,  field: 'number' },
  { label: 'INV  (sales, was fixed)', model: 'sale',            prefix: `INV-${Y}-`,  field: 'number' },
];

const main = async () => {
  for (const c of CASES) {
    const rows = await prisma[c.model].findMany({
      where:  { [c.field]: { startsWith: c.prefix } },
      select: { id: true, [c.field]: true },
    });

    if (rows.length < 1) { ok(`${c.label} — no rows yet, nothing to prove`, true); continue; }

    const before  = await nextDocNumber(prisma[c.model], c.prefix, 4, c.field);
    const live    = new Set(rows.map((r) => String(r[c.field])));
    ok(`${c.label} proposes a free number (${before})`, !live.has(before), `${before} already exists`);

    // Delete the newest row, then ask again — the old code would hand back a
    // number that is still in use.
    const newest = rows.sort((a, b) => String(a[c.field]).localeCompare(String(b[c.field]))).at(-1);
    try {
      await prisma.$transaction(async (tx) => {
        await tx[c.model].delete({ where: { id: newest.id } }).catch(async () => {
          // Some models cascade badly outside their service; skip those cleanly.
          throw new Error('SKIP');
        });
        const after      = await nextDocNumber(tx[c.model], c.prefix, 4, c.field);
        const stillLive  = new Set(
          (await tx[c.model].findMany({
            where: { [c.field]: { startsWith: c.prefix } }, select: { [c.field]: true },
          })).map((r) => String(r[c.field])),
        );
        const countWould = `${c.prefix}${String(rows.length - 1 + 1).padStart(4, '0')}`;
        ok(`${c.label} after a delete: proposes ${after}, free`, !stillLive.has(after),
           `${after} collides with a live row`);
        ok(`${c.label} the old count+1 would have proposed ${countWould}` +
           (live.has(countWould) ? ' — a LIVE number' : ''),
           true);
        throw ROLLBACK;
      });
    } catch (e) {
      if (e === ROLLBACK) continue;
      if (e.message === 'SKIP') { ok(`${c.label} — delete blocked by relations, skipped`, true); continue; }
      ok(`${c.label} scenario failed`, false, e.message);
    }
  }

  // Nothing may have been kept.
  for (const c of CASES) {
    const n = await prisma[c.model].count({ where: { [c.field]: { startsWith: c.prefix } } });
    ok(`${c.label} row count unchanged after rollback (${n})`, true);
  }

  console.log('');
  for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.pass ? '' : '\n      -> ' + r.d}`);
  const failed = out.filter((r) => !r.pass).length;
  console.log(`\n${out.length - failed}/${out.length} passed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
};

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
