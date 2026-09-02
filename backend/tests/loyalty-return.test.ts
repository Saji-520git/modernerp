import { loyaltyReturnDelta, type LoyaltyReturnInput } from '../src/modules/loyalty/loyalty-return';

const inp = (o: Partial<LoyaltyReturnInput> = {}): LoyaltyReturnInput => ({
  pointsEarnedOnSale:   500,
  pointsRedeemedOnSale:   0,
  saleTotalCents:   100_000,   // Rs.1,000
  returnedCentsBefore:    0,
  returnedCentsAfter:     0,
  ...o,
});

describe('loyalty on return — earned points', () => {
  it('claws back everything on a full return', () => {
    // The loop this closes: buy, earn, return, keep the points, repeat.
    const d = loyaltyReturnDelta(inp({ returnedCentsAfter: 100_000 }));
    expect(d.earnedReversal).toBe(500);
  });

  it('claws back proportionally on a partial return', () => {
    expect(loyaltyReturnDelta(inp({ returnedCentsAfter: 40_000 })).earnedReversal).toBe(200);
    expect(loyaltyReturnDelta(inp({ returnedCentsAfter: 50_000 })).earnedReversal).toBe(250);
  });

  it('takes nothing when nothing has been returned', () => {
    expect(loyaltyReturnDelta(inp()).earnedReversal).toBe(0);
  });

  it('takes nothing when the sale earned nothing', () => {
    expect(loyaltyReturnDelta(inp({ pointsEarnedOnSale: 0, returnedCentsAfter: 100_000 })).earnedReversal).toBe(0);
  });
});

describe('loyalty on return — redeemed points', () => {
  it('gives redeemed points back on a full return', () => {
    // The redemption was a discount on this invoice, and the refund is of the
    // already-discounted total. Not returning the points would charge the
    // customer for the same discount twice.
    const d = loyaltyReturnDelta(inp({ pointsEarnedOnSale: 0, pointsRedeemedOnSale: 100, returnedCentsAfter: 100_000 }));
    expect(d.redeemRestore).toBe(100);
  });

  it('gives back proportionally on a partial return', () => {
    const d = loyaltyReturnDelta(inp({ pointsEarnedOnSale: 0, pointsRedeemedOnSale: 100, returnedCentsAfter: 25_000 }));
    expect(d.redeemRestore).toBe(25);
  });

  it('handles a sale that both earned and redeemed', () => {
    const d = loyaltyReturnDelta(inp({ pointsEarnedOnSale: 500, pointsRedeemedOnSale: 100, returnedCentsAfter: 100_000 }));
    expect(d).toEqual({ earnedReversal: 500, redeemRestore: 100 });
  });
});

describe('loyalty on return — successive returns must not double-reverse', () => {
  it('second return moves only its own share', () => {
    // 40% returned, then a further 30%. Recomputing the cumulative figure and
    // applying it directly would take 200 then 700 — reversing more than the
    // sale ever awarded.
    const first  = loyaltyReturnDelta(inp({ returnedCentsBefore: 0,      returnedCentsAfter: 40_000 }));
    const second = loyaltyReturnDelta(inp({ returnedCentsBefore: 40_000, returnedCentsAfter: 70_000 }));
    expect(first.earnedReversal).toBe(200);
    expect(second.earnedReversal).toBe(150);
    expect(first.earnedReversal + second.earnedReversal).toBe(350);   // == 70% of 500
  });

  it('a sequence of partial returns never reverses more than was awarded', () => {
    const steps = [10_000, 30_000, 55_000, 80_000, 100_000];
    let before = 0, total = 0;
    for (const after of steps) {
      total += loyaltyReturnDelta(inp({ returnedCentsBefore: before, returnedCentsAfter: after })).earnedReversal;
      before = after;
    }
    expect(total).toBe(500);
  });

  it('adds nothing once the invoice is already fully returned', () => {
    const d = loyaltyReturnDelta(inp({ returnedCentsBefore: 100_000, returnedCentsAfter: 100_000 }));
    expect(d).toEqual({ earnedReversal: 0, redeemRestore: 0 });
  });
});

describe('loyalty on return — degenerate inputs', () => {
  it('is zero when the invoice has no value to prorate against', () => {
    const d = loyaltyReturnDelta(inp({ saleTotalCents: 0, returnedCentsAfter: 100 }));
    expect(d).toEqual({ earnedReversal: 0, redeemRestore: 0 });
  });

  it('caps at the full amount when returns exceed the invoice', () => {
    const d = loyaltyReturnDelta(inp({ pointsRedeemedOnSale: 100, returnedCentsAfter: 500_000 }));
    expect(d.earnedReversal).toBe(500);
    expect(d.redeemRestore).toBe(100);
  });

  it('never returns a negative movement', () => {
    // A "before" larger than "after" would otherwise produce a negative, which
    // the caller would apply as points appearing from nowhere.
    const d = loyaltyReturnDelta(inp({ returnedCentsBefore: 80_000, returnedCentsAfter: 20_000 }));
    expect(d.earnedReversal).toBe(0);
    expect(d.redeemRestore).toBe(0);
  });

  it('ignores negative point figures on the sale', () => {
    const d = loyaltyReturnDelta(inp({ pointsEarnedOnSale: -100, returnedCentsAfter: 100_000 }));
    expect(d.earnedReversal).toBe(0);
  });
});
