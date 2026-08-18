// ─── Shift cash reconciliation ────────────────────────────────────────────────
//
// What the drawer SHOULD hold when a shift closes. Pure, no DB, so the rule can
// be pinned by tests.
//
// The old rule was `openingFloat + cashSalesCents`, where cashSales summed the
// totals of sales whose paymentMethod was CASH. Three other things move real
// money through a till, and none of them is a CASH sale:
//
//   * a split cash+credit sale is filed under CREDIT, so the cash actually
//     handed over was never expected back — the drawer read as a SURPLUS
//   * a customer settling a credit bill in cash fills the drawer
//   * a cash refund empties it — the drawer read as a SHORTAGE
//
// In every case the cashier was asked to explain a variance the system had
// invented. Count what physically moved, not what payment method a row carries.

export type ShiftCashMovements = {
  /** Float the cashier started with. */
  openingFloatCents: number;
  /** Totals of sales paid wholly in cash. */
  cashSalesCents: number;
  /** Cash taken up-front on split cash+credit sales (their paidCents). */
  splitCashCents: number;
  /** Cash taken at this till for credit bills settled here. */
  cashSettlementsCents: number;
  /** Cash handed back out of this till for refunds. */
  cashRefundsCents: number;
};

/** What the drawer should contain. Never negative — a till cannot owe money. */
export function expectedCashCents(m: ShiftCashMovements): number {
  const expected =
      m.openingFloatCents
    + m.cashSalesCents
    + m.splitCashCents
    + m.cashSettlementsCents
    - m.cashRefundsCents;

  // Refunds exceeding everything taken in would imply the drawer owes money,
  // which is not a state a physical till can be in. Clamping keeps the variance
  // pointing at the real discrepancy instead of a negative expectation.
  return Math.max(0, expected);
}

/**
 * Counted minus expected. Positive = surplus in the drawer, negative = short.
 * Kept as its own function so the sign convention is stated in exactly one place
 * — it is the number a cashier is held to.
 */
export function cashVarianceCents(countedCents: number, expected: number): number {
  return countedCents - expected;
}
