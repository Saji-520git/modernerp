// ─── What a customer owes, or what is owed to a supplier ─────────────────────
//
// Pure decision, no DB, so the rule can be pinned by tests.
//
// This exists because the same question was answered in four places with four
// different arithmetics, and they disagreed:
//
//   customers.service getOne   invoiced − returned − paid + opening
//   pos credit-limit check     invoiced − paid + opening        (no returns)
//   customers creditUsed       invoiced − paid + opening        (no returns)
//   payment paths              invoiced − returned − paid       (no opening)
//
// A customer who returned half an order saw one figure on their page and a
// different one enforced at the till, and money sitting on their account was
// ignored by all of them. Each site keeps its own aggregation — the till looks
// only at open invoices, the customer page at every confirmed sale — but the
// arithmetic on top of it now lives here, once.
//
// Four inputs, in the order they apply:
//
//   1. invoiced − returned   goods handed back are not money owed
//   2. − paid                what has actually been settled
//   3. + opening balance     debt carried in from before go-live, which belongs
//                            to no invoice and so is added after the clamp
//   4. − credit balance      unapplied cash the shop is holding for them
//
// Steps 1-2 are clamped at zero before the opening balance is added: an
// overpaid invoice must not quietly erase unrelated legacy debt. The result is
// clamped again, because credit can exceed what is owed — a customer can be in
// hand, and that is a liability, not a negative receivable.

export type OutstandingInput = {
  /** Sum of totalCents across the invoices in scope. */
  invoicedCents: number;
  /** Sum of returns raised against those same invoices. */
  returnedCents: number;
  /** Sum of paidCents across those invoices. */
  paidCents: number;
  /** Balance carried in from before go-live. Belongs to no document. */
  openingBalanceCents: number;
  /** Unapplied cash held on the account. */
  creditBalanceCents: number;
};

/**
 * Net cents the customer owes: zero when they are square or in hand.
 *
 * Use this for anything that judges debt — the credit limit, the outstanding
 * figure on screen, a statement total. It is deliberately NOT the number to
 * show as "credit available to spend"; that is `creditBalanceCents` itself.
 */
export function netOutstandingCents(input: OutstandingInput): number {
  const {
    invoicedCents, returnedCents, paidCents,
    openingBalanceCents, creditBalanceCents,
  } = input;

  const onInvoices = Math.max(0, invoicedCents - returnedCents - paidCents);
  const grossOwed  = onInvoices + openingBalanceCents;

  return Math.max(0, grossOwed - creditBalanceCents);
}
