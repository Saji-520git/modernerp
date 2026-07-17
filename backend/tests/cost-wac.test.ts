/**
 * Weighted-Average Cost (WAC) tests — G1 costing foundation.
 * Pure function, no DB.
 */
import { computeWAC } from '../src/utils/cost';

describe('computeWAC', () => {
  it('first stock in → received cost becomes the average', () => {
    expect(computeWAC(0, 0, 100, 5000)).toBe(5000);
  });

  it('blends a dearer restock into the average (the headline scenario)', () => {
    // 100 @ 5000, then 10 @ 8000 → (100*5000 + 10*8000)/110 = 5272.7 → 5273
    expect(computeWAC(100, 5000, 10, 8000)).toBe(5273);
  });

  it('blends a cheaper restock down', () => {
    // 50 @ 6000, then 50 @ 4000 → 5000
    expect(computeWAC(50, 6000, 50, 4000)).toBe(5000);
  });

  it('same cost restock leaves average unchanged', () => {
    expect(computeWAC(100, 5000, 25, 5000)).toBe(5000);
  });

  it('zero received qty → average unchanged (not a real receipt)', () => {
    expect(computeWAC(100, 5000, 0, 9999)).toBe(5000);
  });

  it('nothing on hand at all → keeps existing average (no divide-by-zero)', () => {
    expect(computeWAC(0, 5000, 0, 8000)).toBe(5000);
  });

  it('rounds to whole cents', () => {
    // 3 @ 1000, 1 @ 1001 → 4001/4 = 1000.25 → 1000
    expect(computeWAC(3, 1000, 1, 1001)).toBe(1000);
  });

  it('handles decimal (fractional) quantities', () => {
    // 2.5kg @ 4000, 1.5kg @ 6000 → (10000 + 9000)/4 = 4750
    expect(computeWAC(2.5, 4000, 1.5, 6000)).toBe(4750);
  });
});
