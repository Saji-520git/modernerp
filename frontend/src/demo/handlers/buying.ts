// ─── Purchases, suppliers, expenses, shifts ──────────────────────────────────

import { DemoHttpError, type DemoHandler } from '../http';
import {
  db, paginate, matches, productById, shapePurchase, supplierById, userById,
  unitById, stockQty, applyStock, inLocalRange, warehouseById, ymdOf,
} from '../support';
import { nextId, nextDocNumber, type DemoPurchase, type DemoPurchaseLine } from '../db';

function currentUserId(): string {
  try {
    const raw = localStorage.getItem('modernerp-auth');
    const id = raw ? JSON.parse(raw)?.state?.user?.id : null;
    if (id && db().users.some((u) => u.id === id)) return id;
  } catch { /* fall through */ }
  return db().users[0].id;
}

// ─── Purchases ───────────────────────────────────────────────────────────────

export const listPurchases: DemoHandler = ({ query }) => {
  let rows = [...db().purchases];
  if (query.status) rows = rows.filter((p) => p.status === query.status);
  if (query.supplierId) rows = rows.filter((p) => p.supplierId === query.supplierId);
  if (query.warehouseId) rows = rows.filter((p) => p.warehouseId === query.warehouseId);
  if (query.from || query.to) rows = rows.filter((p) => inLocalRange(p.date, query.from, query.to));
  if (query.search) rows = rows.filter((p) => matches([p.number, supplierById(p.supplierId).name], query.search));
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return paginate(rows.map((p) => shapePurchase(p, false)), query);
};

export const getPurchase: DemoHandler = ({ params }) => {
  const p = db().purchases.find((x) => x.id === params.id);
  if (!p) throw new DemoHttpError(404, 'Purchase order not found');
  return {
    ...shapePurchase(p, true),
    payments: db().payments
      .filter((x) => x.purchaseId === p.id)
      .map((x) => ({
        id: x.id, amountCents: x.amountCents, method: x.method, date: x.date,
        note: x.note, createdBy: userById(x.createdById), createdAt: x.createdAt,
      })),
  };
};

export const purchaseSuppliers: DemoHandler = ({ query }) =>
  db().suppliers
    .filter((s) => s.isActive && matches([s.name, s.phone], query.search))
    .map((s) => ({ id: s.id, name: s.name, phone: s.phone, email: s.email }));

export const purchaseProducts: DemoHandler = ({ query }) => {
  const wh = query.warehouseId || 'wh_main';
  return db().products
    .filter((p) => matches([p.name, p.sku, p.barcode], query.search))
    .slice(0, 200)
    .map((p) => {
      const unit = unitById(p.unitId)!;
      const box = unitById('unit_box');
      return {
        id: p.id, name: p.name, sku: p.sku, barcode: p.barcode,
        costCents: p.costCents, lastCostCents: p.costCents, priceCents: p.priceCents,
        taxPercent: 0, stockQty: stockQty(p.id, wh),
        isBatchTracked: !!p.isBatchTracked,
        unitId: p.unitId, unit: { id: unit.id, name: unit.name, shortCode: unit.shortCode, allowDecimal: unit.allowDecimal },
        baseUnitId: p.unitId,
        baseUnit: { id: unit.id, name: unit.name, shortCode: unit.shortCode, allowDecimal: unit.allowDecimal },
        purchaseUnitId: null, purchaseUnit: null,
        unitConversions: p.boxOf && box
          ? [{
              id: `conv_${p.id}`, fromUnitId: box.id, toUnitId: p.unitId, conversionQty: p.boxOf,
              priceCents: null,
              fromUnit: { id: box.id, name: box.name, shortCode: box.shortCode, allowDecimal: false },
              toUnit: { id: unit.id, name: unit.name, shortCode: unit.shortCode },
            }]
          : [],
      };
    });
};

export const createPurchase: DemoHandler = ({ body }) => {
  const d = db();
  const inputLines = (body?.lines ?? []) as any[];
  if (!inputLines.length) throw new DemoHttpError(400, 'Add at least one line.');
  const lines: DemoPurchaseLine[] = inputLines.map((l, idx) => {
    const p = productById(l.productId);
    if (!p) throw new DemoHttpError(404, 'Product not found');
    const qty = Number(l.qty);
    const cost = Number(l.unitCostCents ?? p.costCents);
    return {
      id: `pl_${idx}_${Date.now().toString(36)}`, productId: p.id, qty, receivedQty: 0,
      unitCostCents: cost, taxPercent: 0, lineTotalCents: qty * cost, unitId: l.unitId ?? p.unitId,
    };
  });
  const subtotal = lines.reduce((n, l) => n + l.lineTotalCents, 0);
  const now = new Date().toISOString();
  const po: DemoPurchase = {
    id: nextId('pur'),
    number: nextDocNumber('PO', d.purchases.map((p) => p.number)),
    supplierId: String(body?.supplierId ?? d.suppliers[0].id),
    warehouseId: String(body?.warehouseId ?? 'wh_main'),
    status: 'DRAFT', deliveryStatus: 'PENDING',
    // The picked day is sent already resolved by the form (ymdToTransactionISO).
    date: body?.date ? String(body.date) : now,
    expectedDate: body?.expectedDate ?? null, note: body?.note ?? null,
    subtotalCents: subtotal, taxCents: 0, totalCents: subtotal, paidCents: 0,
    createdById: currentUserId(), lines, createdAt: now,
  };
  d.purchases.push(po);
  return shapePurchase(po, true);
};

export const updatePurchase: DemoHandler = ({ params, body }) => {
  const po = db().purchases.find((x) => x.id === params.id);
  if (!po) throw new DemoHttpError(404, 'Purchase order not found');
  if (po.status !== 'DRAFT') throw new DemoHttpError(400, 'Only a draft order can be edited.');
  if (body?.supplierId) po.supplierId = String(body.supplierId);
  if (body?.warehouseId) po.warehouseId = String(body.warehouseId);
  if (body?.note !== undefined) po.note = body.note;
  if (body?.lines) {
    po.lines = (body.lines as any[]).map((l, idx) => {
      const p = productById(l.productId)!;
      const qty = Number(l.qty);
      const cost = Number(l.unitCostCents ?? p.costCents);
      return {
        id: `pl_${idx}_${Date.now().toString(36)}`, productId: p.id, qty, receivedQty: 0,
        unitCostCents: cost, taxPercent: 0, lineTotalCents: qty * cost, unitId: l.unitId ?? p.unitId,
      };
    });
    po.subtotalCents = po.lines.reduce((n, l) => n + l.lineTotalCents, 0);
    po.totalCents = po.subtotalCents;
  }
  return shapePurchase(po, true);
};

export const confirmPurchase: DemoHandler = ({ params }) => {
  const po = db().purchases.find((x) => x.id === params.id);
  if (!po) throw new DemoHttpError(404, 'Purchase order not found');
  if (po.status !== 'DRAFT') throw new DemoHttpError(400, 'This order is already confirmed.');
  po.status = 'CONFIRMED';
  po.deliveryStatus = 'COMPLETE';
  for (const l of po.lines) {
    const p = productById(l.productId)!;
    const perBase = l.unitId === 'unit_box' && p.boxOf ? p.boxOf : 1;
    l.receivedQty = l.qty;
    applyStock(l.productId, po.warehouseId, l.qty * perBase, 'PURCHASE_IN', 'PURCHASE', po.id);
  }
  return shapePurchase(po, true);
};

export const cancelPurchase: DemoHandler = ({ params }) => {
  const po = db().purchases.find((x) => x.id === params.id);
  if (!po) throw new DemoHttpError(404, 'Purchase order not found');
  if (po.status === 'CONFIRMED') {
    for (const l of po.lines) {
      const p = productById(l.productId)!;
      const perBase = l.unitId === 'unit_box' && p.boxOf ? p.boxOf : 1;
      applyStock(l.productId, po.warehouseId, -(l.receivedQty * perBase), 'ADJUSTMENT', 'PURCHASE', po.id, 'Order cancelled');
    }
  }
  po.status = 'CANCELLED';
  return shapePurchase(po, true);
};

export const purchaseReceipts: DemoHandler = ({ params }) => {
  const po = db().purchases.find((x) => x.id === params.id);
  if (!po || po.status !== 'CONFIRMED') return [];
  return [{
    id: `grn_${po.id}`,
    number: po.number.replace('PO-', 'GRN-'),
    purchaseId: po.id, receivedAt: po.date,
    receivedBy: userById(po.createdById),
    lines: po.lines.map((l) => ({
      id: `grl_${l.id}`, productId: l.productId, qty: l.receivedQty,
      batchNumber: null, expiryDate: null,
      product: { id: l.productId, name: productById(l.productId)?.name ?? 'Unknown', sku: productById(l.productId)?.sku ?? '—' },
    })),
  }];
};

// ─── Supplier payments ───────────────────────────────────────────────────────

export const supplierPaymentsForPurchase: DemoHandler = ({ params }) =>
  db().payments
    .filter((p) => p.purchaseId === params.id)
    .map((p) => ({
      id: p.id, paymentNumber: `SPAY-${p.id.slice(-4)}`, amountCents: p.amountCents,
      method: p.method, referenceNo: null, bankName: null, paymentDate: p.date,
      note: p.note, createdBy: userById(p.createdById), createdAt: p.createdAt,
    }));

export const createSupplierPayment: DemoHandler = ({ params, body }) => {
  const d = db();
  const po = d.purchases.find((x) => x.id === params.id);
  if (!po) throw new DemoHttpError(404, 'Purchase order not found');
  const amount = Number(body?.amountCents ?? 0);
  if (amount <= 0) throw new DemoHttpError(400, 'Enter an amount greater than zero.');
  const outstanding = po.totalCents - po.paidCents;
  if (amount > outstanding) throw new DemoHttpError(400, `Only Rs. ${(outstanding / 100).toLocaleString()} is outstanding.`);
  po.paidCents += amount;
  const now = new Date().toISOString();
  const pay = {
    id: nextId('pay'), saleId: null, purchaseId: po.id, amountCents: amount,
    method: String(body?.method ?? 'CASH'), date: body?.paymentDate ?? now,
    note: body?.note ?? null, createdById: currentUserId(), createdAt: now,
  };
  d.payments.push(pay);
  return { id: pay.id, paymentNumber: `SPAY-${pay.id.slice(-4)}`, amountCents: amount };
};

export const listSupplierPayments: DemoHandler = ({ query }) => {
  const rows = db().payments
    .filter((p) => p.purchaseId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((p) => {
      const po = db().purchases.find((x) => x.id === p.purchaseId);
      return {
        id: p.id, paymentNumber: `SPAY-${p.id.slice(-4)}`, amountCents: p.amountCents,
        method: p.method, paymentDate: p.date, note: p.note,
        purchase: po ? { id: po.id, number: po.number } : null,
        supplier: po ? supplierById(po.supplierId) : null,
        createdBy: userById(p.createdById), createdAt: p.createdAt,
      };
    });
  return paginate(rows, query);
};

export const paymentsForSupplier: DemoHandler = ({ params }) => {
  const poIds = new Set(db().purchases.filter((p) => p.supplierId === params.id).map((p) => p.id));
  return db().payments
    .filter((p) => p.purchaseId && poIds.has(p.purchaseId))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((p) => {
      const po = db().purchases.find((x) => x.id === p.purchaseId);
      return {
        id: p.id, paymentNumber: `SPAY-${p.id.slice(-4)}`, amountCents: p.amountCents,
        method: p.method, paymentDate: p.date, note: p.note,
        purchase: po ? { id: po.id, number: po.number } : null,
        createdBy: userById(p.createdById), createdAt: p.createdAt,
      };
    });
};

// ─── Suppliers ───────────────────────────────────────────────────────────────

function supplierOutstanding(id: string): number {
  return db().purchases
    .filter((p) => p.supplierId === id && p.status === 'CONFIRMED')
    .reduce((n, p) => n + Math.max(0, p.totalCents - p.paidCents), 0);
}

function shapeSupplier(s: ReturnType<typeof db>['suppliers'][number]) {
  return {
    id: s.id, name: s.name, phone: s.phone, email: s.email, address: s.address,
    isActive: s.isActive, createdAt: db().seededAt,
    openingBalanceCents: s.openingBalanceCents, openingBalanceAsOf: null,
    payableCents: supplierOutstanding(s.id),
    _count: { purchases: db().purchases.filter((p) => p.supplierId === s.id).length },
  };
}

export const listSuppliers: DemoHandler = ({ query }) => {
  let rows = db().suppliers.filter((s) => matches([s.name, s.phone, s.email], query.search));
  if (query.isActive === 'true') rows = rows.filter((s) => s.isActive);
  if (query.isActive === 'false') rows = rows.filter((s) => !s.isActive);
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return paginate(rows.map(shapeSupplier), { ...query, pageSize: query.pageSize ?? '50' });
};

export const getSupplier: DemoHandler = ({ params }) => {
  const s = db().suppliers.find((x) => x.id === params.id);
  if (!s) throw new DemoHttpError(404, 'Supplier not found');
  const pos = db().purchases.filter((p) => p.supplierId === s.id && p.status === 'CONFIRMED');
  const total = pos.reduce((n, p) => n + p.totalCents, 0);
  const paid = pos.reduce((n, p) => n + p.paidCents, 0);
  return {
    ...shapeSupplier(s),
    _count: { purchases: pos.length, supplierPayments: db().payments.filter((p) => pos.some((x) => x.id === p.purchaseId)).length },
    totalPurchaseAmount: total, totalPaid: paid,
    outstandingBalance: total - paid, derivedBalance: total - paid,
    lastPurchaseDate: pos.map((p) => p.date).sort().pop() ?? null,
    updatedAt: db().seededAt,
    purchases: pos.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25).map((p) => shapePurchase(p, false)),
  };
};

export const createSupplier: DemoHandler = ({ body }) => {
  const d = db();
  const name = String(body?.name ?? '').trim();
  if (!name) throw new DemoHttpError(400, 'Name is required');
  const s = {
    id: nextId('sup'), name, phone: String(body?.phone ?? ''),
    email: String(body?.email ?? ''), address: String(body?.address ?? ''),
    isActive: true, openingBalanceCents: Number(body?.openingBalanceCents ?? 0),
  };
  d.suppliers.push(s);
  return shapeSupplier(s);
};

export const updateSupplier: DemoHandler = ({ params, body }) => {
  const s = db().suppliers.find((x) => x.id === params.id);
  if (!s) throw new DemoHttpError(404, 'Supplier not found');
  Object.assign(s, body ?? {});
  return shapeSupplier(s);
};

export const deleteSupplier: DemoHandler = ({ params }) => {
  const d = db();
  const i = d.suppliers.findIndex((x) => x.id === params.id);
  if (i < 0) throw new DemoHttpError(404, 'Supplier not found');
  // A supplier with orders against them is deactivated, not deleted — the same
  // smart delete the real service does, so no purchase order is left orphaned.
  if (d.purchases.some((p) => p.supplierId === params.id)) {
    d.suppliers[i].isActive = false;
    return { success: true, softDeleted: true };
  }
  d.suppliers.splice(i, 1);
  return { success: true, softDeleted: false };
};

export const toggleSupplier: DemoHandler = ({ params }) => {
  const s = db().suppliers.find((x) => x.id === params.id);
  if (!s) throw new DemoHttpError(404, 'Supplier not found');
  s.isActive = !s.isActive;
  return shapeSupplier(s);
};

// ─── Expenses ────────────────────────────────────────────────────────────────

function shapeExpense(e: ReturnType<typeof db>['expenses'][number]) {
  const cat = db().expenseCategories.find((c) => c.id === e.categoryId);
  return {
    id: e.id, amountCents: e.amountCents, date: e.date, description: e.description,
    reference: e.reference, paymentMethod: e.paymentMethod,
    categoryId: e.categoryId,
    category: cat ? { id: cat.id, name: cat.name, color: cat.color } : null,
    isRecurringTemplate: false, isDeleted: false,
    createdBy: userById(e.createdById), createdAt: e.createdAt,
  };
}

export const listExpenses: DemoHandler = ({ query }) => {
  let rows = [...db().expenses];
  if (query.categoryId) rows = rows.filter((e) => e.categoryId === query.categoryId);
  if (query.from || query.to) rows = rows.filter((e) => inLocalRange(e.date, query.from, query.to));
  if (query.search) rows = rows.filter((e) => matches([e.description, e.reference], query.search));
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const shaped = rows.map(shapeExpense);
  return { ...paginate(shaped, query), totalCents: rows.reduce((n, e) => n + e.amountCents, 0) };
};

export const expenseSummary: DemoHandler = ({ query }) => {
  const rows = db().expenses.filter((e) => inLocalRange(e.date, query.from, query.to));
  const byCat = new Map<string, number>();
  for (const e of rows) byCat.set(e.categoryId, (byCat.get(e.categoryId) ?? 0) + e.amountCents);
  return {
    totalCents: rows.reduce((n, e) => n + e.amountCents, 0),
    count: rows.length,
    byCategory: [...byCat.entries()].map(([id, totalCents]) => {
      const c = db().expenseCategories.find((x) => x.id === id);
      return { categoryId: id, name: c?.name ?? 'Other', color: c?.color ?? '#94a3b8', totalCents };
    }).sort((a, b) => b.totalCents - a.totalCents),
  };
};

export const listExpenseCategories: DemoHandler = () =>
  db().expenseCategories.map((c) => ({
    ...c, isActive: true, monthlyBudgetCents: 0,
    _count: { expenses: db().expenses.filter((e) => e.categoryId === c.id).length },
  }));

export const createExpense: DemoHandler = ({ body }) => {
  const d = db();
  const amount = Number(body?.amountCents ?? 0);
  if (amount <= 0) throw new DemoHttpError(400, 'Enter an amount greater than zero.');
  const e = {
    id: nextId('exp'), categoryId: String(body?.categoryId ?? d.expenseCategories[0].id),
    amountCents: amount, date: body?.date ? String(body.date) : new Date().toISOString(),
    description: String(body?.description ?? ''), reference: body?.reference ?? null,
    paymentMethod: String(body?.paymentMethod ?? 'CASH'),
    createdById: currentUserId(), createdAt: new Date().toISOString(),
  };
  d.expenses.push(e);
  return shapeExpense(e);
};

export const updateExpense: DemoHandler = ({ params, body }) => {
  const e = db().expenses.find((x) => x.id === params.id);
  if (!e) throw new DemoHttpError(404, 'Expense not found');
  Object.assign(e, body ?? {});
  return shapeExpense(e);
};

export const deleteExpense: DemoHandler = ({ params }) => {
  const d = db();
  const i = d.expenses.findIndex((x) => x.id === params.id);
  if (i < 0) throw new DemoHttpError(404, 'Expense not found');
  d.expenses.splice(i, 1);
  return { success: true };
};

export const createExpenseCategory: DemoHandler = ({ body }) => {
  const d = db();
  const c = {
    id: nextId('exc'), name: String(body?.name ?? '').trim(),
    color: String(body?.color ?? '#94a3b8'),
  };
  if (!c.name) throw new DemoHttpError(400, 'Name is required');
  d.expenseCategories.push(c);
  return { ...c, isActive: true, monthlyBudgetCents: 0, _count: { expenses: 0 } };
};

export const listRecurring: DemoHandler = () => [];

export const updateExpenseCategory: DemoHandler = ({ params, body }) => {
  const c = db().expenseCategories.find((x) => x.id === params.id);
  if (!c) throw new DemoHttpError(404, 'Category not found');
  if (body?.name) c.name = String(body.name);
  if (body?.color) c.color = String(body.color);
  return { ...c, isActive: true, monthlyBudgetCents: 0 };
};

export const deleteExpenseCategory: DemoHandler = ({ params }) => {
  const d = db();
  const i = d.expenseCategories.findIndex((x) => x.id === params.id);
  if (i < 0) throw new DemoHttpError(404, 'Category not found');
  if (d.expenses.some((e) => e.categoryId === params.id)) {
    throw new DemoHttpError(409, 'This category has expenses against it — reassign them first.');
  }
  d.expenseCategories.splice(i, 1);
  return { success: true };
};

export const deleteRecurring: DemoHandler = () => ({ success: true });

// ─── Supplier payments (the standalone endpoints) ────────────────────────────

export const createSupplierPaymentDirect: DemoHandler = ({ body }) =>
  createSupplierPayment({
    params: { id: String(body?.purchaseId ?? '') },
    query: {}, body, method: 'POST', path: '/supplier-payments',
  });

export const deleteSupplierPayment: DemoHandler = ({ params }) => {
  const d = db();
  const i = d.payments.findIndex((p) => p.id === params.id);
  if (i < 0) throw new DemoHttpError(404, 'Payment not found');
  const pay = d.payments[i];
  // Reversing a payment must put the balance back on the order.
  const po = d.purchases.find((x) => x.id === pay.purchaseId);
  if (po) po.paidCents = Math.max(0, po.paidCents - pay.amountCents);
  d.payments.splice(i, 1);
  return { success: true };
};

export const supplierPaymentVoucher: DemoHandler = ({ params }) => {
  const p = db().payments.find((x) => x.id === params.id);
  if (!p) throw new DemoHttpError(404, 'Payment not found');
  const po = db().purchases.find((x) => x.id === p.purchaseId);
  return {
    id: p.id, paymentNumber: `SPAY-${p.id.slice(-6).toUpperCase()}`,
    amountCents: p.amountCents, method: p.method, paymentDate: p.date, note: p.note,
    purchase: po ? { id: po.id, number: po.number, totalCents: po.totalCents, paidCents: po.paidCents } : null,
    supplier: po ? supplierById(po.supplierId) : null,
    createdBy: userById(p.createdById),
    settings: db().settings,
  };
};

export const supplierCreditLedger: DemoHandler = ({ params }) => {
  const rows = db().purchases
    .filter((p) => p.supplierId === params.id && p.status === 'CONFIRMED')
    .map((p) => ({
      id: p.id, date: p.date, type: 'PURCHASE', reference: p.number,
      debitCents: p.paidCents, creditCents: p.totalCents,
      balanceCents: p.totalCents - p.paidCents,
    }));
  return { rows, openingBalanceCents: 0, closingBalanceCents: supplierOutstanding(params.id) };
};

export const supplierLumpSum: DemoHandler = ({ body }) => {
  const d = db();
  const supplierId = String(body?.supplierId ?? '');
  let remaining = Number(body?.amountCents ?? 0);
  if (remaining <= 0) throw new DemoHttpError(400, 'Enter an amount greater than zero.');
  // Oldest order first — how an account is actually settled.
  const open = d.purchases
    .filter((p) => p.supplierId === supplierId && p.status === 'CONFIRMED' && p.paidCents < p.totalCents)
    .sort((a, b) => a.date.localeCompare(b.date));
  const allocations: unknown[] = [];
  const now = new Date().toISOString();
  for (const po of open) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, po.totalCents - po.paidCents);
    po.paidCents += take;
    remaining -= take;
    const pay = {
      id: nextId('pay'), saleId: null, purchaseId: po.id, amountCents: take,
      method: String(body?.paymentMethod ?? 'CASH'), date: now,
      note: 'Account settlement', createdById: currentUserId(), createdAt: now,
    };
    d.payments.push(pay);
    allocations.push({
      purchaseId: po.id, purchaseNumber: po.number,
      paymentNumber: `SPAY-${pay.id.slice(-6).toUpperCase()}`, appliedCents: take,
    });
  }
  return {
    allocationGroupId: nextId('alloc'), allocations,
    appliedCents: Number(body?.amountCents ?? 0) - remaining,
    creditAddedCents: remaining,
  };
};

export const supplierApplyCredit: DemoHandler = () => ({
  allocationGroupId: nextId('alloc'), allocations: [],
  appliedCents: 0, creditRemainingCents: 0,
  message: 'No unapplied supplier credit in the demo.',
});

export const supplierCredit: DemoHandler = () => ({ creditCents: 0, entries: [] });

// ─── Shifts ──────────────────────────────────────────────────────────────────

/**
 * Live per-method totals for a shift.
 *
 * Computed from the sales themselves for an OPEN shift rather than read from
 * the snapshot columns — those are only written AT close, which was CLAUDE.md
 * issue 23 (a shift that had taken Rs. 800 displayed Rs. 300).
 */
function shiftTotals(shift: ReturnType<typeof db>['shifts'][number]) {
  const from = Date.parse(shift.openedAt);
  const to = shift.closedAt ? Date.parse(shift.closedAt) : Date.now();
  const sales = db().sales.filter((s) => {
    if (!s.isPos || s.status !== 'CONFIRMED') return false;
    if (s.warehouseId !== shift.warehouseId) return false;
    const t = Date.parse(s.date);
    return t >= from && t <= to;
  });
  const sum = (m: string) => sales.filter((s) => s.paymentMethod === m).reduce((n, s) => n + s.totalCents, 0);
  const cash = sum('CASH');
  const card = sum('CARD');
  const bank = sum('BANK_TRANSFER');
  const qr = sum('QR_PAY');
  const credit = sum('CREDIT');
  return {
    cashSalesCents: cash, cardSalesCents: card, bankTransferCents: bank,
    qrPayCents: qr, creditSalesCents: credit,
    totalSalesCents: cash + card + bank + qr + credit,
    saleCount: sales.length,
  };
}

function shapeShift(s: ReturnType<typeof db>['shifts'][number]) {
  const t = shiftTotals(s);
  return {
    id: s.id, userId: s.userId, user: userById(s.userId),
    warehouseId: s.warehouseId, warehouse: warehouseById(s.warehouseId),
    status: s.status, openedAt: s.openedAt, closedAt: s.closedAt,
    openingCashCents: s.openingCashCents, closingCashCents: s.closingCashCents,
    ...t,
    expectedCashCents: s.status === 'CLOSED' ? s.expectedCashCents : s.openingCashCents + t.cashSalesCents - s.cashPayoutsCents,
    varianceCents: s.varianceCents, note: s.note, forceClosedBy: null,
  };
}

export const listShifts: DemoHandler = ({ query }) => {
  let rows = [...db().shifts];
  if (query.status) rows = rows.filter((s) => s.status === query.status);
  if (query.userId) rows = rows.filter((s) => s.userId === query.userId);
  if (query.warehouseId) rows = rows.filter((s) => s.warehouseId === query.warehouseId);
  if (query.from || query.to) rows = rows.filter((s) => inLocalRange(s.openedAt, query.from, query.to));
  rows.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  return paginate(rows.map(shapeShift), query);
};

export const currentShift: DemoHandler = ({ query }) => {
  const s = db().shifts.find((x) => x.status === 'OPEN' && (!query.warehouseId || x.warehouseId === query.warehouseId));
  return s ? shapeShift(s) : null;
};

export const getShift: DemoHandler = ({ params }) => {
  const s = db().shifts.find((x) => x.id === params.id);
  if (!s) throw new DemoHttpError(404, 'Shift not found');
  const from = Date.parse(s.openedAt);
  const to = s.closedAt ? Date.parse(s.closedAt) : Date.now();
  const sales = db().sales
    .filter((x) => x.isPos && x.status === 'CONFIRMED' && Date.parse(x.date) >= from && Date.parse(x.date) <= to)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((x) => ({
      id: x.id, number: x.number, totalCents: x.totalCents, paymentMethod: x.paymentMethod,
      createdAt: x.date, customer: x.customerId ? { name: db().customers.find((c) => c.id === x.customerId)?.name ?? '' } : null,
    }));
  return { ...shapeShift(s), sales };
};

export const shiftPreview: DemoHandler = ({ params }) => {
  const s = db().shifts.find((x) => x.id === params.id);
  if (!s) throw new DemoHttpError(404, 'Shift not found');
  const t = shiftTotals(s);
  return {
    shiftId: s.id, openingCashCents: s.openingCashCents,
    ...t,
    splitCashCents: 0, cashSettlementsCents: 0, cashRefundsCents: 0,
    expectedCashCents: s.openingCashCents + t.cashSalesCents - s.cashPayoutsCents,
  };
};

export const openShift: DemoHandler = ({ body }) => {
  const d = db();
  const warehouseId = String(body?.warehouseId ?? 'wh_main');
  if (d.shifts.some((s) => s.status === 'OPEN' && s.warehouseId === warehouseId)) {
    throw new DemoHttpError(400, 'A shift is already open at this warehouse.');
  }
  const s = {
    id: nextId('shf'), userId: currentUserId(), warehouseId,
    openedAt: new Date().toISOString(), closedAt: null,
    openingCashCents: Number(body?.openingCash ?? 0),
    closingCashCents: null, expectedCashCents: null, varianceCents: null,
    cashPayoutsCents: 0, status: 'OPEN' as const, note: null,
  };
  d.shifts.push(s);
  return shapeShift(s);
};

export const closeShift: DemoHandler = ({ body }) => {
  const d = db();
  const s = d.shifts.find((x) => x.id === body?.shiftId);
  if (!s) throw new DemoHttpError(404, 'Shift not found');
  if (s.status === 'CLOSED') throw new DemoHttpError(400, 'That shift is already closed.');
  const t = shiftTotals(s);
  const expected = s.openingCashCents + t.cashSalesCents - s.cashPayoutsCents;
  const closing = Number(body?.closingCash ?? 0);
  s.status = 'CLOSED';
  s.closedAt = new Date().toISOString();
  s.closingCashCents = closing;
  s.expectedCashCents = expected;
  s.varianceCents = closing - expected;
  s.note = body?.note ?? null;
  return shapeShift(s);
};

export const forceCloseShift: DemoHandler = ({ params, body }) => {
  const s = db().shifts.find((x) => x.id === params.id);
  if (!s) throw new DemoHttpError(404, 'Shift not found');
  const t = shiftTotals(s);
  s.status = 'CLOSED';
  s.closedAt = new Date().toISOString();
  s.closingCashCents = s.openingCashCents + t.cashSalesCents;
  s.expectedCashCents = s.closingCashCents;
  s.varianceCents = 0;
  s.note = body?.note ?? 'Force-closed';
  return shapeShift(s);
};

// ─── Purchase returns ────────────────────────────────────────────────────────

export const deletePurchase: DemoHandler = ({ params }) => {
  const d = db();
  const i = d.purchases.findIndex((x) => x.id === params.id);
  if (i < 0) throw new DemoHttpError(404, 'Purchase order not found');
  if (d.purchases[i].status !== 'DRAFT') {
    throw new DemoHttpError(400, 'A confirmed order cannot be deleted — cancel it instead.');
  }
  d.purchases.splice(i, 1);
  return { success: true };
};

/** Receive stock against a PO (the GRN). Partial deliveries are the point. */
export const receivePurchase: DemoHandler = ({ params, body }) => {
  const d = db();
  const po = d.purchases.find((x) => x.id === params.id);
  if (!po) throw new DemoHttpError(404, 'Purchase order not found');
  if (po.status === 'CANCELLED') throw new DemoHttpError(400, 'This order was cancelled.');

  const inputLines = (body?.lines ?? []) as any[];
  if (!inputLines.length) throw new DemoHttpError(400, 'Enter a quantity to receive.');

  let received = 0;
  for (const il of inputLines) {
    const line = po.lines.find((l) => l.id === il.purchaseLineId || l.productId === il.productId);
    if (!line) continue;
    const qty = Number(il.qty ?? 0);
    if (qty <= 0) continue;
    const outstanding = line.qty - line.receivedQty;
    if (qty > outstanding) {
      const prod = productById(line.productId);
      throw new DemoHttpError(400, `Only ${outstanding} of ${prod?.name ?? 'that line'} is still outstanding.`);
    }
    const p = productById(line.productId)!;
    const perBase = line.unitId === 'unit_box' && p.boxOf ? p.boxOf : 1;
    line.receivedQty += qty;
    received += qty;
    applyStock(line.productId, po.warehouseId, qty * perBase, 'PURCHASE_IN', 'PURCHASE', po.id);

    if (p.isBatchTracked) {
      d.batches.push({
        id: nextId('bat'), productId: p.id, warehouseId: po.warehouseId, qty: qty * perBase,
        unitCostCents: line.unitCostCents,
        batchNumber: il.batchNumber ?? `B${Date.now().toString(36).toUpperCase()}`,
        expiryDate: il.expiryDate ?? null, receivedAt: new Date().toISOString(),
      });
    }
  }
  if (!received) throw new DemoHttpError(400, 'Nothing to receive.');

  const fully = po.lines.every((l) => l.receivedQty >= l.qty);
  po.deliveryStatus = fully ? 'COMPLETE' : 'PARTIAL';
  if (po.status === 'DRAFT') po.status = 'CONFIRMED';

  return {
    id: nextId('grn'),
    number: po.number.replace('PO-', 'GRN-'),
    purchaseId: po.id, receivedAt: new Date().toISOString(),
    receivedBy: userById(currentUserId()),
    deliveryStatus: po.deliveryStatus,
  };
};

/** Close a short-delivered PO: stop waiting for the balance. */
export const closePurchaseShort: DemoHandler = ({ params }) => {
  const po = db().purchases.find((x) => x.id === params.id);
  if (!po) throw new DemoHttpError(404, 'Purchase order not found');
  po.deliveryStatus = 'COMPLETE';
  return shapePurchase(po, true);
};

export const getPurchaseReceipt: DemoHandler = ({ params }) => {
  const po = db().purchases.find((x) => `grn_${x.id}` === params.id || x.id === params.id);
  if (!po) throw new DemoHttpError(404, 'Receipt not found');
  return {
    id: `grn_${po.id}`, number: po.number.replace('PO-', 'GRN-'),
    purchaseId: po.id, receivedAt: po.date, receivedBy: userById(po.createdById),
    purchase: { id: po.id, number: po.number },
    supplier: supplierById(po.supplierId),
    warehouse: warehouseById(po.warehouseId),
    lines: po.lines.map((l) => ({
      id: `grl_${l.id}`, productId: l.productId, qty: l.receivedQty,
      batchNumber: null, expiryDate: null,
      product: {
        id: l.productId,
        name: productById(l.productId)?.name ?? 'Unknown',
        sku: productById(l.productId)?.sku ?? '—',
      },
    })),
  };
};

/** Raise a DRAFT purchase order straight from the low-stock alerts. */
export const purchaseFromAlerts: DemoHandler = ({ body }) => {
  const d = db();
  const ids: string[] = body?.productIds ?? (body?.items ?? []).map((i: any) => i.productId);
  if (!ids?.length) throw new DemoHttpError(400, 'Pick at least one product.');

  const lines: DemoPurchaseLine[] = ids.map((pid, idx) => {
    const p = productById(pid);
    if (!p) throw new DemoHttpError(404, 'Product not found');
    // Order back up to the reorder quantity — what the alert is actually asking for.
    const qty = Math.max(1, p.reorderQty || Math.max(1, p.reorderLevel * 2));
    return {
      id: `pl_${idx}_${Date.now().toString(36)}`, productId: p.id, qty, receivedQty: 0,
      unitCostCents: p.costCents, taxPercent: 0, lineTotalCents: qty * p.costCents, unitId: p.unitId,
    };
  });
  const subtotal = lines.reduce((n, l) => n + l.lineTotalCents, 0);
  const now = new Date().toISOString();
  const po: DemoPurchase = {
    id: nextId('pur'),
    number: nextDocNumber('PO', d.purchases.map((x) => x.number)),
    supplierId: String(body?.supplierId ?? d.suppliers[0].id),
    warehouseId: String(body?.warehouseId ?? 'wh_main'),
    status: 'DRAFT', deliveryStatus: 'PENDING',
    date: now, expectedDate: null, note: 'Raised from low-stock alerts',
    subtotalCents: subtotal, taxCents: 0, totalCents: subtotal, paidCents: 0,
    createdById: currentUserId(), lines, createdAt: now,
  };
  d.purchases.push(po);
  return shapePurchase(po, true);
};

// ─── Purchase returns (debit notes) ──────────────────────────────────────────
//
// purchaseReturnsApi.list() returns a bare array, not a paginated envelope —
// handing it `{ data: [] }` made the page call .filter on an object and crash.

export const listPurchaseReturns: DemoHandler = ({ query }) => {
  let rows = [...db().purchaseReturns];
  if (query.purchaseId) rows = rows.filter((r) => r.purchaseId === query.purchaseId);
  if (query.supplierId) rows = rows.filter((r) => r.supplierId === query.supplierId);
  return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
};

export const getPurchaseReturn: DemoHandler = ({ params }) => {
  const r = db().purchaseReturns.find((x) => x.id === params.id);
  if (!r) throw new DemoHttpError(404, 'Debit note not found');
  return r;
};

export const createPurchaseReturn: DemoHandler = ({ body }) => {
  const d = db();
  const po = d.purchases.find((x) => x.id === body?.purchaseId);
  if (!po) throw new DemoHttpError(404, 'Purchase order not found');
  const inputLines = (body?.lines ?? []) as any[];
  if (!inputLines.length) throw new DemoHttpError(400, 'Pick at least one line to return.');

  const lines = inputLines.map((il, idx) => {
    const pl = po.lines.find((l) => l.id === il.purchaseLineId);
    if (!pl) throw new DemoHttpError(400, 'That line is not on this order.');
    const qty = Number(il.qty);
    if (qty <= 0 || qty > pl.receivedQty) {
      throw new DemoHttpError(400, `Only ${pl.receivedQty} of that line was received.`);
    }
    const p = productById(pl.productId);
    return {
      id: `prl_${idx}`, purchaseLineId: pl.id, productId: pl.productId, qty,
      unitCostCents: pl.unitCostCents, lineTotalCents: qty * pl.unitCostCents,
      product: { id: pl.productId, name: p?.name ?? 'Unknown', sku: p?.sku ?? '—' },
      purchaseLine: { id: pl.id, qty: pl.qty, receivedQty: pl.receivedQty, returnedQty: qty },
    };
  });

  const now = new Date().toISOString();
  const ret = {
    id: nextId('pret'),
    number: nextDocNumber('PRT', d.purchaseReturns.map((x) => String(x.number))),
    purchaseId: po.id, supplierId: po.supplierId, warehouseId: po.warehouseId,
    status: 'DRAFT', reason: body?.reason ?? null,
    totalCents: lines.reduce((n, l) => n + l.lineTotalCents, 0),
    isActive: true, createdAt: now, updatedAt: now,
    purchase: { id: po.id, number: po.number },
    supplier: supplierById(po.supplierId),
    warehouse: warehouseById(po.warehouseId),
    createdBy: userById(currentUserId()),
    lines,
  };
  d.purchaseReturns.push(ret);
  return ret;
};

export const confirmPurchaseReturn: DemoHandler = ({ params }) => {
  const r = db().purchaseReturns.find((x) => x.id === params.id);
  if (!r) throw new DemoHttpError(404, 'Debit note not found');
  if (r.status === 'CONFIRMED') throw new DemoHttpError(400, 'This debit note is already confirmed.');
  // The goods go back to the supplier, so stock leaves us.
  for (const l of r.lines) {
    applyStock(l.productId, r.warehouseId, -l.qty, 'RETURN_OUT', 'PURCHASE_RETURN', r.id, 'Returned to supplier');
  }
  r.status = 'CONFIRMED';
  r.updatedAt = new Date().toISOString();
  return r;
};

export const cancelPurchaseReturn: DemoHandler = ({ params }) => {
  const r = db().purchaseReturns.find((x) => x.id === params.id);
  if (!r) throw new DemoHttpError(404, 'Debit note not found');
  if (r.status === 'CONFIRMED') {
    for (const l of r.lines) {
      applyStock(l.productId, r.warehouseId, l.qty, 'RETURN_IN', 'PURCHASE_RETURN', r.id, 'Debit note cancelled');
    }
  }
  r.status = 'CANCELLED';
  return r;
};

export const deletePurchaseReturn: DemoHandler = ({ params }) => {
  const d = db();
  const i = d.purchaseReturns.findIndex((x) => x.id === params.id);
  if (i < 0) throw new DemoHttpError(404, 'Debit note not found');
  if (d.purchaseReturns[i].status === 'CONFIRMED') {
    throw new DemoHttpError(400, 'A confirmed debit note cannot be deleted — cancel it instead.');
  }
  d.purchaseReturns.splice(i, 1);
  return { success: true };
};

export const purchaseReturnDebitNote: DemoHandler = ({ params }) => {
  const r = db().purchaseReturns.find((x) => x.id === params.id);
  if (!r) throw new DemoHttpError(404, 'Debit note not found');
  return { ...r, settings: db().settings };
};

export const todayShiftYMD = () => ymdOf(new Date().toISOString());
