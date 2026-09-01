// ─── What a returned unit is worth ────────────────────────────────────────────
//
// Pure decision, no DB, so the rule can be pinned by tests.
//
// The return form valued a line at `unitPriceCents × qty` — the LIST price off
// the original sale line. That is not what the customer paid. By the time an
// invoice is settled the figure has been reduced by, in order:
//
//   * the line's own discount        (SaleLine.discountCents)
//   * a cart-level discount           (Sale.discountCents)
//   * any promotion the engine applied
//   * loyalty points redeemed as a discount
//   * tax, applied to the discounted amount
//
// So every discounted sale refunded MORE than was taken. Not a fraud vector —
// an ordinary sale on a promotion, over-refunded every time, silently.
//
// Rather than reconstruct each of those components in reverse (which would need
// to track promotion and loyalty allocation per line, and would drift the first
// time either changed), value a return against what was ACTUALLY CHARGED:
//
//     unit refund = saleTotal × (lineTotal / Σ lineTotals) ÷ qtySold
//
// The line's share of the gross carries every cart-level reduction with it,
// proportionally, because the numerator is the real invoice total. Returning
// every line at full quantity therefore refunds exactly the invoice, whatever
// combination of discounts produced it.
//
// Rounding is deliberately done ONCE, per unit, so the figure the form shows
// and the figure the server stores are the same integer — a per-line rounding
// would let the two drift by a cent and make the receipt look wrong. The caller
// still caps the cumulative total, so repeated rounding can never add up past
// what was charged.

export type RefundUnitInput = {
  /** What the customer was actually charged for the whole invoice. */
  saleTotalCents: number;
  /** Σ lineTotalCents across every line of the invoice, before cart-level cuts. */
  grossLinesCents: number;
  /** This line's own lineTotalCents. */
  lineTotalCents: number;
  /** Quantity originally sold on this line. */
  qtySold: number;
};

/**
 * Cents to refund per unit returned from this line. Zero when the invoice
 * carries no value or the line sold nothing — both of which would otherwise
 * divide by zero.
 */
export function refundUnitCents(input: RefundUnitInput): number {
  const { saleTotalCents, grossLinesCents, lineTotalCents, qtySold } = input;

  if (grossLinesCents <= 0 || qtySold <= 0 || saleTotalCents <= 0) return 0;
  if (lineTotalCents <= 0) return 0;

  const lineShareCents = (saleTotalCents * lineTotalCents) / grossLinesCents;
  return Math.round(lineShareCents / qtySold);
}

/**
 * What this return may be worth in total, never more than the invoice has left
 * to give. Stops rounding drift, and a re-priced or over-quantity line, from
 * refunding past what was charged.
 */
export function cappedReturnTotalCents(
  requestedCents: number,
  saleTotalCents: number,
  alreadyReturnedCents: number,
): number {
  const remaining = Math.max(0, saleTotalCents - alreadyReturnedCents);
  return Math.max(0, Math.min(requestedCents, remaining));
}

/**
 * What may actually be handed back in cash/card/bank.
 *
 * Two ceilings, both previously absent: the return's own value, and what the
 * customer has actually paid. `refundedCents` arrived from the client validated
 * only as a non-negative integer, so a Rs.100 return could refund Rs.10,000 and
 * write a matching negative Payment row. Anything paid above these belongs on
 * account as credit, not in the drawer.
 */
export function cappedRefundCents(
  requestedCents: number,
  returnTotalCents: number,
  salePaidCents: number,
): number {
  return Math.max(0, Math.min(requestedCents, returnTotalCents, salePaidCents));
}
