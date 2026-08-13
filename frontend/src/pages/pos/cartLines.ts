import type { PosProduct } from '../../services/pos';

// ─── Cart line model ──────────────────────────────────────────────────────────
//
// Pure logic, deliberately kept out of POSPage: these rules decide what the
// customer is charged, and they are worth testing without mounting a 4,000-line
// component. POSPage imports them; the tests next to this file pin them down.

export interface CartItem {
  product:            PosProduct;
  qty:                number;
  unitPriceCents:     number;
  itemDiscountType:   'percent' | 'amount';
  itemDiscountValue:  number;  // % or display-currency amount
  itemDiscountCents:  number;  // computed cents
  isServiceCharge?:   boolean; // service charge line (display only — excluded from checkout items)
  linkedProductId?:   string;  // product ID this service charge belongs to
  costCents?:         number;  // product cost price — used for staff sale repricing
  originalPriceCents?:number;  // selling price before staff sale toggle
  unitId?:            string;  // selected sales unit (defaults to base unit); sent in checkout payload
  unitShortCode?:     string;  // short code of the selected unit (display only)
  batchId?:           string;  // manually-picked StockBatch (multi-batch products); sent in checkout payload
  batchQty?:          number;  // BASE units held by that batch when it was picked.
                               // The line is capped against THIS, not the product's
                               // total, so a line bound to a 1-unit batch cannot be
                               // raised to the product's full stock and then be
                               // rejected at payment. Backend re-checks under lock.
}

// A cart line is identified by product AND batch, not by product alone. One
// product can occupy several lines when the customer's quantity is filled from
// more than one batch — three tins where the cheap batch holds only one means a
// line of 1 from that batch and a line of 2 from the next, each at its own
// price. Adding the same product+batch again merges into the existing line, so
// the same batch can never appear twice and be double-counted at checkout.
export function lineKeyOf(i: CartItem): string {
  if (i.isServiceCharge) return `svc:${i.linkedProductId ?? i.product.id}`;
  return `${i.product.id}|${i.batchId ?? ''}`;
}

// Service charges stay keyed to the PRODUCT, never to the line. The Product page
// offers two modes and they behave differently once a product spans lines:
//   per_transaction — flat, once per sale. One charge no matter how many lines;
//                     charging per line would bill the flat fee twice.
//   per_unit        — Rs.X per unit sold, so the qty is the SUM across that
//                     product's lines: 1 + 2 split still totals 3.
export function syncServiceCharges(items: CartItem[]): CartItem[] {
  return items.map((i) => {
    if (!i.isServiceCharge || !i.linkedProductId) return i;
    const parents = items.filter(p => !p.isServiceCharge && p.product.id === i.linkedProductId);
    if (parents.length === 0) return i;   // orphan; removeFromCart drops it
    const qty = parents[0].product.serviceChargeMode === 'per_transaction'
      ? 1
      : parents.reduce((s, p) => s + p.qty, 0);
    return i.qty === qty ? i : { ...i, qty };
  });
}

// Service-charge cents to fold into a given sellable line at checkout.
//
// The backend computes a line total as unitPriceCents x qty, so the charge is
// divided by the line qty to survive that multiplication. A product split
// across batches has several lines but ONE charge, so it is attached to that
// product's FIRST line and zero elsewhere — folding it into every line would
// bill the charge once per line.
export function serviceChargePerUnitFor(
  line: CartItem,
  index: number,
  sellableLines: CartItem[],
  allItems: CartItem[],
): number {
  const svc = allItems.find(sc => sc.isServiceCharge && sc.linkedProductId === line.product.id);
  if (!svc) return 0;
  const isFirstLineOfProduct =
    sellableLines.findIndex(s => s.product.id === line.product.id) === index;
  if (!isFirstLineOfProduct || line.qty <= 0) return 0;
  return (svc.unitPriceCents * svc.qty) / line.qty;
}
