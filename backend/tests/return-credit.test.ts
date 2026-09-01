import { creditToIssueCents, creditIncrementCents, type ReturnCreditInput } from '../src/modules/sales/return-credit';

const input = (o: Partial<ReturnCreditInput> = {}): ReturnCreditInput => ({
  saleTotalCents:             1_000_000,   // Rs.10,000
  returnedCentsIncludingThis:   300_000,   // Rs.3,000 returned
  paidCentsAfterRefund:       1_000_000,   // fully paid
  ...o,
});

describe('return credit', () => {
  it('credits a paid invoice for what was handed back', () => {
    // Paid in full, returns Rs.3,000 of goods → Rs.3,000 is the shop's to hold.
    expect(creditToIssueCents(input())).toBe(300_000);
  });

  it('credits NOTHING on an unpaid invoice — the return cancels debt instead', () => {
    // This is the case that would double-pay the customer: the outstanding
    // balance already nets returns, so crediting as well pays them twice.
    expect(creditToIssueCents(input({ paidCentsAfterRefund: 0 }))).toBe(0);
  });

  it('credits nothing while the customer still owes something', () => {
    // Paid Rs.4,000 of Rs.10,000; return drops the bill to Rs.7,000 — still owes.
    expect(creditToIssueCents(input({ paidCentsAfterRefund: 400_000 }))).toBe(0);
  });

  it('credits only the overpaid slice on a part-paid invoice', () => {
    // Paid Rs.9,000, bill drops to Rs.7,000 → Rs.2,000 overpaid.
    expect(creditToIssueCents(input({ paidCentsAfterRefund: 900_000 }))).toBe(200_000);
  });

  it('credits nothing when a cash refund already returned the money', () => {
    // Paid 10,000, refunded 3,000 in cash → paid-after-refund 7,000 = new total.
    expect(creditToIssueCents(input({ paidCentsAfterRefund: 700_000 }))).toBe(0);
  });

  it('credits the remainder when the cash refund was only partial', () => {
    // Paid 10,000, only Rs.1,000 handed back in cash → 9,000 against a 7,000 bill.
    expect(creditToIssueCents(input({ paidCentsAfterRefund: 900_000 }))).toBe(200_000);
  });

  it('handles a fully returned, fully paid invoice', () => {
    expect(creditToIssueCents(input({ returnedCentsIncludingThis: 1_000_000 }))).toBe(1_000_000);
  });

  it('never lets the invoice go negative when returns exceed the total', () => {
    // Over-credit (a price-adjusted line, say) must not inflate the credit
    // beyond what was actually paid.
    expect(creditToIssueCents(input({ returnedCentsIncludingThis: 1_500_000 }))).toBe(1_000_000);
  });

  it('never returns a negative credit', () => {
    expect(creditToIssueCents(input({
      returnedCentsIncludingThis: 0,
      paidCentsAfterRefund:       0,
    }))).toBe(0);
  });

  it('is a STATE figure, cumulative across returns — not per-return', () => {
    expect(creditToIssueCents(input({ returnedCentsIncludingThis: 300_000 }))).toBe(300_000);
    expect(creditToIssueCents(input({ returnedCentsIncludingThis: 500_000 }))).toBe(500_000);
  });
});

describe('return credit increment', () => {
  it('credits only what THIS return adds, never the running total', () => {
    // Rs.3,000 already returned and credited; this return takes it to Rs.5,000.
    // Crediting the cumulative 5,000 would pay the first 3,000 twice.
    const before = input({ returnedCentsIncludingThis: 300_000 });
    const after  = input({ returnedCentsIncludingThis: 500_000 });
    expect(creditIncrementCents(before, after)).toBe(200_000);
  });

  it('credits the full amount on a first return', () => {
    const before = input({ returnedCentsIncludingThis: 0 });
    const after  = input({ returnedCentsIncludingThis: 300_000 });
    expect(creditIncrementCents(before, after)).toBe(300_000);
  });

  it('adds nothing on an unpaid invoice, however many returns', () => {
    const before = input({ returnedCentsIncludingThis: 300_000, paidCentsAfterRefund: 0 });
    const after  = input({ returnedCentsIncludingThis: 500_000, paidCentsAfterRefund: 0 });
    expect(creditIncrementCents(before, after)).toBe(0);
  });

  it('never goes negative when a cash refund took money back out', () => {
    // Before: fully paid, 3,000 returned → 3,000 on account.
    // After:  another 2,000 returned but 4,000 handed back in cash.
    const before = input({ returnedCentsIncludingThis: 300_000, paidCentsAfterRefund: 1_000_000 });
    const after  = input({ returnedCentsIncludingThis: 500_000, paidCentsAfterRefund:   600_000 });
    expect(creditIncrementCents(before, after)).toBe(0);
  });
});
