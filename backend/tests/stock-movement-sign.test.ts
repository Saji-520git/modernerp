/**
 * StockMovement sign convention — the ledger invariant. Pure function, no DB.
 *
 * The schema declares qty as "signed: +in, -out", but the sign used to be left
 * to each of a dozen insert sites to remember and two of them got it wrong: the
 * non-POS sale confirm and the purchase return both stored a POSITIVE qty for
 * stock that was leaving, so the audit history showed sales as inbound. These
 * tests pin the rule down now that every writer goes through one helper.
 */
import { signedMovementQty } from '../src/utils/stock-movement';

describe('signedMovementQty', () => {
  const OUT = ['SALE_OUT', 'RETURN_OUT', 'TRANSFER_OUT', 'WRITE_OFF'] as const;
  const IN  = ['PURCHASE_IN', 'RETURN_IN', 'TRANSFER_IN', 'OPENING'] as const;

  it.each(OUT)('%s is stored negative', (type) => {
    expect(signedMovementQty(type, 5)).toBe(-5);
  });

  it.each(OUT)('%s stays negative even when handed a negative qty', (type) => {
    // Call sites used to negate themselves; passing an already-negative value
    // must not flip it back to positive.
    expect(signedMovementQty(type, -5)).toBe(-5);
  });

  it.each(IN)('%s is stored positive', (type) => {
    expect(signedMovementQty(type, 5)).toBe(5);
  });

  it.each(IN)('%s stays positive even when handed a negative qty', (type) => {
    expect(signedMovementQty(type, -5)).toBe(5);
  });

  it('ADJUSTMENT keeps the caller’s sign — it is the one bidirectional type', () => {
    expect(signedMovementQty('ADJUSTMENT', 7)).toBe(7);
    expect(signedMovementQty('ADJUSTMENT', -7)).toBe(-7);
  });

  it('leaves zero alone whichever direction it is', () => {
    expect(signedMovementQty('SALE_OUT', 0)).toBe(0);
    expect(signedMovementQty('PURCHASE_IN', 0)).toBe(0);
  });

  it('a sale and a matching return cancel out in the ledger', () => {
    const sold     = signedMovementQty('SALE_OUT', 3);
    const returned = signedMovementQty('RETURN_IN', 3);
    expect(sold + returned).toBe(0);
  });
});
