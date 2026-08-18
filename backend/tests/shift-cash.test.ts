/**
 * Shift cash reconciliation — what the drawer should hold at close.
 * Pure function, no DB.
 *
 * The old rule was `openingFloat + cashSalesCents`, counting only sales whose
 * paymentMethod was CASH. Three other things move real money through a till and
 * all were invisible, so the system invented variances the cashier was then
 * asked to explain. These tests pin each one.
 */
import { expectedCashCents, cashVarianceCents } from '../src/modules/pos/shift-cash';

const nil = {
  openingFloatCents: 0, cashSalesCents: 0, splitCashCents: 0,
  cashSettlementsCents: 0, cashRefundsCents: 0,
};

describe('expectedCashCents — the movements that used to be missed', () => {
  it('counts the cash taken on a split cash+credit sale', () => {
    // Rs. 500 sale, Rs. 450 in cash, Rs. 50 on account. The row's method is
    // CREDIT, so the old rule expected none of that Rs. 450 back and the till
    // read as a Rs. 450 SURPLUS.
    expect(expectedCashCents({ ...nil, openingFloatCents: 10_000, splitCashCents: 45_000 })).toBe(55_000);
  });

  it('counts a credit bill settled in cash at the till', () => {
    expect(expectedCashCents({ ...nil, openingFloatCents: 10_000, cashSettlementsCents: 22_500 })).toBe(32_500);
  });

  it('subtracts a cash refund paid out of the drawer', () => {
    // The old rule never subtracted this, so the till read as SHORT by the
    // refund amount.
    expect(expectedCashCents({ ...nil, openingFloatCents: 10_000, cashSalesCents: 50_000, cashRefundsCents: 17_500 }))
      .toBe(42_500);
  });

  it('combines all four movements with the opening float', () => {
    expect(expectedCashCents({
      openingFloatCents:    10_000,
      cashSalesCents:       80_000,
      splitCashCents:       45_000,
      cashSettlementsCents: 22_500,
      cashRefundsCents:     17_500,
    })).toBe(140_000);
  });
});

describe('expectedCashCents — the old behaviour still holds where it was right', () => {
  it('is float + cash sales when nothing else moved', () => {
    expect(expectedCashCents({ ...nil, openingFloatCents: 10_000, cashSalesCents: 50_000 })).toBe(60_000);
  });

  it('is just the float on a shift with no activity', () => {
    expect(expectedCashCents({ ...nil, openingFloatCents: 10_000 })).toBe(10_000);
  });

  it('is zero for an empty shift opened with no float', () => {
    expect(expectedCashCents(nil)).toBe(0);
  });
});

describe('expectedCashCents — guards', () => {
  it('never expects a negative amount, however large the refunds', () => {
    // A till cannot owe money. Clamping keeps the variance pointing at the real
    // discrepancy instead of a nonsensical negative expectation.
    expect(expectedCashCents({ ...nil, cashSalesCents: 5_000, cashRefundsCents: 90_000 })).toBe(0);
  });

  it('ignores card and bank sales entirely — they never touch the drawer', () => {
    // Those are recorded on the shift for reporting, but must not be expected
    // as cash. Absence from the input type is the guarantee; this pins it.
    expect(expectedCashCents({ ...nil, openingFloatCents: 10_000, cashSalesCents: 0 })).toBe(10_000);
  });
});

describe('cashVarianceCents — sign convention', () => {
  it('is positive when the drawer holds more than expected', () => {
    expect(cashVarianceCents(60_500, 60_000)).toBe(500);
  });

  it('is negative when the drawer is short', () => {
    expect(cashVarianceCents(59_500, 60_000)).toBe(-500);
  });

  it('is zero on an exact count', () => {
    expect(cashVarianceCents(60_000, 60_000)).toBe(0);
  });

  it('reports the full expected amount as short when the drawer is empty', () => {
    expect(cashVarianceCents(0, 60_000)).toBe(-60_000);
  });
});

describe('regression — the scenarios that produced phantom variances', () => {
  it('a shift whose only activity was a split sale now reconciles to zero', () => {
    const expected = expectedCashCents({ ...nil, openingFloatCents: 10_000, splitCashCents: 45_000 });
    expect(cashVarianceCents(55_000, expected)).toBe(0);   // old rule: +45,000 phantom surplus
  });

  it('a shift whose only activity was a cash refund now reconciles to zero', () => {
    const expected = expectedCashCents({ ...nil, openingFloatCents: 50_000, cashRefundsCents: 17_500 });
    expect(cashVarianceCents(32_500, expected)).toBe(0);   // old rule: -17,500 phantom shortage
  });
});
