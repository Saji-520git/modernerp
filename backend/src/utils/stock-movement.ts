import type { Prisma, StockMoveType } from '@prisma/client';

// ─── StockMovement sign convention ────────────────────────────────────────────
//
// StockMovement.qty is a SIGNED ledger quantity — the schema states it plainly:
// "signed: +in, -out". The sign must always encode the direction of the move.
//
// This was previously left to each of the dozen call sites to remember, and two
// of them got it wrong (the non-POS sale confirm and the purchase return both
// stored a positive qty for stock that was leaving), which produced an audit
// history showing sales as inbound. Readers then compensated by re-deriving the
// sign from the type — in one page but not another, so the two disagreed.
//
// Writing through `recordStockMovement` makes the invariant structural: the sign
// is derived from the movement type, so a caller cannot get it wrong.

const OUT_TYPES: readonly StockMoveType[] = ['SALE_OUT', 'RETURN_OUT', 'TRANSFER_OUT', 'WRITE_OFF'];
const IN_TYPES:  readonly StockMoveType[] = ['PURCHASE_IN', 'RETURN_IN', 'TRANSFER_IN', 'OPENING'];

/**
 * Normalizes a movement quantity so its sign matches the movement's direction.
 *
 * OUT types → always negative · IN types → always positive.
 * ADJUSTMENT is the one genuinely bidirectional type: the caller supplies a
 * signed delta (negative to remove, positive to add) and it is passed through
 * untouched.
 */
export function signedMovementQty(type: StockMoveType, qty: number): number {
  // `|| 0` collapses negative zero: -Math.abs(0) is -0, which is pointless in a
  // ledger and surprises strict comparisons.
  if (OUT_TYPES.includes(type)) return -Math.abs(qty) || 0;
  if (IN_TYPES.includes(type))  return  Math.abs(qty);
  return qty; // ADJUSTMENT — caller-signed delta
}

export type StockMovementInput =
  Omit<Prisma.StockMovementUncheckedCreateInput, 'qty'> & { qty: number | Prisma.Decimal };

/**
 * Creates a StockMovement with a direction-correct sign. Use this instead of
 * `tx.stockMovement.create` so the ledger invariant holds at every call site.
 *
 * Note this only records the ledger row — it never moves stock itself. Stock
 * quantities are owned by Stock/StockBatch and adjusted separately by the
 * caller; nothing in the system derives on-hand quantity from this table.
 */
export async function recordStockMovement(
  tx: Prisma.TransactionClient,
  data: StockMovementInput,
) {
  return tx.stockMovement.create({
    data: { ...data, qty: signedMovementQty(data.type, Number(data.qty)) },
  });
}
