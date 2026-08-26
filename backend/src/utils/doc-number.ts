import type { Prisma } from '@prisma/client';

// ─── Document numbering ───────────────────────────────────────────────────────
//
// Numbers are derived from the HIGHEST number already issued, never from a row
// count. Counting looks equivalent and is not:
//
//   * delete one document and the count drops, so the next one REUSES a number
//     that still exists — and `number` is @unique, so the insert throws and the
//     sale fails at the till
//   * two checkouts at once read the same count and generate the same number;
//     one of them dies on the unique constraint
//   * once the count stops tracking the maximum, numbers visibly skip
//
// Taking max + 1 is stable under deletes and leaves gaps rather than collisions,
// which is what an audit trail wants: a missing invoice number is a question, a
// duplicated one is a contradiction.

/**
 * Any Prisma delegate carrying a `number` column — `prisma.sale`, `tx.sale`,
 * `prisma.purchase`, and so on. Structural rather than generic so one helper
 * serves every document type, and so a transaction client passes as readily as
 * the base client.
 */
export type NumberedDelegate = {
  findFirst(args: {
    where:   { number: { startsWith: string } };
    orderBy: { number: 'desc' };
    select:  { number: true };
  }): Promise<{ number: string } | null>;
};

/**
 * Same idea for models whose column is not literally called `number` —
 * PurchaseReceipt uses `receiptNumber`, SupplierPayment uses `paymentNumber`.
 * The shape cannot be expressed with a fixed key, so the field is passed in and
 * the args are built dynamically.
 */
// `any` is deliberate and contained here. Prisma types findFirst through
// SelectSubset<T, ...>, which resolves the allowed keys from a literal argument
// — a key computed at runtime cannot satisfy it, and every stricter shape is
// rejected at the call site. The looseness stops at this boundary: `field` is
// supplied by the two call sites that need it, and the result is read back as a
// string below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNumberedDelegate = { findFirst: (args: any) => Promise<any> };

/**
 * Next sequential document number for a year-scoped prefix, e.g. "INV-2026-".
 * Ordering is lexicographic, which is correct because the suffix is fixed-width
 * and zero-padded.
 *
 * @param field the column holding the number, when it is not called `number`
 */
export async function nextDocNumber(
  model: NumberedDelegate | AnyNumberedDelegate,
  prefix: string,
  pad = 4,
  field = 'number',
): Promise<string> {
  const last = await (model as AnyNumberedDelegate).findFirst({
    where:   { [field]: { startsWith: prefix } },
    orderBy: { [field]: 'desc' },
    select:  { [field]: true },
  });
  const raw     = last ? String(last[field] ?? '') : '';
  const lastSeq = raw ? Number.parseInt(raw.slice(prefix.length), 10) : 0;
  const next    = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${prefix}${String(next).padStart(pad, '0')}`;
}

/**
 * Runs `attempt` and retries when the unique constraint on `number` rejects it.
 *
 * Two tills can still read the same maximum in the instant before either has
 * committed. The database is the only authority that can settle that, so let it:
 * on a P2002 the number is stale by definition, and re-reading the maximum
 * yields the next free one.
 */
// Attempts, not retries. The budget has to EXCEED the number of writers that
// can tie: in the worst case exactly one of them wins each round, so N
// contenders need up to N attempts. At 5 this was arithmetically short of six
// simultaneous purchase orders - two runs in eight lost one. Retries only ever
// happen on a collision, so a larger budget costs nothing the rest of the time.
export async function withNumberRetry<T>(attempt: () => Promise<T>, tries = 12): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await attempt();
    } catch (err) {
      const code = (err as Prisma.PrismaClientKnownRequestError)?.code;
      // Lower-cased before matching: the column is `number` on most documents
      // but `receiptNumber` on a GRN and `paymentNumber` on a supplier payment,
      // and a case-sensitive test silently skipped the retry for those two —
      // the collision would surface as a raw 500 instead of a fresh number.
      const target = String((err as { meta?: { target?: unknown } })?.meta?.target ?? '').toLowerCase();
      if (code !== 'P2002' || !target.includes('number')) throw err;
      lastErr = err;
      // Back off, jittered, before re-reading the maximum.
      //
      // Without this every loser of a collision re-reads at the same instant
      // and ties again on the same number, so the budget burns on one contested
      // slot instead of resolving it: six simultaneous purchase orders left one
      // failing after five attempts. The wait only ever happens on a collision.
      await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 25)));
    }
  }
  throw lastErr;
}
