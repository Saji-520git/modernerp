// ─── Products, stock, movements and alerts ───────────────────────────────────

import { DemoHttpError, type DemoHandler } from '../http';
import {
  db, paginate, matches, shapeProduct, productById, totalStock, stockQty,
  warehouseById, unitById, categoryById, batchSummary, applyStock, inLocalRange,
} from '../support';
import { nextId, nextDocNumber } from '../db';

// ─── Products ────────────────────────────────────────────────────────────────

export const listProducts: DemoHandler = ({ query }) => {
  let rows = db().products.filter((p) => matches([p.name, p.sku, p.barcode], query.search));
  if (query.categoryId) rows = rows.filter((p) => p.categoryId === query.categoryId);
  if (query.brandId) rows = rows.filter((p) => p.brandId === query.brandId);
  // isActive=all shows everything; the demo has no deactivated products, but the
  // filter still has to behave.
  return paginate(rows.map(shapeProduct), { ...query, pageSize: query.pageSize ?? '50' });
};

export const productsMeta: DemoHandler = () => ({
  categories: db().categories.map((c) => ({ id: c.id, name: c.name })),
  brands: db().brands.map((b) => ({ id: b.id, name: b.name })),
  units: db().units.map((u) => ({ id: u.id, name: u.name, shortCode: u.shortCode })),
});

export const getProduct: DemoHandler = ({ params }) => {
  const p = productById(params.id);
  if (!p) throw new DemoHttpError(404, 'Product not found');
  return shapeProduct(p);
};

export const getByBarcode: DemoHandler = ({ params }) => {
  const code = params.barcode.trim();
  const p = db().products.find((x) => x.barcode === code || x.sku.toLowerCase() === code.toLowerCase());
  // A 404 here is load-bearing: POS, Products, Sales, Purchases and Inventory
  // all branch on `err.response.status === 404` to offer "add this product".
  if (!p) throw new DemoHttpError(404, 'No product with that barcode.');
  return { product: shapeProduct(p) };
};

export const createProduct: DemoHandler = ({ body }) => {
  const d = db();
  const name = String(body?.name ?? '').trim();
  if (!name) throw new DemoHttpError(400, 'Product name is required');
  const sku = String(body?.sku ?? '').trim() || nextDocNumber('SKU', d.products.map((p) => p.sku));
  if (d.products.some((p) => p.sku.toLowerCase() === sku.toLowerCase())) {
    throw new DemoHttpError(409, `SKU ${sku} is already in use.`);
  }
  const barcode = body?.barcode ? String(body.barcode).trim() : '';
  if (barcode && d.products.some((p) => p.barcode === barcode)) {
    throw new DemoHttpError(409, `Barcode ${barcode} is already on another product.`);
  }
  const p = {
    id: nextId('p'), sku, barcode, name,
    categoryId: body?.categoryId ?? d.categories[0].id,
    brandId: body?.brandId ?? 'brd_generic',
    unitId: body?.unitId ?? 'unit_pcs',
    costCents: Number(body?.costCents ?? 0),
    priceCents: Number(body?.priceCents ?? 0),
    reorderLevel: Number(body?.reorderLevel ?? 0),
    reorderQty: Number(body?.reorderQty ?? 0),
    stock: {} as Record<string, number>,
    isBatchTracked: !!body?.isBatchTracked,
  };
  d.products.push(p);
  for (const w of d.warehouses) d.stock.push({ productId: p.id, warehouseId: w.id, qty: 0, shortfallQty: 0 });
  return shapeProduct(p);
};

export const updateProduct: DemoHandler = ({ params, body }) => {
  const p = productById(params.id);
  if (!p) throw new DemoHttpError(404, 'Product not found');
  const patch = body ?? {};
  for (const k of ['name', 'sku', 'barcode', 'categoryId', 'brandId', 'unitId'] as const) {
    if (patch[k] !== undefined) (p as any)[k] = patch[k];
  }
  for (const k of ['costCents', 'priceCents', 'reorderLevel', 'reorderQty'] as const) {
    if (patch[k] !== undefined) (p as any)[k] = Number(patch[k]);
  }
  if (patch.isBatchTracked !== undefined) p.isBatchTracked = !!patch.isBatchTracked;
  return shapeProduct(p);
};

export const toggleProduct: DemoHandler = ({ params }) => {
  const p = productById(params.id);
  if (!p) throw new DemoHttpError(404, 'Product not found');
  return { id: p.id, isActive: true, name: p.name };
};

export const productConversions: DemoHandler = ({ params }) => {
  const p = productById(params.id);
  if (!p?.boxOf) return [];
  return [{
    id: `conv_${p.id}`, fromUnitId: 'unit_box', toUnitId: p.unitId, conversionQty: p.boxOf,
    priceCents: p.priceCents * p.boxOf, barcode: null,
    fromUnit: unitById('unit_box'), toUnit: unitById(p.unitId),
  }];
};

// ─── Stock ───────────────────────────────────────────────────────────────────

function shapeStockRow(s: { productId: string; warehouseId: string; qty: number; shortfallQty: number }) {
  const p = productById(s.productId);
  if (!p) return null;
  const unit = unitById(p.unitId)!;
  const summary = batchSummary(p.id, s.warehouseId);
  const effective = s.qty - s.shortfallQty;
  return {
    id: `${s.productId}_${s.warehouseId}`,
    qty: s.qty,
    shortfallQty: s.shortfallQty,
    effectiveQty: effective,
    isOversold: s.shortfallQty > 0,
    isLowStock: s.qty <= p.reorderLevel,
    sellableQty: summary?.sellableQty ?? s.qty,
    expiredQty: summary?.expiredQty ?? 0,
    expiringSoonQty: summary?.expiringSoonQty ?? 0,
    nearestExpiry: summary?.nearestExpiry ?? null,
    expiryStatus: summary?.expiryStatus ?? 'none',
    stockValueCents: s.qty * p.costCents,
    product: {
      id: p.id, name: p.name, sku: p.sku, barcode: p.barcode,
      costCents: p.costCents, reorderLevel: p.reorderLevel, reorderQty: p.reorderQty,
      baseUnitId: p.unitId,
      unit: { id: unit.id, shortCode: unit.shortCode, allowDecimal: unit.allowDecimal },
      baseUnit: { id: unit.id, shortCode: unit.shortCode, allowDecimal: unit.allowDecimal },
      unitConversions: p.boxOf
        ? [{ fromUnitId: 'unit_box', toUnitId: p.unitId, conversionQty: p.boxOf, fromUnit: { id: 'unit_box', shortCode: 'box', allowDecimal: false } }]
        : [],
      category: categoryById(p.categoryId),
    },
    warehouse: warehouseById(s.warehouseId),
  };
}

export const listStock: DemoHandler = ({ query }) => {
  const d = db();
  let rows = d.stock.map(shapeStockRow).filter(Boolean) as NonNullable<ReturnType<typeof shapeStockRow>>[];
  if (query.warehouseId) rows = rows.filter((r) => r.warehouse.id === query.warehouseId);
  if (query.categoryId) {
    rows = rows.filter((r) => productById(r.product.id)?.categoryId === query.categoryId);
  }
  // Barcode is searched here as well as name and SKU — the client-side re-filter
  // that used to drop it was CLAUDE.md issue 14.
  rows = rows.filter((r) => matches([r.product.name, r.product.sku, r.product.barcode], query.search));
  if (query.productId) rows = rows.filter((r) => r.product.id === query.productId);
  // The parameter names come from inventoryApi.listStock — `lowStockOnly`, not
  // `lowStock`. Getting this wrong silently returned every row, which is how the
  // dashboard came to claim "64 low" against a 32-product catalogue.
  if (query.lowStockOnly === 'true') rows = rows.filter((r) => r.isLowStock);
  if (query.outStockOnly === 'true') rows = rows.filter((r) => r.qty <= 0);
  rows.sort((a, b) => a.product.name.localeCompare(b.product.name));

  const totalStockValueCents = rows.reduce((n, r) => n + r.stockValueCents, 0);
  return { ...paginate(rows, { ...query, pageSize: query.pageSize ?? '50' }), totalStockValueCents };
};

export const lowStock: DemoHandler = () => {
  const rows = db().stock.map(shapeStockRow).filter(Boolean) as NonNullable<ReturnType<typeof shapeStockRow>>[];
  return rows.filter((r) => r.isLowStock).sort((a, b) => a.qty - b.qty);
};

export const listExpiring: DemoHandler = () => {
  const d = db();
  const out: unknown[] = [];
  for (const p of d.products) {
    if (!p.isBatchTracked) continue;
    for (const w of d.warehouses) {
      const s = batchSummary(p.id, w.id);
      if (!s || s.batchCount === 0) continue;
      if (s.expiryStatus === 'ok') continue;
      out.push({
        product: { id: p.id, name: p.name, sku: p.sku },
        warehouse: { id: w.id, name: w.name },
        totalQty: stockQty(p.id, w.id),
        sellableQty: s.sellableQty, expiredQty: s.expiredQty,
        expiringSoonQty: s.expiringSoonQty, nearestExpiry: s.nearestExpiry,
        expiryStatus: s.expiryStatus,
      });
    }
  }
  return out;
};

export const batchDetail: DemoHandler = ({ params, query }) => {
  const now = Date.now();
  const soon = now + 60 * 24 * 3600 * 1000;
  return db().batches
    .filter((b) => b.productId === params.productId && b.warehouseId === query.warehouseId && b.qty > 0)
    .map((b) => {
      const t = b.expiryDate ? Date.parse(b.expiryDate) : null;
      return {
        id: b.id, qty: b.qty, unitCostCents: b.unitCostCents,
        batchNumber: b.batchNumber, expiryDate: b.expiryDate, receivedAt: b.receivedAt,
        status: t === null ? 'no_expiry' : t < now ? 'expired' : t < soon ? 'expiring_soon' : 'ok',
      };
    })
    .sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'));
};

export const posBatches: DemoHandler = ({ params, query }) => {
  const now = Date.now();
  const soon = now + 60 * 24 * 3600 * 1000;
  const p = productById(params.productId);
  return db().batches
    .filter((b) => b.productId === params.productId && b.warehouseId === query.warehouseId && b.qty > 0)
    .map((b) => {
      const t = b.expiryDate ? Date.parse(b.expiryDate) : null;
      return {
        id: b.id, qty: b.qty, unitCostCents: b.unitCostCents,
        sellingPriceCents: p?.priceCents ?? 0,
        supplierId: null, supplierName: null, isDamaged: false,
        batchNumber: b.batchNumber, expiryDate: b.expiryDate, receivedAt: b.receivedAt,
        status: t === null ? 'no_expiry' : t < now ? 'expired' : t < soon ? 'expiring_soon' : 'ok',
      };
    })
    .sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'));
};

export const createAdjustment: DemoHandler = ({ body }) => {
  const { productId, warehouseId, qty, reason } = body ?? {};
  const p = productById(String(productId));
  if (!p) throw new DemoHttpError(404, 'Product not found');
  const delta = Number(qty);
  if (!Number.isFinite(delta) || delta === 0) throw new DemoHttpError(400, 'Quantity must be a non-zero number');
  applyStock(p.id, String(warehouseId), delta, 'ADJUSTMENT', 'ADJUSTMENT', null, String(reason ?? ''));
  return { success: true, productId: p.id, warehouseId, newQty: stockQty(p.id, String(warehouseId)) };
};

export const createTransfer: DemoHandler = ({ body }) => {
  const { productId, fromWarehouseId, toWarehouseId, qty, note } = body ?? {};
  const p = productById(String(productId));
  if (!p) throw new DemoHttpError(404, 'Product not found');
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) throw new DemoHttpError(400, 'Quantity must be greater than zero');
  if (fromWarehouseId === toWarehouseId) throw new DemoHttpError(400, 'Pick two different warehouses');
  if (stockQty(p.id, String(fromWarehouseId)) < n) {
    throw new DemoHttpError(400, `Only ${stockQty(p.id, String(fromWarehouseId))} in stock at the source warehouse.`);
  }
  applyStock(p.id, String(fromWarehouseId), -n, 'TRANSFER_OUT', 'TRANSFER', null, String(note ?? ''));
  applyStock(p.id, String(toWarehouseId), n, 'TRANSFER_IN', 'TRANSFER', null, String(note ?? ''));
  return { success: true };
};

export const listMovements: DemoHandler = ({ query }) => {
  const d = db();
  let rows = [...d.movements].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (query.productId) rows = rows.filter((m) => m.productId === query.productId);
  if (query.warehouseId) rows = rows.filter((m) => m.warehouseId === query.warehouseId);
  if (query.type) rows = rows.filter((m) => m.type === query.type);
  if (query.from || query.to) rows = rows.filter((m) => inLocalRange(m.createdAt, query.from, query.to));
  if (query.search) {
    rows = rows.filter((m) => matches([productById(m.productId)?.name, productById(m.productId)?.sku], query.search));
  }
  const shaped = rows.map((m) => {
    const p = productById(m.productId);
    return {
      id: m.id, type: m.type, qty: m.qty, refType: m.refType, refId: m.refId,
      note: m.note, createdAt: m.createdAt,
      product: { id: m.productId, name: p?.name ?? 'Unknown', sku: p?.sku ?? '—' },
      warehouse: warehouseById(m.warehouseId),
    };
  });
  return paginate(shaped, query);
};

// ─── Alerts ──────────────────────────────────────────────────────────────────
//
// Derived on every read rather than stored, so an alert clears the moment the
// stock behind it does. Read/dismissed state is the only part that persists.

interface BuiltAlert {
  id: string; type: 'LOW_STOCK' | 'EXPIRING_SOON' | 'EXPIRED'; severity: 'WARNING' | 'CRITICAL';
  productId: string; product: { id: string; name: string; sku: string };
  warehouseId: string | null; warehouse: { id: string; name: string } | null;
  qty: number; threshold: number; expiryDate: string | null; message: string;
  isRead: boolean; isDismissed: boolean; createdAt: string; updatedAt: string;
}

function buildAlerts(): BuiltAlert[] {
  const d = db();
  const out: BuiltAlert[] = [];
  const stamp = d.seededAt;

  for (const p of d.products) {
    const total = totalStock(p.id);
    if (total <= p.reorderLevel) {
      const id = `al_low_${p.id}`;
      out.push({
        id, type: 'LOW_STOCK',
        severity: total === 0 ? 'CRITICAL' : 'WARNING',
        productId: p.id, product: { id: p.id, name: p.name, sku: p.sku },
        warehouseId: null, warehouse: null,
        qty: total, threshold: p.reorderLevel, expiryDate: null,
        message: total === 0
          ? `${p.name} is out of stock.`
          : `${p.name} is down to ${total} — reorder level is ${p.reorderLevel}.`,
        isRead: d.alertsRead.includes(id), isDismissed: d.alertsDismissed.includes(id),
        createdAt: stamp, updatedAt: stamp,
      });
    }
    if (!p.isBatchTracked) continue;
    for (const w of d.warehouses) {
      const s = batchSummary(p.id, w.id);
      if (!s || s.batchCount === 0) continue;
      if (s.expiredQty > 0) {
        const id = `al_exp_${p.id}_${w.id}`;
        out.push({
          id, type: 'EXPIRED', severity: 'CRITICAL',
          productId: p.id, product: { id: p.id, name: p.name, sku: p.sku },
          warehouseId: w.id, warehouse: { id: w.id, name: w.name },
          qty: s.expiredQty, threshold: 0, expiryDate: s.nearestExpiry,
          message: `${s.expiredQty} × ${p.name} has passed its expiry date at ${w.name}.`,
          isRead: d.alertsRead.includes(id), isDismissed: d.alertsDismissed.includes(id),
          createdAt: stamp, updatedAt: stamp,
        });
      } else if (s.expiringSoonQty > 0) {
        const id = `al_soon_${p.id}_${w.id}`;
        out.push({
          id, type: 'EXPIRING_SOON', severity: 'WARNING',
          productId: p.id, product: { id: p.id, name: p.name, sku: p.sku },
          warehouseId: w.id, warehouse: { id: w.id, name: w.name },
          qty: s.expiringSoonQty, threshold: 60, expiryDate: s.nearestExpiry,
          message: `${s.expiringSoonQty} × ${p.name} expires within 60 days at ${w.name}.`,
          isRead: d.alertsRead.includes(id), isDismissed: d.alertsDismissed.includes(id),
          createdAt: stamp, updatedAt: stamp,
        });
      }
    }
  }
  return out.filter((a) => !a.isDismissed);
}

export const listAlerts: DemoHandler = ({ query }) => {
  let rows = buildAlerts();
  if (query.type) rows = rows.filter((a) => a.type === query.type);
  if (query.severity) rows = rows.filter((a) => a.severity === query.severity);
  if (query.isRead === 'false') rows = rows.filter((a) => !a.isRead);
  if (query.isRead === 'true') rows = rows.filter((a) => a.isRead);
  const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.max(1, parseInt(query.pageSize ?? '50', 10) || 50);
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    unreadCount: rows.filter((a) => !a.isRead).length,
    criticalCount: rows.filter((a) => a.severity === 'CRITICAL').length,
    page, pageSize,
  };
};

export const alertCount: DemoHandler = () => {
  const rows = buildAlerts();
  return { count: rows.filter((a) => !a.isRead).length, critical: rows.filter((a) => a.severity === 'CRITICAL').length };
};

export const markAlertsRead: DemoHandler = ({ body }) => {
  const d = db();
  const ids = body?.ids;
  const target = ids === 'all' ? buildAlerts().map((a) => a.id) : (ids ?? []);
  for (const id of target) if (!d.alertsRead.includes(id)) d.alertsRead.push(id);
  return { success: true };
};

export const dismissAlert: DemoHandler = ({ params }) => {
  const d = db();
  if (!d.alertsDismissed.includes(params.id)) d.alertsDismissed.push(params.id);
  return { success: true };
};

export const dismissAllAlerts: DemoHandler = ({ query }) => {
  const d = db();
  for (const a of buildAlerts()) {
    if (query.type && a.type !== query.type) continue;
    if (!d.alertsDismissed.includes(a.id)) d.alertsDismissed.push(a.id);
  }
  return { success: true };
};

export const writeOff: DemoHandler = ({ body }) => {
  const d = db();
  const lot = d.batches.find((b) => b.id === body?.batchId);
  if (!lot) throw new DemoHttpError(404, 'Batch not found');
  const qty = Number(body?.qty ?? 0);
  if (qty <= 0 || qty > lot.qty) throw new DemoHttpError(400, `Enter between 1 and ${lot.qty}.`);
  lot.qty -= qty;
  const row = d.stock.find((s) => s.productId === lot.productId && s.warehouseId === lot.warehouseId);
  if (row) row.qty = Math.max(0, row.qty - qty);
  const lossCents = qty * lot.unitCostCents;
  d.movements.push({
    id: nextId('mov'), productId: lot.productId, warehouseId: lot.warehouseId,
    type: 'WRITE_OFF', qty: -qty, refType: 'WRITE_OFF', refId: lot.id,
    note: String(body?.reason ?? ''), createdAt: new Date().toISOString(),
  });
  const expenseId = nextId('exp');
  d.expenses.push({
    id: expenseId, categoryId: 'exc_misc', amountCents: lossCents,
    date: new Date().toISOString(), description: `Stock write-off — ${productById(lot.productId)?.name ?? ''}`,
    reference: lot.batchNumber, paymentMethod: 'CASH', createdById: d.users[0].id,
    createdAt: new Date().toISOString(),
  });
  return {
    batchId: lot.id, productId: lot.productId, warehouseId: lot.warehouseId, qty,
    lossCents, expense: { id: expenseId, amount: lossCents, reference: lot.batchNumber ?? '' },
    reason: String(body?.reason ?? ''),
  };
};
