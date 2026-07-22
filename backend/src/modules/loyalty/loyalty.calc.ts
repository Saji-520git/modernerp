// ─── Loyalty point maths (pure, DB-free) ─────────────────────────────────────
// Earn = floor(spend / pointsPerAmount). Redeem value = points × pointValueCents.
// All money in integer cents; points are whole integers.

export interface LoyaltyRates {
  isEnabled: boolean;
  pointsPerAmount: number; // cents of spend to earn 1 point
  pointValueCents: number; // cents value of 1 point on redemption
  minRedeemPoints: number;
}

/** Points earned for a spend amount (0 if disabled or misconfigured). */
export function pointsForAmount(spendCents: number, rates: Pick<LoyaltyRates, 'isEnabled' | 'pointsPerAmount'>): number {
  if (!rates.isEnabled || rates.pointsPerAmount <= 0 || spendCents <= 0) return 0;
  return Math.floor(spendCents / rates.pointsPerAmount);
}

/** Cash value (cents) of redeeming N points. */
export function redeemValueCents(points: number, pointValueCents: number): number {
  return Math.max(0, Math.floor(points)) * Math.max(0, pointValueCents);
}

export interface RedeemPlan { points: number; discountCents: number; error?: string }

/**
 * Validate + clamp a redemption request. Returns the points actually spent and
 * the discount cents, or an error (points unchanged, discount 0).
 */
export function planRedemption(
  requestedPoints: number,
  balance: number,
  orderTotalCents: number,
  rates: LoyaltyRates,
): RedeemPlan {
  const pts = Math.floor(requestedPoints);
  if (pts <= 0) return { points: 0, discountCents: 0 };
  if (!rates.isEnabled) return { points: 0, discountCents: 0, error: 'Loyalty is disabled' };
  if (pts > balance) return { points: 0, discountCents: 0, error: 'Not enough points' };
  if (pts < rates.minRedeemPoints) return { points: 0, discountCents: 0, error: `Minimum ${rates.minRedeemPoints} points to redeem` };

  let discount = redeemValueCents(pts, rates.pointValueCents);
  let points = pts;
  // Never discount more than the order total — trim points to fit.
  if (discount > orderTotalCents) {
    if (rates.pointValueCents <= 0) return { points: 0, discountCents: 0, error: 'Point value not configured' };
    points = Math.floor(orderTotalCents / rates.pointValueCents);
    discount = redeemValueCents(points, rates.pointValueCents);
    if (points < rates.minRedeemPoints) return { points: 0, discountCents: 0, error: 'Order total too low to redeem' };
  }
  return { points, discountCents: discount };
}
