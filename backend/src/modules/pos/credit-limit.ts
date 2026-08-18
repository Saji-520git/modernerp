// ─── Credit limit ─────────────────────────────────────────────────────────────
//
// Pure decision, no DB, so the rule can be pinned by tests. The caller supplies
// what the customer already owes and what THIS sale puts on credit.
//
// The bug this replaced: the limit was judged before any product had been looked
// up, against a total summed from the optional price-OVERRIDE field. On an
// ordinary sale that field is undefined, so the total was 0 and the limit never
// saw the sale at all — it rejected only customers already over, which is after
// the money is gone. Judge the limit only where the real total is known.

export type CreditLimitInput = {
  /** 0 means "no limit configured" — the check does not apply. */
  limitCents: number;
  /** Warn threshold as a percentage of the limit. */
  alertPct: number;
  /** Outstanding balance before this sale. */
  existingCents: number;
  /** What this sale adds to credit — total MINUS any cash settled at the till. */
  creditPortionCents: number;
};

export type CreditLimitVerdict = {
  allowed: boolean;
  newBalanceCents: number;
  /** How far past the limit the sale would take them. 0 when allowed. */
  overByCents: number;
  /** True when the sale is allowed but crosses the alert threshold. */
  nearLimit: boolean;
};

export function checkCreditLimit(input: CreditLimitInput): CreditLimitVerdict {
  const { limitCents, alertPct, existingCents, creditPortionCents } = input;

  // A split payment can settle more cash than the total; credit never goes
  // negative and must not silently pay down an existing balance.
  const portion    = Math.max(0, creditPortionCents);
  const newBalance = existingCents + portion;

  // No limit configured means unlimited credit — an explicit choice, not an
  // oversight, so it is honoured rather than treated as zero.
  if (limitCents <= 0) {
    return { allowed: true, newBalanceCents: newBalance, overByCents: 0, nearLimit: false };
  }

  if (newBalance > limitCents) {
    return { allowed: false, newBalanceCents: newBalance, overByCents: newBalance - limitCents, nearLimit: true };
  }

  const alertThreshold = Math.round(limitCents * (alertPct / 100));
  return { allowed: true, newBalanceCents: newBalance, overByCents: 0, nearLimit: newBalance > alertThreshold };
}
