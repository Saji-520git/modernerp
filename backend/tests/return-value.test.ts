import {
  refundUnitCents, cappedReturnTotalCents, cappedRefundCents,
  type RefundUnitInput,
} from '../src/modules/sales/return-value';

const unit = (o: Partial<RefundUnitInput> = {}): RefundUnitInput => ({
  saleTotalCents:  100_000,   // Rs.1,000 charged
  grossLinesCents: 100_000,   // no cart-level reduction
  lineTotalCents:   40_000,   // this line grossed Rs.400
  qtySold:               4,   // 4 units → Rs.100 each
  ...o,
});

describe('refund unit value', () => {
  it('is the plain unit price when nothing was discounted', () => {
    expect(refundUnitCents(unit())).toBe(10_000);   // Rs.100
  });

  it('carries a cart-level discount proportionally', () => {
    // Rs.100 off the whole Rs.1,000 cart → each unit is worth 10% less.
    expect(refundUnitCents(unit({ saleTotalCents: 90_000 }))).toBe(9_000);
  });

  it('carries a promotion or loyalty redemption the same way', () => {
    // The rule never asks WHY the total is lower — only that it is. That is
    // what makes it survive changes to the promotion and loyalty engines.
    expect(refundUnitCents(unit({ saleTotalCents: 50_000 }))).toBe(5_000);
  });

  it('respects the line\'s own discount through lineTotalCents', () => {
    // Line grossed 40,000 but only 30,000 after its own discount, of a cart
    // whose lines now sum to 90,000 and which was charged 90,000.
    expect(refundUnitCents(unit({
      lineTotalCents: 30_000, grossLinesCents: 90_000, saleTotalCents: 90_000,
    }))).toBe(7_500);
  });

  it('includes tax, because tax is inside the charged total', () => {
    // Rs.1,000 of goods charged at Rs.1,100 with tax → each unit worth Rs.110.
    expect(refundUnitCents(unit({ saleTotalCents: 110_000 }))).toBe(11_000);
  });

  it('returns the full invoice when every line comes back', () => {
    // The property that matters: proration must reconstruct the invoice.
    const a = refundUnitCents({ saleTotalCents: 90_000, grossLinesCents: 100_000, lineTotalCents: 40_000, qtySold: 4 });
    const b = refundUnitCents({ saleTotalCents: 90_000, grossLinesCents: 100_000, lineTotalCents: 60_000, qtySold: 6 });
    expect(a * 4 + b * 6).toBe(90_000);
  });

  it('is zero for the degenerate cases instead of dividing by zero', () => {
    expect(refundUnitCents(unit({ grossLinesCents: 0 }))).toBe(0);
    expect(refundUnitCents(unit({ qtySold: 0 }))).toBe(0);
    expect(refundUnitCents(unit({ saleTotalCents: 0 }))).toBe(0);
    expect(refundUnitCents(unit({ lineTotalCents: 0 }))).toBe(0);
  });
});

describe('return total cap', () => {
  it('passes a return that fits inside the invoice', () => {
    expect(cappedReturnTotalCents(30_000, 100_000, 0)).toBe(30_000);
  });

  it('caps at what the invoice has left after earlier returns', () => {
    expect(cappedReturnTotalCents(50_000, 100_000, 70_000)).toBe(30_000);
  });

  it('gives nothing once the invoice is fully returned', () => {
    expect(cappedReturnTotalCents(10_000, 100_000, 100_000)).toBe(0);
  });

  it('never goes negative when earlier returns already exceed the invoice', () => {
    expect(cappedReturnTotalCents(10_000, 100_000, 150_000)).toBe(0);
  });
});

describe('refund cap', () => {
  it('allows a refund within both ceilings', () => {
    expect(cappedRefundCents(20_000, 30_000, 100_000)).toBe(20_000);
  });

  it('caps at the value of the return', () => {
    // The bug this closes: a Rs.100 return could refund Rs.10,000 in cash.
    expect(cappedRefundCents(1_000_000, 10_000, 1_000_000)).toBe(10_000);
  });

  it('caps at what the customer actually paid', () => {
    // Unpaid credit sale: nothing was taken, so nothing can be handed back.
    // The return cancels debt instead.
    expect(cappedRefundCents(30_000, 30_000, 0)).toBe(0);
  });

  it('caps at the smaller of the two ceilings', () => {
    expect(cappedRefundCents(30_000, 30_000, 12_000)).toBe(12_000);
  });

  it('never returns a negative refund', () => {
    expect(cappedRefundCents(-500, 30_000, 100_000)).toBe(0);
  });
});
