/**
 * Credit limit — the rule that decides whether a sale may go on account.
 * Pure function, no DB.
 *
 * These exist because the limit was, in practice, not enforced at all. The check
 * ran before any product had been looked up, against a total summed from
 * `item.unitPriceCents` — the OPTIONAL price-override field, sent only when a
 * cashier with adjust_sale_price edits a line. On an ordinary sale it is
 * undefined, so `?? 0` made the sale total ZERO and the limit only ever compared
 * the customer's EXISTING balance against it. A customer at zero balance with a
 * Rs. 1.00 limit was sold Rs. 175.00 on credit, verified against a live till.
 *
 * The rule now runs where totalCents is final. What follows pins it.
 */
import { checkCreditLimit } from '../src/modules/pos/credit-limit';

const base = { limitCents: 100_000, alertPct: 80, existingCents: 0, creditPortionCents: 0 };

describe('checkCreditLimit — the sale itself must count', () => {
  it('rejects a sale that alone exceeds the limit, from a zero balance', () => {
    // The exact case that wrongly succeeded: Rs. 1.00 limit, Rs. 175.00 sale.
    const v = checkCreditLimit({ ...base, limitCents: 100, creditPortionCents: 17_500 });
    expect(v.allowed).toBe(false);
    expect(v.overByCents).toBe(17_400);
  });

  it('counts existing balance AND the new sale together', () => {
    const v = checkCreditLimit({ ...base, limitCents: 30_000, existingCents: 22_500, creditPortionCents: 17_500 });
    expect(v.allowed).toBe(false);
    expect(v.newBalanceCents).toBe(40_000);
    expect(v.overByCents).toBe(10_000);
  });

  it('allows a sale that fits inside the limit', () => {
    const v = checkCreditLimit({ ...base, limitCents: 500_000, existingCents: 22_500, creditPortionCents: 17_500 });
    expect(v.allowed).toBe(true);
    expect(v.newBalanceCents).toBe(40_000);
    expect(v.overByCents).toBe(0);
  });
});

describe('checkCreditLimit — boundaries', () => {
  it('allows landing exactly ON the limit', () => {
    const v = checkCreditLimit({ ...base, limitCents: 40_000, existingCents: 22_500, creditPortionCents: 17_500 });
    expect(v.allowed).toBe(true);
    expect(v.overByCents).toBe(0);
  });

  it('rejects one cent over', () => {
    const v = checkCreditLimit({ ...base, limitCents: 39_999, existingCents: 22_500, creditPortionCents: 17_500 });
    expect(v.allowed).toBe(false);
    expect(v.overByCents).toBe(1);
  });

  it('allows a zero-value sale against an exhausted limit', () => {
    const v = checkCreditLimit({ ...base, limitCents: 10_000, existingCents: 10_000, creditPortionCents: 0 });
    expect(v.allowed).toBe(true);
  });
});

describe('checkCreditLimit — split payments', () => {
  it('counts only the credit portion, not the cash settled at the till', () => {
    // Rs. 500 sale, Rs. 450 paid in cash → only Rs. 50 goes on account.
    const v = checkCreditLimit({ ...base, limitCents: 10_000, existingCents: 5_000, creditPortionCents: 5_000 });
    expect(v.allowed).toBe(true);
    expect(v.newBalanceCents).toBe(10_000);
  });

  it('never lets an over-settled split pay DOWN the existing balance', () => {
    // Cash exceeding the total would make the portion negative; clamping at zero
    // keeps the balance honest — settling a debt is the payments module's job.
    const v = checkCreditLimit({ ...base, existingCents: 5_000, creditPortionCents: -3_000 });
    expect(v.newBalanceCents).toBe(5_000);
    expect(v.allowed).toBe(true);
  });
});

describe('checkCreditLimit — no limit configured', () => {
  it('treats 0 as unlimited, not as a zero ceiling', () => {
    // creditLimitCents defaults to 0. Reading that as "nothing on account" would
    // block every credit sale for customers set up without an explicit limit.
    const v = checkCreditLimit({ ...base, limitCents: 0, creditPortionCents: 999_999 });
    expect(v.allowed).toBe(true);
    expect(v.nearLimit).toBe(false);
  });

  it('treats a negative limit the same way rather than inverting the test', () => {
    const v = checkCreditLimit({ ...base, limitCents: -1, creditPortionCents: 500 });
    expect(v.allowed).toBe(true);
  });
});

describe('checkCreditLimit — alert threshold', () => {
  it('flags nearLimit once past alertPct but still allows the sale', () => {
    const v = checkCreditLimit({ ...base, limitCents: 10_000, alertPct: 80, creditPortionCents: 8_500 });
    expect(v.allowed).toBe(true);
    expect(v.nearLimit).toBe(true);
  });

  it('stays quiet below the threshold', () => {
    const v = checkCreditLimit({ ...base, limitCents: 10_000, alertPct: 80, creditPortionCents: 7_900 });
    expect(v.allowed).toBe(true);
    expect(v.nearLimit).toBe(false);
  });

  it('does not flag exactly AT the threshold', () => {
    const v = checkCreditLimit({ ...base, limitCents: 10_000, alertPct: 80, creditPortionCents: 8_000 });
    expect(v.nearLimit).toBe(false);
  });

  it('reports nearLimit on a rejection too, so callers need no special case', () => {
    const v = checkCreditLimit({ ...base, limitCents: 10_000, creditPortionCents: 20_000 });
    expect(v.allowed).toBe(false);
    expect(v.nearLimit).toBe(true);
  });
});
