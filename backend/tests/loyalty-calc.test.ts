import { pointsForAmount, redeemValueCents, planRedemption, type LoyaltyRates } from '../src/modules/loyalty/loyalty.calc';

const rates = (o: Partial<LoyaltyRates> = {}): LoyaltyRates => ({
  isEnabled: true, pointsPerAmount: 100, pointValueCents: 100, minRedeemPoints: 100, ...o,
});

describe('loyalty calc', () => {
  it('earns floor(spend / pointsPerAmount)', () => {
    expect(pointsForAmount(50000, rates())).toBe(500);   // Rs.500 → 500 pts @ 1pt/Rs.1
    expect(pointsForAmount(12345, rates())).toBe(123);
    expect(pointsForAmount(50000, rates({ pointsPerAmount: 10000 }))).toBe(5); // 1pt / Rs.100
  });

  it('earns nothing when disabled / zero spend', () => {
    expect(pointsForAmount(50000, rates({ isEnabled: false }))).toBe(0);
    expect(pointsForAmount(0, rates())).toBe(0);
  });

  it('redeem value = points × pointValueCents', () => {
    expect(redeemValueCents(200, 100)).toBe(20000);
    expect(redeemValueCents(-5, 100)).toBe(0);
  });

  it('plans a valid redemption', () => {
    const r = planRedemption(200, 500, 100000, rates());
    expect(r).toEqual({ points: 200, discountCents: 20000 });
  });

  it('rejects redemption above balance', () => {
    expect(planRedemption(600, 500, 100000, rates()).error).toBe('Not enough points');
  });

  it('rejects redemption below the minimum', () => {
    expect(planRedemption(50, 500, 100000, rates({ minRedeemPoints: 100 })).error).toMatch(/Minimum/);
  });

  it('trims points so discount never exceeds the order total', () => {
    // 500 pts worth Rs.500, but order is only Rs.150 → trim to 150 pts / Rs.150
    const r = planRedemption(500, 500, 15000, rates());
    expect(r.discountCents).toBe(15000);
    expect(r.points).toBe(150);
  });

  it('zero request → no-op, no error', () => {
    expect(planRedemption(0, 500, 100000, rates())).toEqual({ points: 0, discountCents: 0 });
  });
});
