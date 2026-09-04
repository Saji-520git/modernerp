// ─── Shared shaping helpers for the demo handlers ────────────────────────────
//
// The store keeps compact records; the frontend expects the fuller shapes the
// real API returns (nested category/brand/unit objects, stock arrays, Decimal
// fields as strings). Everything that turns one into the other lives here so
// the handlers stay readable.

import { getDb, type DemoDb, type DemoSale, type DemoPurchase } from './db';
import type { CatProduct } from './catalogue';
import { toLocalYMD } from '../utils/local-date';

export const db = () => getDb();

// ─── Lookups ─────────────────────────────────────────────────────────────────

export function unitById(id: string | null | undefined) {
  const u = db().units.find((x) => x.id === id);
  return u ? { id: u.id, name: u.name, shortCode: u.shortCode, allowDecimal: u.allowDecimal } : null;
}

export function categoryById(id: string | null) {
  const c = db().categories.find((x) => x.id === id);
  return c ? { id: c.id, name: c.name } : null;
}

export function brandById(id: string | null) {
  const b = db().brands.find((x) => x.id === id);
  return b ? { id: b.id, name: b.name } : null;
}

export function warehouseById(id: string) {
  const w = db().warehouses.find((x) => x.id === id);
  return w ? { id: w.id, name: w.name, code: w.code } : { id, name: 'Unknown', code: '—' };
}

export function userById(id: string) {
  const u = db().users.find((x) => x.id === id);
  return { id, fullName: u?.fullName ?? 'Demo User' };
}

export function customerById(id: string | null) {
  if (!id) return null;
  const c = db().customers.find((x) => x.id === id);
  return c ? { id: c.id, name: c.name, phone: c.phone } : null;
}

export function supplierById(id: string) {
  const s = db().suppliers.find((x) => x.id === id);
  return s ? { id: s.id, name: s.name, phone: s.phone } : { id, name: 'Unknown supplier', phone: null };
}

export function productById(id: string): CatProduct | undefined {
  return db().products.find((p) => p.id === id);
}

// ─── Stock ───────────────────────────────────────────────────────────────────

export function stockRow(productId: string, warehouseId: string) {
  return db().stock.find((s) => s.productId === productId && s.warehouseId === warehouseId);
}

export function stockQty(productId: string, warehouseId: string): number {
  return stockRow(productId, warehouseId)?.qty ?? 0;
}

export function totalStock(productId: string): number {
  return db().stock.filter((s) => s.productId === productId).reduce((n, s) => n + s.qty, 0);
}

/** Move stock and record the movement, the way the real service does. */
export function applyStock(
  productId: string, warehouseId: string, deltaQty: number,
  type: string, refType: string | null, refId: string | null, note: string | null = null,
) {
  const d = db();
  let row = stockRow(productId, warehouseId);
  if (!row) {
    row = { productId, warehouseId, qty: 0, shortfallQty: 0 };
    d.stock.push(row);
  }
  row.qty = Math.max(0, row.qty + deltaQty);
  d.movements.push({
    id: `mov_${d.movements.length + 1}_${Date.now().toString(36)}`,
    productId, warehouseId, type, qty: deltaQty,
    refType, refId, note, createdAt: new Date().toISOString(),
  });

  // Batch-tracked products draw from the nearest expiry first (FEFO), which is
  // what the real checkout does.
  if (deltaQty < 0) {
    let remaining = -deltaQty;
    const lots = d.batches
      .filter((b) => b.productId === productId && b.warehouseId === warehouseId && b.qty > 0)
      .sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'));
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = Math.min(lot.qty, remaining);
      lot.qty -= take;
      remaining -= take;
    }
  }
}

// ─── Shapes ──────────────────────────────────────────────────────────────────

export function shapeProductStock(productId: string) {
  return db().stock
    .filter((s) => s.productId === productId)
    .map((s) => ({
      qty: String(s.qty),
      warehouseId: s.warehouseId,
      warehouse: { name: warehouseById(s.warehouseId).name, code: warehouseById(s.warehouseId).code },
    }));
}

export function shapeProduct(p: CatProduct) {
  const unit = unitById(p.unitId)!;
  const box = unitById('unit_box');
  return {
    id: p.id, sku: p.sku, barcode: p.barcode, name: p.name,
    description: null,
    categoryId: p.categoryId, category: categoryById(p.categoryId),
    brandId: p.brandId, brand: brandById(p.brandId),
    unitId: p.unitId, unit,
    baseUnitId: p.unitId, purchaseUnitId: null, salesUnitId: null,
    costEntryUnitId: null, priceEntryUnitId: null,
    baseUnit: unit, purchaseUnit: null, salesUnit: null,
    unitConversions: p.boxOf && box
      ? [{ fromUnitId: box.id, toUnitId: p.unitId, conversionQty: p.boxOf, fromUnit: { shortCode: box.shortCode } }]
      : [],
    costCents: p.costCents, lastCostCents: p.costCents, priceCents: p.priceCents,
    defaultDiscountCents: 0, serviceChargeCents: 0, serviceChargeLabel: null, serviceChargeMode: 'NONE',
    receiptName: null, taxPercent: 0,
    reorderLevel: p.reorderLevel, reorderQty: p.reorderQty,
    isActive: true, imageUrl: null,
    expiryDate: null, expiryAlertDays: 30,
    isBatchTracked: !!p.isBatchTracked,
    defaultSupplierId: null,
    stock: shapeProductStock(p.id),
    createdAt: db().seededAt, updatedAt: db().seededAt,
  };
}

export function batchSummary(productId: string, warehouseId: string) {
  const p = productById(productId);
  if (!p?.isBatchTracked) return null;
  const lots = db().batches.filter((b) => b.productId === productId && b.warehouseId === warehouseId && b.qty > 0);
  if (!lots.length) {
    return { sellableQty: 0, expiredQty: 0, expiringSoonQty: 0, nearestExpiry: null, expiryStatus: 'none' as const, batchCount: 0 };
  }
  const now = Date.now();
  const soon = now + 60 * 24 * 3600 * 1000;
  let expired = 0, expiringSoon = 0, sellable = 0;
  let nearest: string | null = null;
  for (const l of lots) {
    const t = l.expiryDate ? Date.parse(l.expiryDate) : Infinity;
    if (t < now) expired += l.qty;
    else {
      sellable += l.qty;
      if (t < soon) expiringSoon += l.qty;
    }
    if (l.expiryDate && (!nearest || l.expiryDate < nearest)) nearest = l.expiryDate;
  }
  const expiryStatus = expired > 0 ? 'has_expired_batch' : expiringSoon > 0 ? 'expiring' : 'ok';
  return { sellableQty: sellable, expiredQty: expired, expiringSoonQty: expiringSoon, nearestExpiry: nearest, expiryStatus, batchCount: lots.length };
}

export function shapePosProduct(p: CatProduct, warehouseId: string) {
  const unit = unitById(p.unitId)!;
  const box = unitById('unit_box');
  return {
    id: p.id, sku: p.sku, barcode: p.barcode, name: p.name,
    categoryId: p.categoryId,
    priceCents: p.priceCents, costCents: p.costCents,
    defaultDiscountCents: 0, serviceChargeCents: 0, serviceChargeLabel: null, serviceChargeMode: 'NONE',
    receiptName: null, taxPercent: 0, imageUrl: null,
    expiryDate: null, expiryAlertDays: 30, isBatchTracked: !!p.isBatchTracked,
    unitId: p.unitId, baseUnitId: p.unitId, purchaseUnitId: null, salesUnitId: null,
    unit, baseUnit: unit, salesUnit: null,
    unitConversions: p.boxOf && box
      ? [{
          id: `conv_${p.id}`, fromUnitId: box.id, toUnitId: p.unitId, conversionQty: p.boxOf,
          priceCents: p.priceCents * p.boxOf, discountType: null, discountValue: null,
          fromUnit: { id: box.id, name: box.name, shortCode: box.shortCode, allowDecimal: box.allowDecimal },
          toUnit: { id: unit.id, name: unit.name, shortCode: unit.shortCode },
        }]
      : [],
    stock: [{ qty: String(stockQty(p.id, warehouseId)), shortfallQty: '0' }],
    batchSummary: batchSummary(p.id, warehouseId),
  };
}

export function saleLineShape(l: DemoSale['lines'][number]) {
  const p = productById(l.productId);
  return {
    id: l.id, productId: l.productId, qty: l.qty, unitPriceCents: l.unitPriceCents,
    taxPercent: l.taxPercent, discountCents: l.discountCents, lineTotalCents: l.lineTotalCents,
    unitId: l.unitId, baseQty: l.qty,
    product: {
      id: l.productId, name: p?.name ?? 'Unknown', sku: p?.sku ?? '—',
      unit: { shortCode: unitById(l.unitId)?.shortCode ?? 'pcs' },
    },
  };
}

export function paymentStatusOf(s: DemoSale): 'UNPAID' | 'PARTIAL' | 'PAID' {
  if (s.paidCents <= 0) return 'UNPAID';
  return s.paidCents >= s.totalCents ? 'PAID' : 'PARTIAL';
}

export function shapeSale(s: DemoSale, withLines: boolean) {
  return {
    id: s.id, number: s.number, isPos: s.isPos, status: s.status, date: s.date,
    subtotalCents: s.subtotalCents, taxCents: s.taxCents, discountCents: s.discountCents,
    totalCents: s.totalCents, paidCents: s.paidCents,
    paymentStatus: paymentStatusOf(s), paymentMethod: s.paymentMethod, note: s.note,
    customer: customerById(s.customerId),
    warehouse: warehouseById(s.warehouseId),
    createdBy: userById(s.createdById),
    ...(withLines ? { lines: s.lines.map(saleLineShape) } : {}),
    returns: [],
    _count: { lines: s.lines.length },
    createdAt: s.createdAt,
  };
}

export function shapePurchase(p: DemoPurchase, withLines: boolean) {
  const paid = p.paidCents;
  return {
    id: p.id, number: p.number, status: p.status, deliveryStatus: p.deliveryStatus,
    date: p.date, expectedDate: p.expectedDate, note: p.note,
    subtotalCents: p.subtotalCents, taxCents: p.taxCents, totalCents: p.totalCents,
    paidCents: paid,
    paymentStatus: paid <= 0 ? 'UNPAID' : paid >= p.totalCents ? 'PAID' : 'PARTIAL',
    supplier: supplierById(p.supplierId),
    supplierId: p.supplierId,
    warehouse: warehouseById(p.warehouseId),
    warehouseId: p.warehouseId,
    createdBy: userById(p.createdById),
    sourceType: null,
    ...(withLines
      ? {
          lines: p.lines.map((l) => {
            const prod = productById(l.productId);
            return {
              id: l.id, productId: l.productId, qty: l.qty, receivedQty: l.receivedQty,
              unitCostCents: l.unitCostCents, taxPercent: l.taxPercent,
              lineTotalCents: l.lineTotalCents, unitId: l.unitId, baseQty: l.qty,
              product: {
                id: l.productId, name: prod?.name ?? 'Unknown', sku: prod?.sku ?? '—',
                unit: { shortCode: unitById(l.unitId)?.shortCode ?? 'pcs' },
              },
            };
          }),
        }
      : {}),
    _count: { lines: p.lines.length },
    createdAt: p.createdAt,
  };
}

// ─── Query helpers ───────────────────────────────────────────────────────────

export function paginate<T>(rows: T[], query: Record<string, string>) {
  const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.max(1, parseInt(query.pageSize ?? '25', 10) || 25);
  const start = (page - 1) * pageSize;
  return { total: rows.length, page, pageSize, data: rows.slice(start, start + pageSize) };
}

export function matches(haystack: (string | null | undefined)[], needle: string | undefined): boolean {
  if (!needle) return true;
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return haystack.some((h) => (h ?? '').toLowerCase().includes(q));
}

/**
 * Local-day range test. Compares `YYYY-MM-DD` strings built from the LOCAL
 * calendar, never `toISOString().slice(0,10)` — see CLAUDE.md issue 21, where a
 * UTC-derived boundary cut a Colombo day off at 05:30 that morning.
 */
export function inLocalRange(iso: string, from?: string, to?: string): boolean {
  const ymd = toLocalYMD(new Date(iso));
  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

export function ymdOf(iso: string): string {
  return toLocalYMD(new Date(iso));
}

/** Confirmed, non-cancelled sales — the basis of every revenue figure. */
export function realSales(d: DemoDb = db()): DemoSale[] {
  return d.sales.filter((s) => s.status === 'CONFIRMED');
}

export function cogsOf(s: DemoSale): number {
  return s.lines.reduce((n, l) => n + l.qty * (productById(l.productId)?.costCents ?? 0), 0);
}
