// ─── What a return does to loyalty points ─────────────────────────────────────
//
// Pure decision, no DB, so the rule can be pinned by tests.
//
// Without this a customer can extract value on a loop: buy, collect the points,
// return the goods, keep the points, repeat. Nothing in the return path touched
// loyalty, so a fully returned Rs.5,000 sale left every point earned on it
// sitting in the balance.
//
// A return moves BOTH directions, and missing either one is unfair to somebody:
//
//   * points EARNED on the sale are clawed back — the purchase that justified
//     them is being undone.
//   * points REDEEMED on the sale are given BACK. The redemption was a discount
//     applied to the invoice total, and a return refunds that already-discounted
//     total (see return-value.ts). Cancelling the sale without returning the
//     points would charge the customer twice for the same discount: once in the
//     smaller refund, once in the points they no longer hold.
//
// Both scale with how much of the invoice came back, so a half return reverses
// half the points.
//
// Like store credit, this is a STATE function turned into a delta by the
// caller: it answers "given this much of the invoice returned, how many points
// should have been reversed in total", and the difference between before and
// after is what a particular return actually moves. Recomputing the cumulative
// figure and applying it directly would reverse the first return's points again
// on the second.

export type LoyaltyReturnInput = {
  /** Points the sale awarded, from Sale.pointsEarned. */
  pointsEarnedOnSale: number;
  /** Points the sale consumed as a discount, from Sale.pointsRedeemed. */
  pointsRedeemedOnSale: number;
  /** The invoice total the customer was actually charged. */
  saleTotalCents: number;
  /** Value of returns against this invoice BEFORE the one being made. */
  returnedCentsBefore: number;
  /** Value of returns against this invoice INCLUDING the one being made. */
  returnedCentsAfter: number;
};

export type LoyaltyReturnDelta = {
  /** Points to take back off the balance (positive number, subtracted by caller). */
  earnedReversal: number;
  /** Points to hand back to the balance (positive number, added by caller). */
  redeemRestore: number;
};

/** Fraction of the invoice returned, clamped to 0..1. */
function ratio(returnedCents: number, saleTotalCents: number): number {
  if (saleTotalCents <= 0) return 0;      // nothing to prorate against
  if (returnedCents <= 0) return 0;
  return Math.min(1, returnedCents / saleTotalCents);
}

/**
 * Points this particular return moves, given what earlier returns already
 * moved. Both numbers are non-negative; the caller subtracts `earnedReversal`
 * and adds `redeemRestore`.
 */
export function loyaltyReturnDelta(input: LoyaltyReturnInput): LoyaltyReturnDelta {
  const {
    pointsEarnedOnSale, pointsRedeemedOnSale, saleTotalCents,
    returnedCentsBefore, returnedCentsAfter,
  } = input;

  const rBefore = ratio(returnedCentsBefore, saleTotalCents);
  const rAfter  = ratio(returnedCentsAfter,  saleTotalCents);

  // Rounded at the cumulative figure, not per return, so a sequence of partial
  // returns can never reverse more points than the sale ever awarded.
  const earnedBefore = Math.round(Math.max(0, pointsEarnedOnSale) * rBefore);
  const earnedAfter  = Math.round(Math.max(0, pointsEarnedOnSale) * rAfter);

  const redeemBefore = Math.round(Math.max(0, pointsRedeemedOnSale) * rBefore);
  const redeemAfter  = Math.round(Math.max(0, pointsRedeemedOnSale) * rAfter);

  return {
    earnedReversal: Math.max(0, earnedAfter - earnedBefore),
    redeemRestore:  Math.max(0, redeemAfter - redeemBefore),
  };
}
