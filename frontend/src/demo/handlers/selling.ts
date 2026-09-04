// ─── POS, sales, customers ───────────────────────────────────────────────────

import { DemoHttpError, type DemoHandler } from '../adapter';
import {
  db, paginate, matches, productById, shapePosProduct, shapeSale, saleLineShape,
  stockQty, applyStock, warehouseById, customerById, userById, unitById,
  inLocalRange, realSales, paymentStatusOf,
} from '../support';
import { nextId, nextDocNumber, type DemoSale, type DemoSaleLine } from '../db';

// ─── POS ─────────────────────────────────────────────────────────────────────

export const posWarehouses: DemoHandler = () =>
  db().warehouses.filter((w) => w.isActive).map((w) => ({ id: w.id, name: w.name, code: w.code, isDefault: w.isDefault }));

export const posProducts: DemoHandler = ({ query }) => {
  const wh = query.warehouseId || db().warehouses.find((w) => w.isDefault)?.id || 'wh_main';
  let rows = db().products.filter((p) => matches([p.name, p.sku, p.barcode], query.search));
  if (query.categoryId) rows = rows.filter((p) => p.categoryId === query.categoryId);
  if (query.brandId) rows = rows.filter((p) => p.brandId === query.brandId);
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return paginate(rows.map((p) => shapePosProduct(p, wh)), { ...query, pageSize: query.pageSize ?? '60' });
};

export const setPosPrice: DemoHandler = ({ params, body }) => {
  const p = productById(params.id);
  if (!p) throw new DemoHttpError(404, 'Product not found');
  // The real endpoint fills in a MISSING price only — it is not an override.
  if (p.priceCents > 0) throw new DemoHttpError(400, 'This product already has a sale price.');
  p.priceCents = Number(body?.priceCents ?? 0);
  return { id: p.id, name: p.name, priceCents: p.priceCents };
};

function buildReceipt(sale: DemoSale) {
  const d = db();
  const user = d.users.find((u) => u.id === sale.createdById);
  const cust = d.customers.find((c) => c.id === sale.customerId);
  return {
    id: sale.id, number: sale.number, date: sale.date,
    cashier: user?.fullName ?? 'Demo User',
    customer: cust ? { id: cust.id, name: cust.name, phone: cust.phone } : null,
    paymentMethod: sale.paymentMethod,
    isCreditSale: sale.paymentMethod === 'CREDIT',
    isStaffSale: false,
    warehouseName: warehouseById(sale.warehouseId).name,
    lines: sale.lines.map((l) => {
      const p = productById(l.productId);
      return {
        product: { id: l.productId, name: p?.name ?? 'Unknown', sku: p?.sku ?? '—', receiptName: null },
        qty: l.qty, unitPriceCents: l.unitPriceCents, taxPercent: 0,
        discountCents: l.discountCents, lineTotalCents: l.lineTotalCents,
        unitShortCode: unitById(l.unitId)?.shortCode ?? 'pcs',
      };
    }),
    subtotalCents: sale.subtotalCents, taxCents: 0,
    discountCents: sale.discountCents, totalCents: sale.totalCents, paidCents: sale.paidCents,
  };
}

export const posCheckout: DemoHandler = ({ body }) => {
  const d = db();
  const warehouseId = String(body?.warehouseId ?? 'wh_main');
  const items = (body?.items ?? []) as Array<{ productId: string; qty: number; unitPriceCents?: number; unitId?: string; discountCents?: number }>;
  if (!items.length) throw new DemoHttpError(400, 'The cart is empty.');

  const allowNegative = d.settings.allowNegativeStock === true;
  const warnings: string[] = [];
  const lines: DemoSaleLine[] = [];

  items.forEach((it, idx) => {
    const p = productById(it.productId);
    if (!p) throw new DemoHttpError(404, `Product ${it.productId} no longer exists.`);

    // A line may be priced in a larger unit (a box of 50 elbows); stock always
    // moves in base units, which is what the real checkout converts to.
    const perBase = it.unitId === 'unit_box' && p.boxOf ? p.boxOf : 1;
    const baseQty = it.qty * perBase;

    const onHand = stockQty(p.id, warehouseId);
    if (baseQty > onHand && !allowNegative) {
      throw new DemoHttpError(
        400,
        `Not enough stock for ${p.name}. ${onHand} available, ${baseQty} requested.`,
      );
    }
    if (baseQty > onHand) warnings.push(`${p.name} sold ${baseQty - onHand} past zero.`);

    const unitPrice = it.unitPriceCents ?? (perBase > 1 ? p.priceCents * perBase : p.priceCents);
    const discount = Number(it.discountCents ?? 0);
    lines.push({
      id: `sl_${idx}_${Date.now().toString(36)}`,
      productId: p.id, qty: it.qty, unitPriceCents: unitPrice,
      taxPercent: 0, discountCents: discount,
      lineTotalCents: it.qty * unitPrice - discount,
      unitId: it.unitId ?? p.unitId,
    });
  });

  const subtotal = lines.reduce((n, l) => n + l.lineTotalCents, 0);
  let cartDiscount = Number(body?.cartDiscountCents ?? 0);
  if (body?.cartDiscountPercent) cartDiscount = Math.round((subtotal * Number(body.cartDiscountPercent)) / 100);
  cartDiscount = Math.min(cartDiscount, subtotal);
  const total = subtotal - cartDiscount;

  const method = String(body?.paymentMethod ?? 'CASH');
  const customerId = body?.customerId ? String(body.customerId) : null;

  if (method === 'CREDIT') {
    const cust = d.customers.find((c) => c.id === customerId);
    if (!cust) throw new DemoHttpError(400, 'Pick a customer before selling on credit.');
    if (!cust.creditEnabled) throw new DemoHttpError(400, `${cust.name} is not set up for credit sales.`);
    const outstanding = creditBalanceOf(cust.id);
    if (cust.creditLimitCents > 0 && outstanding + total > cust.creditLimitCents) {
      throw new DemoHttpError(
        400,
        `That would put ${cust.name} over their credit limit (Rs. ${(cust.creditLimitCents / 100).toLocaleString()}).`,
      );
    }
  }

  const cashPortion = Number(body?.cashAmountCents ?? 0);
  const paid = method === 'CREDIT' ? Math.min(cashPortion, total) : total;

  const now = new Date().toISOString();
  const sale: DemoSale = {
    id: nextId('sal'),
    number: nextDocNumber('INV', d.sales.map((s) => s.number)),
    isPos: true, status: 'CONFIRMED', date: now,
    customerId, warehouseId,
    subtotalCents: subtotal, taxCents: 0, discountCents: cartDiscount, totalCents: total,
    paidCents: paid, paymentMethod: method, note: body?.note ?? null,
    createdById: currentUserId(), lines, createdAt: now,
  };
  d.sales.push(sale);

  for (const l of lines) {
    const p = productById(l.productId)!;
    const perBase = l.unitId === 'unit_box' && p.boxOf ? p.boxOf : 1;
    applyStock(l.productId, warehouseId, -(l.qty * perBase), 'SALE_OUT', 'SALE', sale.id);
  }
  if (paid > 0) {
    d.payments.push({
      id: nextId('pay'), saleId: sale.id, purchaseId: null, amountCents: paid,
      method, date: now, note: null, createdById: sale.createdById, createdAt: now,
    });
  }
  if (body?.draftId) {
    d.posDrafts = (d.posDrafts as { id: string }[]).filter((x) => x.id !== body.draftId);
  }

  return { receipt: buildReceipt(sale), warnings: warnings.length ? warnings : undefined };
};

export const posReceipt: DemoHandler = ({ params }) => {
  const s = db().sales.find((x) => x.id === params.id);
  if (!s) throw new DemoHttpError(404, 'Sale not found');
  return buildReceipt(s);
};

export const posSales: DemoHandler = ({ query }) => {
  let rows = db().sales.filter((s) => s.isPos && s.status === 'CONFIRMED');
  if (query.search) rows = rows.filter((s) => matches([s.number, customerById(s.customerId)?.name], query.search));
  if (query.from || query.to) rows = rows.filter((s) => inLocalRange(s.date, query.from, query.to));
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const shaped = rows.map((s) => ({
    id: s.id, number: s.number, date: s.date, totalCents: s.totalCents, paidCents: s.paidCents,
    paymentMethod: s.paymentMethod, customer: customerById(s.customerId),
    createdBy: userById(s.createdById), _count: { lines: s.lines.length },
  }));
  return paginate(shaped, query);
};

// ─── POS drafts (held bills) ─────────────────────────────────────────────────

export const listDrafts: DemoHandler = () => db().posDrafts;

export const saveDraft: DemoHandler = ({ body }) => {
  const d = db();
  const drafts = d.posDrafts as any[];
  const items = (body?.items ?? []).map((i: any, idx: number) => {
    const p = productById(i.productId);
    return {
      id: `di_${idx}`, productId: i.productId, qty: i.qty, unitPriceCents: i.unitPriceCents,
      product: {
        id: i.productId, name: p?.name ?? 'Unknown', sku: p?.sku ?? '—',
        priceCents: p?.priceCents ?? 0, unit: { shortCode: unitById(p?.unitId)?.shortCode ?? 'pcs' },
      },
    };
  });
  const draft = {
    id: body?.id ?? nextId('drf'),
    label: body?.label ?? null,
    warehouseId: body?.warehouseId ?? 'wh_main',
    paymentMethod: body?.paymentMethod ?? 'CASH',
    discountCents: body?.discountCents ?? 0,
    note: body?.note ?? null,
    updatedAt: new Date().toISOString(),
    customer: customerById(body?.customerId ?? null),
    warehouse: warehouseById(body?.warehouseId ?? 'wh_main'),
    items,
  };
  const i = drafts.findIndex((x) => x.id === draft.id);
  if (i >= 0) drafts[i] = draft; else drafts.push(draft);
  return draft;
};

export const deleteDraft: DemoHandler = ({ params }) => {
  const d = db();
  d.posDrafts = (d.posDrafts as { id: string }[]).filter((x) => x.id !== params.id);
  return { success: true };
};

// ─── Customer credit ─────────────────────────────────────────────────────────

export function creditBalanceOf(customerId: string): number {
  return db().sales
    .filter((s) => s.customerId === customerId && s.status === 'CONFIRMED')
    .reduce((n, s) => n + Math.max(0, s.totalCents - s.paidCents), 0);
}

export const customerCredit: DemoHandler = ({ params }) => {
  const c = db().customers.find((x) => x.id === params.id);
  if (!c) throw new DemoHttpError(404, 'Customer not found');
  const balance = creditBalanceOf(c.id);
  const limit = c.creditLimitCents;
  const available = limit > 0 ? limit - balance : -1;
  return {
    creditEnabled: c.creditEnabled, balance, limit, available,
    alertPct: c.creditAlertPct, settleDays: c.creditSettleDays,
    isNearLimit: limit > 0 && balance >= (limit * c.creditAlertPct) / 100,
    isOverLimit: limit > 0 && balance > limit,
  };
};

// ─── Sales ───────────────────────────────────────────────────────────────────

function currentUserId(): string {
  // The demo has no server session; attribute writes to whoever is signed in.
  try {
    const raw = localStorage.getItem('modernerp-auth');
    const id = raw ? JSON.parse(raw)?.state?.user?.id : null;
    if (id && db().users.some((u) => u.id === id)) return id;
  } catch { /* fall through */ }
  return db().users[0].id;
}

export const listSales: DemoHandler = ({ query }) => {
  let rows = [...db().sales];
  if (query.status) rows = rows.filter((s) => s.status === query.status);
  if (query.customerId) rows = rows.filter((s) => s.customerId === query.customerId);
  if (query.warehouseId) rows = rows.filter((s) => s.warehouseId === query.warehouseId);
  if (query.paymentStatus) rows = rows.filter((s) => paymentStatusOf(s) === query.paymentStatus);
  if (query.isPos === 'true') rows = rows.filter((s) => s.isPos);
  if (query.isPos === 'false') rows = rows.filter((s) => !s.isPos);
  if (query.from || query.to) rows = rows.filter((s) => inLocalRange(s.date, query.from, query.to));
  if (query.search) rows = rows.filter((s) => matches([s.number, customerById(s.customerId)?.name], query.search));
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return paginate(rows.map((s) => shapeSale(s, false)), query);
};

export const getSale: DemoHandler = ({ params }) => {
  const s = db().sales.find((x) => x.id === params.id);
  if (!s) throw new DemoHttpError(404, 'Invoice not found');
  return {
    ...shapeSale(s, true),
    customerPayments: db().payments
      .filter((p) => p.saleId === s.id)
      .map((p) => ({
        id: p.id, saleId: p.saleId, purchaseId: null, amountCents: p.amountCents,
        method: p.method, date: p.date, note: p.note, createdAt: p.createdAt,
        createdBy: userById(p.createdById),
      })),
  };
};

export const salesProducts: DemoHandler = ({ query }) => {
  const wh = query.warehouseId || 'wh_main';
  let rows = db().products.filter((p) => matches([p.name, p.sku, p.barcode], query.search));
  rows = rows.slice(0, 200);
  return rows.map((p) => {
    const unit = unitById(p.unitId)!;
    return {
      id: p.id, name: p.name, sku: p.sku, barcode: p.barcode,
      priceCents: p.priceCents, taxPercent: 0,
      stockQty: stockQty(p.id, wh),
      isBatchTracked: !!p.isBatchTracked,
      batchCount: db().batches.filter((b) => b.productId === p.id && b.warehouseId === wh && b.qty > 0).length,
      unit: { id: unit.id, shortCode: unit.shortCode, name: unit.name, allowDecimal: unit.allowDecimal },
      unitId: p.unitId, baseUnitId: p.unitId, salesUnitId: null,
      baseUnit: { id: unit.id, shortCode: unit.shortCode, name: unit.name, allowDecimal: unit.allowDecimal },
      salesUnit: null,
      unitConversions: p.boxOf
        ? [{
            id: `conv_${p.id}`, fromUnitId: 'unit_box', toUnitId: p.unitId, conversionQty: p.boxOf,
            priceCents: p.priceCents * p.boxOf,
            fromUnit: { id: 'unit_box', name: 'Box', shortCode: 'box', allowDecimal: false },
            toUnit: { id: unit.id, name: unit.name, shortCode: unit.shortCode },
          }]
        : [],
    };
  });
};

export const salesCustomers: DemoHandler = ({ query }) =>
  db().customers
    .filter((c) => c.isActive && matches([c.name, c.phone], query.search))
    .map((c) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email }));

export const createSale: DemoHandler = ({ body }) => {
  const d = db();
  const warehouseId = String(body?.warehouseId ?? 'wh_main');
  const inputLines = (body?.lines ?? []) as any[];
  if (!inputLines.length) throw new DemoHttpError(400, 'Add at least one line.');

  const lines: DemoSaleLine[] = inputLines.map((l, idx) => {
    const p = productById(l.productId);
    if (!p) throw new DemoHttpError(404, 'Product not found');
    const qty = Number(l.qty);
    const price = Number(l.unitPriceCents ?? p.priceCents);
    const disc = Number(l.discountCents ?? 0);
    return {
      id: `sl_${idx}_${Date.now().toString(36)}`,
      productId: p.id, qty, unitPriceCents: price, taxPercent: 0,
      discountCents: disc, lineTotalCents: qty * price - disc, unitId: l.unitId ?? p.unitId,
    };
  });
  const subtotal = lines.reduce((n, l) => n + l.lineTotalCents, 0);
  // An empty picker means "now" — never a UTC-midnight instant. See
  // utils/local-date.ts and CLAUDE.md issue 19.
  const date = body?.date ? String(body.date) : new Date().toISOString();
  const sale: DemoSale = {
    id: nextId('sal'),
    number: nextDocNumber('INV', d.sales.map((s) => s.number)),
    isPos: false, status: 'DRAFT', date,
    customerId: body?.customerId ?? null, warehouseId,
    subtotalCents: subtotal, taxCents: 0, discountCents: 0, totalCents: subtotal,
    paidCents: 0, paymentMethod: 'CASH', note: body?.note ?? null,
    createdById: currentUserId(), lines, createdAt: new Date().toISOString(),
  };
  d.sales.push(sale);
  return shapeSale(sale, true);
};

export const confirmSale: DemoHandler = ({ params }) => {
  const s = db().sales.find((x) => x.id === params.id);
  if (!s) throw new DemoHttpError(404, 'Invoice not found');
  if (s.status !== 'DRAFT') throw new DemoHttpError(400, 'Only a draft invoice can be confirmed.');
  for (const l of s.lines) {
    const p = productById(l.productId)!;
    const perBase = l.unitId === 'unit_box' && p.boxOf ? p.boxOf : 1;
    const need = l.qty * perBase;
    if (need > stockQty(l.productId, s.warehouseId) && db().settings.allowNegativeStock !== true) {
      throw new DemoHttpError(400, `Not enough stock for ${p.name}.`);
    }
  }
  s.status = 'CONFIRMED';
  for (const l of s.lines) {
    const p = productById(l.productId)!;
    const perBase = l.unitId === 'unit_box' && p.boxOf ? p.boxOf : 1;
    applyStock(l.productId, s.warehouseId, -(l.qty * perBase), 'SALE_OUT', 'SALE', s.id);
  }
  return shapeSale(s, true);
};

export const cancelSale: DemoHandler = ({ params }) => {
  const s = db().sales.find((x) => x.id === params.id);
  if (!s) throw new DemoHttpError(404, 'Invoice not found');
  if (s.status === 'CONFIRMED') {
    for (const l of s.lines) {
      const p = productById(l.productId)!;
      const perBase = l.unitId === 'unit_box' && p.boxOf ? p.boxOf : 1;
      applyStock(l.productId, s.warehouseId, l.qty * perBase, 'RETURN_IN', 'SALE', s.id, 'Invoice cancelled');
    }
  }
  s.status = 'CANCELLED';
  return shapeSale(s, true);
};

export const paySale: DemoHandler = ({ params, body }) => {
  const d = db();
  const s = d.sales.find((x) => x.id === params.id);
  if (!s) throw new DemoHttpError(404, 'Invoice not found');
  const amount = Number(body?.paidCents ?? 0);
  if (amount <= 0) throw new DemoHttpError(400, 'Enter an amount greater than zero.');
  const outstanding = s.totalCents - s.paidCents;
  if (amount > outstanding) throw new DemoHttpError(400, `Only Rs. ${(outstanding / 100).toLocaleString()} is outstanding.`);
  s.paidCents += amount;
  const now = new Date().toISOString();
  d.payments.push({
    id: nextId('pay'), saleId: s.id, purchaseId: null, amountCents: amount,
    method: String(body?.paymentMethod ?? 'CASH'), date: now, note: null,
    createdById: currentUserId(), createdAt: now,
  });
  return shapeSale(s, true);
};

export const salePayments: DemoHandler = ({ params }) =>
  db().payments
    .filter((p) => p.saleId === params.id)
    .map((p) => ({
      id: p.id, saleId: p.saleId, purchaseId: null, amountCents: p.amountCents,
      method: p.method, date: p.date, note: p.note, createdAt: p.createdAt,
      createdBy: userById(p.createdById),
    }));

// ─── Sale returns ────────────────────────────────────────────────────────────

export const listReturns: DemoHandler = ({ query }) => {
  const rows = [...(db().saleReturns as any[])].sort((a, b) => b.date.localeCompare(a.date));
  return paginate(rows, query);
};

export const returnsForSale: DemoHandler = ({ params }) =>
  (db().saleReturns as any[]).filter((r) => r.saleId === params.id);

export const createReturn: DemoHandler = ({ body }) => {
  const d = db();
  const sale = d.sales.find((s) => s.id === body?.saleId);
  if (!sale) throw new DemoHttpError(404, 'Invoice not found');
  const inputLines = (body?.lines ?? []) as any[];
  if (!inputLines.length) throw new DemoHttpError(400, 'Pick at least one line to return.');

  const lines = inputLines.map((l, idx) => {
    const original = sale.lines.find((x) => x.productId === l.productId);
    if (!original) throw new DemoHttpError(400, 'That product is not on this invoice.');
    const qty = Number(l.qty);
    if (qty <= 0 || qty > original.qty) {
      throw new DemoHttpError(400, `Only ${original.qty} of that line were sold.`);
    }
    const p = productById(l.productId);
    return {
      id: `rl_${idx}`, productId: l.productId, qty,
      unitPriceCents: original.unitPriceCents, lineTotalCents: qty * original.unitPriceCents,
      product: { id: l.productId, name: p?.name ?? 'Unknown', sku: p?.sku ?? '—' },
    };
  });
  const total = lines.reduce((n, l) => n + l.lineTotalCents, 0);
  const now = new Date().toISOString();
  const ret = {
    id: nextId('crn'),
    number: nextDocNumber('CRN', (d.saleReturns as any[]).map((r) => r.number)),
    saleId: sale.id, sale: { id: sale.id, number: sale.number },
    warehouseId: sale.warehouseId, warehouse: warehouseById(sale.warehouseId),
    customer: customerById(sale.customerId),
    reason: body?.reason ?? null, totalCents: total, date: now,
    createdBy: userById(currentUserId()), lines, createdAt: now,
  };
  (d.saleReturns as any[]).push(ret);
  for (const l of lines) {
    applyStock(l.productId, sale.warehouseId, l.qty, 'RETURN_IN', 'SALE_RETURN', ret.id, 'Customer return');
  }
  return ret;
};

export const getReturn: DemoHandler = ({ params }) => {
  const r = (db().saleReturns as any[]).find((x) => x.id === params.id);
  if (!r) throw new DemoHttpError(404, 'Credit note not found');
  return r;
};

// ─── Customers ───────────────────────────────────────────────────────────────

function shapeCustomer(c: ReturnType<typeof db>['customers'][number]) {
  const sales = db().sales.filter((s) => s.customerId === c.id && s.status === 'CONFIRMED');
  return {
    id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address,
    isActive: c.isActive, createdAt: db().seededAt,
    creditEnabled: c.creditEnabled, creditLimitCents: c.creditLimitCents,
    creditAlertPct: c.creditAlertPct, creditSettleDays: c.creditSettleDays,
    openingBalanceCents: c.openingBalanceCents, openingBalanceAsOf: null,
    creditBalanceCents: creditBalanceOf(c.id),
    _count: { sales: sales.length },
  };
}

export const listCustomers: DemoHandler = ({ query }) => {
  let rows = db().customers.filter((c) => matches([c.name, c.phone, c.email], query.search));
  if (query.isActive === 'true') rows = rows.filter((c) => c.isActive);
  if (query.isActive === 'false') rows = rows.filter((c) => !c.isActive);
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return paginate(rows.map(shapeCustomer), { ...query, pageSize: query.pageSize ?? '50' });
};

export const getCustomer: DemoHandler = ({ params }) => {
  const c = db().customers.find((x) => x.id === params.id);
  if (!c) throw new DemoHttpError(404, 'Customer not found');
  const sales = db().sales.filter((s) => s.customerId === c.id && s.status === 'CONFIRMED');
  const totalSales = sales.reduce((n, s) => n + s.totalCents, 0);
  const totalPaid = sales.reduce((n, s) => n + s.paidCents, 0);
  const last = sales.map((s) => s.date).sort().pop() ?? null;
  return {
    ...shapeCustomer(c),
    _count: { sales: sales.length, customerPayments: db().payments.filter((p) => sales.some((s) => s.id === p.saleId)).length },
    totalSalesAmount: totalSales, totalPaid,
    outstandingBalance: totalSales - totalPaid,
    grossOutstandingCents: totalSales - totalPaid,
    derivedBalance: totalSales - totalPaid,
    lastPurchaseDate: last, creditUsedCents: creditBalanceOf(c.id),
    updatedAt: db().seededAt,
    sales: sales.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25).map((s) => shapeSale(s, false)),
  };
};

export const createCustomer: DemoHandler = ({ body }) => {
  const d = db();
  const name = String(body?.name ?? '').trim();
  if (!name) throw new DemoHttpError(400, 'Name is required');
  const c = {
    id: nextId('cus'), name, phone: String(body?.phone ?? ''), email: body?.email ?? null,
    address: body?.address ?? null, isActive: true,
    creditEnabled: !!body?.creditEnabled, creditLimitCents: Number(body?.creditLimitCents ?? 0),
    creditAlertPct: Number(body?.creditAlertPct ?? 80), creditSettleDays: Number(body?.creditSettleDays ?? 30),
    openingBalanceCents: Number(body?.openingBalanceCents ?? 0),
  };
  d.customers.push(c);
  return shapeCustomer(c);
};

export const updateCustomer: DemoHandler = ({ params, body }) => {
  const c = db().customers.find((x) => x.id === params.id);
  if (!c) throw new DemoHttpError(404, 'Customer not found');
  Object.assign(c, body ?? {});
  return shapeCustomer(c);
};

export const toggleCustomer: DemoHandler = ({ params }) => {
  const c = db().customers.find((x) => x.id === params.id);
  if (!c) throw new DemoHttpError(404, 'Customer not found');
  c.isActive = !c.isActive;
  return shapeCustomer(c);
};

// ─── Customer payments ───────────────────────────────────────────────────────

export const listCustomerPayments: DemoHandler = ({ query }) => {
  let rows = db().payments.filter((p) => p.saleId);
  if (query.customerId) {
    const ids = new Set(db().sales.filter((s) => s.customerId === query.customerId).map((s) => s.id));
    rows = rows.filter((p) => ids.has(p.saleId!));
  }
  rows = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const shaped = rows.map((p) => {
    const sale = db().sales.find((s) => s.id === p.saleId);
    return {
      id: p.id, amountCents: p.amountCents, method: p.method, date: p.date, note: p.note,
      sale: sale ? { id: sale.id, number: sale.number } : null,
      customer: customerById(sale?.customerId ?? null),
      createdBy: userById(p.createdById), createdAt: p.createdAt,
    };
  });
  return paginate(shaped, query);
};

export const paymentsForCustomer: DemoHandler = ({ params }) => {
  const ids = new Set(db().sales.filter((s) => s.customerId === params.id).map((s) => s.id));
  return db().payments
    .filter((p) => p.saleId && ids.has(p.saleId))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((p) => {
      const sale = db().sales.find((s) => s.id === p.saleId);
      return {
        id: p.id, amountCents: p.amountCents, method: p.method, date: p.date, note: p.note,
        sale: sale ? { id: sale.id, number: sale.number } : null,
        createdBy: userById(p.createdById), createdAt: p.createdAt,
      };
    });
};

export const creditLedger: DemoHandler = ({ params }) => {
  const sales = realSales().filter((s) => s.customerId === params.id);
  const rows = sales.map((s) => ({
    id: s.id, date: s.date, type: 'INVOICE', reference: s.number,
    debitCents: s.totalCents, creditCents: s.paidCents,
    balanceCents: s.totalCents - s.paidCents,
  }));
  return { rows, openingBalanceCents: 0, closingBalanceCents: creditBalanceOf(params.id) };
};

export const lumpSumPayment: DemoHandler = ({ body }) => {
  const d = db();
  const customerId = String(body?.customerId ?? '');
  let remaining = Number(body?.amountCents ?? 0);
  if (remaining <= 0) throw new DemoHttpError(400, 'Enter an amount greater than zero.');
  // Oldest invoice first, which is how a counter actually settles an account.
  const open = d.sales
    .filter((s) => s.customerId === customerId && s.status === 'CONFIRMED' && s.paidCents < s.totalCents)
    .sort((a, b) => a.date.localeCompare(b.date));
  const applied: unknown[] = [];
  const now = new Date().toISOString();
  for (const s of open) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, s.totalCents - s.paidCents);
    s.paidCents += take;
    remaining -= take;
    d.payments.push({
      id: nextId('pay'), saleId: s.id, purchaseId: null, amountCents: take,
      method: String(body?.method ?? 'CASH'), date: now, note: 'Account settlement',
      createdById: currentUserId(), createdAt: now,
    });
    applied.push({ saleId: s.id, number: s.number, amountCents: take });
  }
  return { applied, unappliedCents: remaining };
};
