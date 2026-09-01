// ─── Store credit owed by a return ────────────────────────────────────────────
//
// Pure decision, no DB, so the rule can be pinned by tests.
//
// The naive rule — "refundMethod NONE means credit the customer the return
// total" — is wrong, and wrong in the expensive direction. A return first
// CANCELS what is still owed on the invoice; only what the customer has
// actually handed over beyond that is money the shop is holding for them.
//
// Crediting the full return value on an unpaid invoice would pay the customer
// twice: once by reducing the debt (the outstanding balance is derived from
// total − returned − paid) and again as a credit balance they can spend.
//
// So: re-total the invoice net of every return against it, and compare with
// what has been paid. Anything paid above the new total is unapplied cash.
//
//   invoice 10,000, paid 10,000, return 3,000  → effective 7,000 → credit 3,000
//   invoice 10,000, paid      0, return 3,000  → effective 7,000 → credit     0
//                                                (debt drops to 7,000 instead)
//   invoice 10,000, paid  4,000, return 3,000  → effective 7,000 → credit     0
//                                                (still owes 3,000)
//   invoice 10,000, paid  9,000, return 3,000  → effective 7,000 → credit 2,000
//
// A cash/card/bank refund is handled by passing the ALREADY-REDUCED paid
// figure: the money left in cash, so it is no longer sitting on the account.
// That keeps one rule for every refund method instead of branching per method.

export type ReturnCreditInput = {
  /** The invoice total, unchanged by returns. */
  saleTotalCents: number;
  /** Every return raised against this invoice INCLUDING the one being created. */
  returnedCentsIncludingThis: number;
  /** What the customer has paid, AFTER subtracting any cash/card refund just given. */
  paidCentsAfterRefund: number;
};

/**
 * Cents to park on the customer's account as unapplied credit. Zero when the
 * return merely cancels debt, which is the common case on a credit sale.
 */
export function creditToIssueCents(input: ReturnCreditInput): number {
  const { saleTotalCents, returnedCentsIncludingThis, paidCentsAfterRefund } = input;

  // Returns can never take the invoice below zero, even if someone returns more
  // than was billed (over-credit on a price-adjusted line, say).
  const effectiveTotalCents = Math.max(0, saleTotalCents - returnedCentsIncludingThis);

  return Math.max(0, paidCentsAfterRefund - effectiveTotalCents);
}

/**
 * How much NEW credit a return adds.
 *
 * `creditToIssueCents` answers a question about STATE — "given this invoice as
 * it now stands, how much unapplied cash is sitting on it" — not about an
 * event. A second return against the same invoice recomputes the same
 * cumulative figure, so incrementing the customer's balance by it directly
 * would credit the first return's amount twice.
 *
 * Callers therefore credit the DIFFERENCE between the invoice before and after
 * this return.
 *
 * Historical note: returns raised before store credit existed never issued any,
 * so `before` may describe credit that was never actually granted. That is
 * deliberate — the first return after the upgrade credits only its own delta
 * rather than retroactively inventing a liability for past returns.
 */
export function creditIncrementCents(
  before: ReturnCreditInput,
  after:  ReturnCreditInput,
): number {
  return Math.max(0, creditToIssueCents(after) - creditToIssueCents(before));
}
