import { describe, it, expect } from 'vitest';
import {
  lineKeyOf, syncServiceCharges, serviceChargePerUnitFor, MAX_LINE_QTY, type CartItem,
} from './cartLines';
import { looksLikeScannedCode } from '../../utils/scanner';

// These pin down rules that decide what a customer is charged. Each case below
// is a bug that actually reached the working tree during the batch-split work.

const product = (id: string, over: Record<string, unknown> = {}) => ({
  id, sku: id, name: id, priceCents: 10000, costCents: 5000,
  taxPercent: 0, serviceChargeCents: 0, serviceChargeMode: 'per_unit',
  ...over,
} as unknown as CartItem['product']);

const line = (over: Partial<CartItem> & { product: CartItem['product'] }): CartItem => ({
  qty: 1, unitPriceCents: 10000,
  itemDiscountType: 'amount', itemDiscountValue: 0, itemDiscountCents: 0,
  ...over,
});

describe('lineKeyOf', () => {
  it('separates the same product held in different batches', () => {
    const a = line({ product: product('P'), batchId: 'b1' });
    const b = line({ product: product('P'), batchId: 'b2' });
    expect(lineKeyOf(a)).not.toBe(lineKeyOf(b));
  });

  it('matches the same product+batch so re-adding tops up instead of duplicating', () => {
    const a = line({ product: product('P'), batchId: 'b1' });
    const b = line({ product: product('P'), batchId: 'b1', qty: 5 });
    expect(lineKeyOf(a)).toBe(lineKeyOf(b));
  });

  it('keeps a batch-less line distinct from a batch line of the same product', () => {
    // The extra unpriced line bug: falling through to a batch-less add must not
    // silently merge into, or be mistaken for, a real batch line.
    const withBatch = line({ product: product('P'), batchId: 'b1' });
    const without   = line({ product: product('P') });
    expect(lineKeyOf(withBatch)).not.toBe(lineKeyOf(without));
  });

  it('keys a service charge to its product, not to the line', () => {
    const svc = line({ product: product('svc_P'), isServiceCharge: true, linkedProductId: 'P' });
    expect(lineKeyOf(svc)).toBe('svc:P');
  });
});

describe('syncServiceCharges', () => {
  it('per_unit sums the quantity across every line of the product', () => {
    const p = product('P', { serviceChargeMode: 'per_unit', serviceChargeCents: 1000 });
    const out = syncServiceCharges([
      line({ product: p, batchId: 'b1', qty: 1 }),
      line({ product: p, batchId: 'b2', qty: 2 }),
      line({ product: product('svc_P'), isServiceCharge: true, linkedProductId: 'P', qty: 1 }),
    ]);
    expect(out.find(i => i.isServiceCharge)!.qty).toBe(3);
  });

  it('per_transaction stays at 1 however many lines the product spans', () => {
    // Charging per line here would bill the flat fee twice for one sale.
    const p = product('P', { serviceChargeMode: 'per_transaction', serviceChargeCents: 1000 });
    const out = syncServiceCharges([
      line({ product: p, batchId: 'b1', qty: 1 }),
      line({ product: p, batchId: 'b2', qty: 2 }),
      line({ product: product('svc_P'), isServiceCharge: true, linkedProductId: 'P', qty: 1 }),
    ]);
    expect(out.find(i => i.isServiceCharge)!.qty).toBe(1);
  });

  it('leaves a charge alone when its product has no remaining lines', () => {
    const orphan = line({ product: product('svc_P'), isServiceCharge: true, linkedProductId: 'P', qty: 4 });
    expect(syncServiceCharges([orphan])[0].qty).toBe(4);
  });

  it('does not touch ordinary lines', () => {
    const a = line({ product: product('P'), qty: 2 });
    expect(syncServiceCharges([a])[0]).toBe(a);
  });
});

describe('serviceChargePerUnitFor', () => {
  const p   = product('P', { serviceChargeMode: 'per_unit', serviceChargeCents: 1000 });
  const svc = line({ product: product('svc_P'), isServiceCharge: true, linkedProductId: 'P', qty: 3, unitPriceCents: 1000 });
  const l1  = line({ product: p, batchId: 'b1', qty: 1 });
  const l2  = line({ product: p, batchId: 'b2', qty: 2 });
  const sellable = [l1, l2];
  const all = [l1, l2, svc];

  it('charges a split product ONCE, on its first line', () => {
    // Rs.10 x 3 units = Rs.30, folded whole into a line of qty 1.
    expect(serviceChargePerUnitFor(l1, 0, sellable, all)).toBe(3000);
  });

  it('adds nothing to the product’s later lines', () => {
    // Folding into every line billed the charge once per line.
    expect(serviceChargePerUnitFor(l2, 1, sellable, all)).toBe(0);
  });

  it('re-multiplies back to the true total through the backend’s price x qty', () => {
    const perUnit = serviceChargePerUnitFor(l1, 0, sellable, all);
    expect(perUnit * l1.qty + serviceChargePerUnitFor(l2, 1, sellable, all) * l2.qty).toBe(3000);
  });

  it('is zero for a product carrying no service charge', () => {
    const plain = line({ product: product('Q') });
    expect(serviceChargePerUnitFor(plain, 0, [plain], [plain])).toBe(0);
  });
});

// ── A scan that lands in the qty box ────────────────────────────────────────
//
// Adding an item focuses that line's qty box, so the second scan of the same
// product typed its barcode into qty and Enter committed it: the line jumped to
// the whole shelf. Once selling past zero removed the stock cap, the same slip
// would have rung up 4,796,011,470,029 units instead.
describe('looksLikeScannedCode', () => {
  it('recognises the EAN-13 that caused this', () => {
    expect(looksLikeScannedCode('4796011470029')).toBe(true);
  });

  it('recognises EAN-8, the shortest barcode in use here', () => {
    expect(looksLikeScannedCode('96385074')).toBe(true);
  });

  it('survives the whitespace a scanner suffix leaves behind', () => {
    expect(looksLikeScannedCode(' 4796011470029 \r')).toBe(true);
  });

  it.each(['1', '2', '5', '12', '50', '144', '1000', '9999999'])(
    'leaves a real quantity alone: %s', (qty) => {
      expect(looksLikeScannedCode(qty)).toBe(false);
    });

  it('leaves a decimal quantity alone — weighed goods still commit', () => {
    expect(looksLikeScannedCode('2.5')).toBe(false);
    expect(looksLikeScannedCode('0.125')).toBe(false);
  });

  it('does not fire on an empty or half-typed box', () => {
    expect(looksLikeScannedCode('')).toBe(false);
    expect(looksLikeScannedCode('   ')).toBe(false);
  });

  it('ignores anything that is not purely digits', () => {
    // A qty box only accepts digits, but the guard must not be the thing that
    // assumes that — a paste or an IME can put anything here.
    expect(looksLikeScannedCode('47960114700a9')).toBe(false);
    expect(looksLikeScannedCode('-4796011470029')).toBe(false);
  });
});

describe('MAX_LINE_QTY', () => {
  it('sits above any real line but below any barcode', () => {
    // The two must not overlap, or one guard would shadow the other.
    expect(MAX_LINE_QTY).toBeGreaterThan(10_000);      // room for wholesale
    expect(MAX_LINE_QTY).toBeLessThan(10_000_000);     // smallest 8-digit code
  });

  it('bounds the one number that slips past the scan check', () => {
    // 7 digits: too short to be read as a barcode, too large to be a quantity.
    const stray = 9_999_999;
    expect(looksLikeScannedCode(String(stray))).toBe(false);
    expect(Math.min(stray, MAX_LINE_QTY)).toBe(MAX_LINE_QTY);
  });
});

// The same guard now protects the discount boxes, where a committed barcode was
// worse than a wrong quantity: commit() clamps to 0-100 in percent mode and to
// the whole subtotal in amount mode, so it read as a FULL discount — and on the
// cart-total input, Enter then opened the payment dialog on top of it.
describe('looksLikeScannedCode — discount boxes', () => {
  it.each(['0', '5', '10', '15', '50', '100'])(
    'leaves a percent discount alone: %s', (pct) => {
      expect(looksLikeScannedCode(pct)).toBe(false);
    });

  it.each(['250', '1500.50', '99.99', '0.5'])(
    'leaves an amount discount alone: %s', (amt) => {
      expect(looksLikeScannedCode(amt)).toBe(false);
    });

  it('catches a barcode before it can become a full discount', () => {
    expect(looksLikeScannedCode('4796011470029')).toBe(true);
  });

  it('accepts that an 8-digit discount is unreachable — the trade is deliberate', () => {
    // Rs. 12,345,678 off one line is not a discount anyone types, and giving it
    // up is what buys a check with no timing heuristics in it.
    expect(looksLikeScannedCode('12345678')).toBe(true);
  });
});
