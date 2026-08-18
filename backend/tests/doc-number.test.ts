/**
 * Document numbering — max+1, not count+1. Pure functions, no DB.
 *
 * Every generator in the codebase used to derive the next number from a row
 * COUNT. That is fine only while nothing is ever deleted. Delete one sale and
 * the count drops, so the next checkout is handed a number that still exists —
 * and `number` is @unique, so the insert throws and the sale fails at the till.
 * These tests pin the two rules that replaced it: derive from the highest
 * number issued, and let the database settle a genuine race.
 */
import { nextDocNumber, withNumberRetry, type NumberedDelegate } from '../src/utils/doc-number';

/** Stands in for a Prisma delegate: returns the highest matching number. */
function delegate(numbers: string[]): NumberedDelegate {
  return {
    findFirst: async ({ where }) => {
      const hit = numbers
        .filter(n => n.startsWith(where.number.startsWith))
        .sort()
        .pop();
      return hit ? { number: hit } : null;
    },
  };
}

describe('nextDocNumber', () => {
  it('starts at 0001 when nothing has been issued', async () => {
    expect(await nextDocNumber(delegate([]), 'INV-2026-')).toBe('INV-2026-0001');
  });

  it('continues from the highest number issued', async () => {
    const d = delegate(['INV-2026-0001', 'INV-2026-0002', 'INV-2026-0003']);
    expect(await nextDocNumber(d, 'INV-2026-')).toBe('INV-2026-0004');
  });

  it('does NOT reuse a number after an earlier document is deleted', async () => {
    // The count-based bug in one line: 3 issued, middle one deleted, count = 2,
    // so count+1 would hand back INV-2026-0003 — which still exists.
    const d = delegate(['INV-2026-0001', 'INV-2026-0003']);
    expect(await nextDocNumber(d, 'INV-2026-')).toBe('INV-2026-0004');
  });

  it('leaves a gap rather than colliding — a missing number is auditable', async () => {
    const d = delegate(['INV-2026-0001', 'INV-2026-0009']);
    expect(await nextDocNumber(d, 'INV-2026-')).toBe('INV-2026-0010');
  });

  it('scopes to its own prefix, so INV and PO never interfere', async () => {
    const d = delegate(['INV-2026-0007', 'PO-2026-0002', 'CRN-2026-0005']);
    expect(await nextDocNumber(d, 'PO-2026-')).toBe('PO-2026-0003');
  });

  it('rolls into a new year at 0001 without seeing last year', async () => {
    const d = delegate(['INV-2025-0431']);
    expect(await nextDocNumber(d, 'INV-2026-')).toBe('INV-2026-0001');
  });

  it('keeps the suffix fixed-width so string ordering stays numeric', async () => {
    // Lexicographic sort is only correct while every suffix is the same width;
    // this is the case that would break it if padding were ever dropped.
    const d = delegate(['INV-2026-0009']);
    expect(await nextDocNumber(d, 'INV-2026-')).toBe('INV-2026-0010');
  });

  it('widens past the pad rather than truncating', async () => {
    const d = delegate(['INV-2026-9999']);
    expect(await nextDocNumber(d, 'INV-2026-')).toBe('INV-2026-10000');
  });
});

describe('withNumberRetry', () => {
  const p2002 = Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: { target: ['number'] },
  });

  it('returns the first result when nothing collides', async () => {
    const attempt = jest.fn().mockResolvedValue('INV-2026-0001');
    expect(await withNumberRetry(attempt)).toBe('INV-2026-0001');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries a duplicate number and succeeds on the next attempt', async () => {
    // Two tills read the same maximum; the loser re-reads and takes the next.
    const attempt = jest.fn()
      .mockRejectedValueOnce(p2002)
      .mockResolvedValue('INV-2026-0002');
    expect(await withNumberRetry(attempt)).toBe('INV-2026-0002');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget instead of looping forever', async () => {
    const attempt = jest.fn().mockRejectedValue(p2002);
    await expect(withNumberRetry(attempt, 3)).rejects.toBe(p2002);
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('rethrows a unique violation on a DIFFERENT column immediately', async () => {
    // A duplicate SKU is a real error; retrying it would just hide the problem.
    const skuClash = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002', meta: { target: ['sku'] },
    });
    const attempt = jest.fn().mockRejectedValue(skuClash);
    await expect(withNumberRetry(attempt)).rejects.toBe(skuClash);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-P2002 failures immediately — insufficient stock must not retry', async () => {
    const stockErr = Object.assign(new Error('Insufficient stock'), { code: 'P2028' });
    const attempt = jest.fn().mockRejectedValue(stockErr);
    await expect(withNumberRetry(attempt)).rejects.toBe(stockErr);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('rethrows a plain Error with no Prisma code', async () => {
    const boom = new Error('connection reset');
    const attempt = jest.fn().mockRejectedValue(boom);
    await expect(withNumberRetry(attempt)).rejects.toBe(boom);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
