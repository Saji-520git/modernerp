import { computePromotions, type PromoCartLine, type PromoInput } from '../src/modules/promotions/promotions.engine';

const basePromo = (over: Partial<PromoInput>): PromoInput => ({
  id: 'p', name: 'Promo', type: 'PERCENT_OFF', scope: 'ALL',
  scopeCategoryId: null, scopeBrandId: null, scopeProductId: null,
  value: 0, minQty: null, minCartCents: null, startsAt: null, endsAt: null,
  priority: 0, stackable: false, maxDiscountCents: null, active: true,
  usageLimit: null, timesUsed: 0, ...over,
});

const line = (over: Partial<PromoCartLine>): PromoCartLine => ({
  lineKey: 'l1', productId: 'prodA', categoryId: 'catA', brandId: 'brandA',
  qty: 1, lineAfterManualCents: 10000, ...over,
});

const cartTotal = (ls: PromoCartLine[]) => ls.reduce((s, l) => s + l.lineAfterManualCents, 0);

describe('computePromotions', () => {
  it('percent off, scope ALL, applies per line', () => {
    const ls = [line({ lineKey: 'l1', lineAfterManualCents: 10000 }), line({ lineKey: 'l2', lineAfterManualCents: 5000 })];
    const r = computePromotions(ls, cartTotal(ls), [basePromo({ type: 'PERCENT_OFF', value: 10 })]);
    expect(r.lineDiscounts.l1).toBe(1000);
    expect(r.lineDiscounts.l2).toBe(500);
    expect(r.totalDiscountCents).toBe(1500);
    expect(r.applied[0].discountCents).toBe(1500);
  });

  it('percent off scoped to a category only affects matching lines', () => {
    const ls = [
      line({ lineKey: 'l1', categoryId: 'catA', lineAfterManualCents: 10000 }),
      line({ lineKey: 'l2', categoryId: 'catB', lineAfterManualCents: 10000 }),
    ];
    const r = computePromotions(ls, cartTotal(ls), [basePromo({ scope: 'CATEGORY', scopeCategoryId: 'catA', value: 20 })]);
    expect(r.lineDiscounts.l1).toBe(2000);
    expect(r.lineDiscounts.l2).toBe(0);
  });

  it('amount off distributes across the matching subset proportionally', () => {
    const ls = [line({ lineKey: 'l1', lineAfterManualCents: 6000 }), line({ lineKey: 'l2', lineAfterManualCents: 2000 })];
    const r = computePromotions(ls, cartTotal(ls), [basePromo({ type: 'AMOUNT_OFF', value: 1000 })]);
    // 1000 split 6000:2000 → 750 + 250
    expect(r.lineDiscounts.l1).toBe(750);
    expect(r.lineDiscounts.l2).toBe(250);
    expect(r.totalDiscountCents).toBe(1000);
  });

  it('amount off never exceeds the subset total', () => {
    const ls = [line({ lineKey: 'l1', lineAfterManualCents: 500 })];
    const r = computePromotions(ls, cartTotal(ls), [basePromo({ type: 'AMOUNT_OFF', value: 100000 })]);
    expect(r.lineDiscounts.l1).toBe(500);
  });

  it('minCartCents gate blocks the promo below threshold', () => {
    const ls = [line({ lineAfterManualCents: 3000 })];
    const promo = basePromo({ type: 'AMOUNT_OFF', value: 500, minCartCents: 5000 });
    expect(computePromotions(ls, 3000, [promo]).totalDiscountCents).toBe(0);
    const ls2 = [line({ lineAfterManualCents: 6000 })];
    expect(computePromotions(ls2, 6000, [promo]).totalDiscountCents).toBe(500);
  });

  it('minQty gate blocks percent promo on a line below the qty', () => {
    const ls = [line({ lineKey: 'l1', qty: 1 }), line({ lineKey: 'l2', qty: 3, lineAfterManualCents: 10000 })];
    const r = computePromotions(ls, cartTotal(ls), [basePromo({ value: 10, minQty: 3 })]);
    expect(r.lineDiscounts.l1).toBe(0);
    expect(r.lineDiscounts.l2).toBe(1000);
  });

  it('non-stackable promos compete: best value wins per line', () => {
    const ls = [line({ lineAfterManualCents: 10000 })];
    const p10 = basePromo({ id: 'p10', name: '10%', value: 10, stackable: false });
    const p25 = basePromo({ id: 'p25', name: '25%', value: 25, stackable: false });
    const r = computePromotions(ls, cartTotal(ls), [p10, p25]);
    expect(r.lineDiscounts.l1).toBe(2500);
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0].promotionId).toBe('p25');
  });

  it('stackable promo adds on top of the best non-stackable', () => {
    const ls = [line({ lineAfterManualCents: 10000 })];
    const p20 = basePromo({ id: 'p20', name: '20%', value: 20, stackable: false });
    const p5  = basePromo({ id: 'p5', name: 'extra 5%', value: 5, stackable: true });
    const r = computePromotions(ls, cartTotal(ls), [p20, p5]);
    expect(r.lineDiscounts.l1).toBe(2500); // 2000 + 500
    expect(r.applied).toHaveLength(2);
  });

  it('priority breaks ties between equal non-stackable promos', () => {
    const ls = [line({ lineAfterManualCents: 10000 })];
    const a = basePromo({ id: 'a', value: 10, priority: 1 });
    const b = basePromo({ id: 'b', value: 10, priority: 5 });
    const r = computePromotions(ls, cartTotal(ls), [a, b]);
    expect(r.applied[0].promotionId).toBe('b');
  });

  it('maxDiscountCents caps a promo total', () => {
    const ls = [line({ lineAfterManualCents: 100000 })];
    const r = computePromotions(ls, cartTotal(ls), [basePromo({ value: 50, maxDiscountCents: 3000 })]);
    expect(r.lineDiscounts.l1).toBe(3000);
  });

  it('total line discount is capped at the line value when stacking overflows', () => {
    const ls = [line({ lineAfterManualCents: 1000 })];
    const p1 = basePromo({ id: 'p1', value: 80, stackable: true });
    const p2 = basePromo({ id: 'p2', value: 80, stackable: true });
    const r = computePromotions(ls, cartTotal(ls), [p1, p2]);
    expect(r.lineDiscounts.l1).toBe(1000); // 800 + 800 capped at 1000
    expect(r.totalDiscountCents).toBe(1000);
  });

  it('inactive / out-of-window promos are ignored', () => {
    const ls = [line({ lineAfterManualCents: 10000 })];
    const now = new Date('2026-07-21T12:00:00Z');
    const inactive = basePromo({ id: 'i', value: 10, active: false });
    const future   = basePromo({ id: 'f', value: 10, startsAt: new Date('2026-08-01T00:00:00Z') });
    const expired  = basePromo({ id: 'e', value: 10, endsAt: new Date('2026-07-01T00:00:00Z') });
    const r = computePromotions(ls, cartTotal(ls), [inactive, future, expired], now);
    expect(r.totalDiscountCents).toBe(0);
  });

  it('usageLimit reached disables the promo', () => {
    const ls = [line({ lineAfterManualCents: 10000 })];
    const r = computePromotions(ls, cartTotal(ls), [basePromo({ value: 10, usageLimit: 5, timesUsed: 5 })]);
    expect(r.totalDiscountCents).toBe(0);
  });

  it('no promos → no discounts (byte-identical to today)', () => {
    const ls = [line({ lineAfterManualCents: 10000 })];
    const r = computePromotions(ls, cartTotal(ls), []);
    expect(r.lineDiscounts.l1).toBe(0);
    expect(r.applied).toHaveLength(0);
    expect(r.totalDiscountCents).toBe(0);
  });
});
