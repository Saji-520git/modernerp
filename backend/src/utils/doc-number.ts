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
 * Next sequential document number for a year-scoped prefix, e.g. "INV-2026-".
 * Ordering is lexicographic, which is correct because the suffix is fixed-width
 * and zero-padded.
 */
export async function nextDocNumber(
  model: NumberedDelegate,
  prefix: string,
  pad = 4,
): Promise<string> {
  const last = await model.findFirst({
    where:   { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select:  { number: true },
  });
  const lastSeq = last ? Number.parseInt(last.number.slice(prefix.length), 10) : 0;
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
export async function withNumberRetry<T>(attempt: () => Promise<T>, tries = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await attempt();
    } catch (err) {
      const code = (err as Prisma.PrismaClientKnownRequestError)?.code;
      const target = String((err as { meta?: { target?: unknown } })?.meta?.target ?? '');
      if (code !== 'P2002' || !target.includes('number')) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}
