// ─── Dashboard and reports ───────────────────────────────────────────────────
//
// Every figure here is derived from the same store the rest of the demo writes
// to, so a sale rung up on the POS moves the dashboard and the reports the way
// it would in the real system.

import { type DemoHandler } from '../http';
import {
  db, productById, customerById, userById, warehouseById, totalStock,
  inLocalRange, ymdOf, realSales, cogsOf, supplierById,
} from '../support';
import { toLocalYMD } from '../../utils/local-date';

const dayKey = (d: Date) => toLocalYMD(d);

function daysBack(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    out.push(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  }
  return out;
}

function expensesOn(ymd: string): number {
  return db().expenses.filter((e) => ymdOf(e.date) === ymd).reduce((n, e) => n + e.amountCents, 0);
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export const dashboardSummary: DemoHandler = () => {
  const d = db();
  const sales = realSales();
  const today = dayKey(new Date());
  const now = new Date();
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const monthStart = dayKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const lastMonthStart = dayKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const lastMonthEnd = dayKey(new Date(now.getFullYear(), now.getMonth(), 0));

  const onDay = (ymd: string) => sales.filter((s) => ymdOf(s.date) === ymd);
  const inRange = (from: string, to: string) => sales.filter((s) => inLocalRange(s.date, from, to));

  const todaySales = onDay(today);
  const yesterdaySales = onDay(yesterday);
  const monthSales = inRange(monthStart, today);
  const lastMonthSales = inRange(lastMonthStart, lastMonthEnd);

  const sum = (rows: typeof sales) => rows.reduce((n, s) => n + s.totalCents, 0);
  const pct = (cur: number, prev: number) => (prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100));

  const unpaid = sales.reduce((n, s) => n + Math.max(0, s.totalCents - s.paidCents), 0);
  const monthPurchases = d.purchases.filter((p) => p.status === 'CONFIRMED' && inLocalRange(p.date, monthStart, today));
  const inventoryValue = d.stock.reduce((n, s) => n + s.qty * (productById(s.productId)?.costCents ?? 0), 0);

  const lowStockAlerts = d.products
    .filter((p) => totalStock(p.id) <= p.reorderLevel)
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, reorderLevel: p.reorderLevel, totalQty: totalStock(p.id) }))
    .sort((a, b) => a.totalQty - b.totalQty);

  // 14 days of revenue for the dashboard chart.
  const revenueChart = daysBack(14).map((ymd) => {
    const rows = onDay(ymd);
    return {
      date: ymd,
      revenue: sum(rows),
      orders: rows.length,
      expensesCents: expensesOn(ymd),
      cogsCents: rows.reduce((n, s) => n + cogsOf(s), 0),
    };
  });

  const productTotals = new Map<string, { revenueCents: number; qty: number }>();
  for (const s of monthSales) {
    for (const l of s.lines) {
      const cur = productTotals.get(l.productId) ?? { revenueCents: 0, qty: 0 };
      cur.revenueCents += l.lineTotalCents;
      cur.qty += l.qty;
      productTotals.set(l.productId, cur);
    }
  }
  const topProducts = [...productTotals.entries()]
    .map(([productId, v]) => ({ productId, name: productById(productId)?.name ?? 'Unknown', ...v }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 5);

  const recentSales = [...sales]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map((s) => ({
      id: s.id, number: s.number, date: s.date, totalCents: s.totalCents,
      isPos: s.isPos, paymentMethod: s.paymentMethod,
      customer: customerById(s.customerId), createdBy: userById(s.createdById),
    }));

  return {
    kpis: {
      todayRevenueCents: sum(todaySales),
      monthRevenueCents: sum(monthSales),
      todayOrders: todaySales.length,
      monthOrders: monthSales.length,
      pendingOrders: d.sales.filter((s) => s.status === 'DRAFT').length,
      openPOs: d.purchases.filter((p) => p.status === 'DRAFT').length,
      lowStockCount: lowStockAlerts.length,
      activeUsers: d.users.filter((u) => u.isActive).length,
      unpaidCents: unpaid,
      monthPurchasesCents: monthPurchases.reduce((n, p) => n + p.totalCents, 0),
      monthPurchaseCount: monthPurchases.length,
      inventoryValueCents: inventoryValue,
      trends: {
        todayRevenue: pct(sum(todaySales), sum(yesterdaySales)),
        monthRevenue: pct(sum(monthSales), sum(lastMonthSales)),
      },
    },
    revenueChart,
    topProducts,
    recentSales,
    lowStockAlerts: lowStockAlerts.slice(0, 8),
    counts: {
      products: d.products.length,
      customers: d.customers.filter((c) => c.isActive).length,
      suppliers: d.suppliers.filter((s) => s.isActive).length,
    },
  };
};

export const revenueChart: DemoHandler = ({ query }) => {
  const days = Math.max(1, parseInt(query.days ?? '30', 10) || 30);
  const sales = realSales();
  return daysBack(days).map((ymd) => {
    const rows = sales.filter((s) => ymdOf(s.date) === ymd);
    return {
      date: ymd,
      revenue: rows.reduce((n, s) => n + s.totalCents, 0),
      orders: rows.length,
      expensesCents: expensesOn(ymd),
      cogsCents: rows.reduce((n, s) => n + cogsOf(s), 0),
    };
  });
};

// ─── Reports ─────────────────────────────────────────────────────────────────

function periodKey(ymd: string, groupBy?: string): string {
  if (groupBy === 'month') return ymd.slice(0, 7);
  if (groupBy === 'week') {
    const d = new Date(ymd + 'T00:00:00');
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return toLocalYMD(monday);
  }
  return ymd;
}

export const salesReport: DemoHandler = ({ query }) => {
  const { from, to, groupBy } = query;
  let rows = realSales().filter((s) => inLocalRange(s.date, from, to));
  if (query.customerId) rows = rows.filter((s) => s.customerId === query.customerId);
  if (query.warehouseId) rows = rows.filter((s) => s.warehouseId === query.warehouseId);

  const revenue = rows.reduce((n, s) => n + s.totalCents, 0);
  const cogs = rows.reduce((n, s) => n + cogsOf(s), 0);

  // The previous window of the same length, for the period-on-period figure.
  let prevRevenue = 0;
  if (from && to) {
    const f = new Date(from + 'T00:00:00');
    const t = new Date(to + 'T00:00:00');
    const span = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
    const prevTo = toLocalYMD(new Date(f.getFullYear(), f.getMonth(), f.getDate() - 1));
    const prevFrom = toLocalYMD(new Date(f.getFullYear(), f.getMonth(), f.getDate() - span));
    prevRevenue = realSales()
      .filter((s) => inLocalRange(s.date, prevFrom, prevTo))
      .reduce((n, s) => n + s.totalCents, 0);
  }

  const byPeriodMap = new Map<string, { revenueCents: number; orders: number }>();
  for (const s of rows) {
    const k = periodKey(ymdOf(s.date), groupBy);
    const cur = byPeriodMap.get(k) ?? { revenueCents: 0, orders: 0 };
    cur.revenueCents += s.totalCents;
    cur.orders += 1;
    byPeriodMap.set(k, cur);
  }

  const byWarehouseMap = new Map<string, { revenueCents: number; orders: number }>();
  for (const s of rows) {
    const cur = byWarehouseMap.get(s.warehouseId) ?? { revenueCents: 0, orders: 0 };
    cur.revenueCents += s.totalCents;
    cur.orders += 1;
    byWarehouseMap.set(s.warehouseId, cur);
  }

  const byPaymentMap = new Map<string, { count: number; revenueCents: number }>();
  for (const s of rows) {
    const cur = byPaymentMap.get(s.paymentMethod) ?? { count: 0, revenueCents: 0 };
    cur.count += 1;
    cur.revenueCents += s.totalCents;
    byPaymentMap.set(s.paymentMethod, cur);
  }

  const prodMap = new Map<string, { revenueCents: number; qtySold: number; cogsCents: number }>();
  for (const s of rows) {
    for (const l of s.lines) {
      const cur = prodMap.get(l.productId) ?? { revenueCents: 0, qtySold: 0, cogsCents: 0 };
      cur.revenueCents += l.lineTotalCents;
      cur.qtySold += l.qty;
      cur.cogsCents += l.qty * (productById(l.productId)?.costCents ?? 0);
      prodMap.set(l.productId, cur);
    }
  }
  const topProducts = [...prodMap.entries()]
    .map(([productId, v]) => {
      const p = productById(productId);
      const gross = v.revenueCents - v.cogsCents;
      return {
        productId, name: p?.name ?? 'Unknown', sku: p?.sku ?? '—',
        revenueCents: v.revenueCents, qtySold: v.qtySold, cogsCents: v.cogsCents,
        grossProfitCents: gross,
        marginPct: v.revenueCents ? Math.round((gross / v.revenueCents) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 15);

  return {
    summary: {
      totalRevenueCents: revenue,
      totalTaxCents: 0,
      totalDiscountCents: rows.reduce((n, s) => n + s.discountCents, 0),
      totalPaidCents: rows.reduce((n, s) => n + s.paidCents, 0),
      totalCogsCents: cogs,
      orderCount: rows.length,
      avgOrderCents: rows.length ? Math.round(revenue / rows.length) : 0,
      prevPeriodRevenueCents: prevRevenue,
    },
    byPeriod: [...byPeriodMap.entries()].map(([period, v]) => ({ period, ...v })).sort((a, b) => a.period.localeCompare(b.period)),
    byWarehouse: [...byWarehouseMap.entries()].map(([id, v]) => ({ name: warehouseById(id).name, code: warehouseById(id).code, ...v })),
    byPayment: [...byPaymentMap.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.revenueCents - a.revenueCents),
    topProducts,
  };
};

export const purchasesReport: DemoHandler = ({ query }) => {
  let rows = db().purchases.filter((p) => p.status === 'CONFIRMED' && inLocalRange(p.date, query.from, query.to));
  if (query.supplierId) rows = rows.filter((p) => p.supplierId === query.supplierId);
  if (query.warehouseId) rows = rows.filter((p) => p.warehouseId === query.warehouseId);

  const spend = rows.reduce((n, p) => n + p.totalCents, 0);
  const bySupplier = new Map<string, { spendCents: number; poCount: number }>();
  for (const p of rows) {
    const cur = bySupplier.get(p.supplierId) ?? { spendCents: 0, poCount: 0 };
    cur.spendCents += p.totalCents;
    cur.poCount += 1;
    bySupplier.set(p.supplierId, cur);
  }
  const byPeriod = new Map<string, { spendCents: number; poCount: number }>();
  for (const p of rows) {
    const k = ymdOf(p.date).slice(0, 7);
    const cur = byPeriod.get(k) ?? { spendCents: 0, poCount: 0 };
    cur.spendCents += p.totalCents;
    cur.poCount += 1;
    byPeriod.set(k, cur);
  }
  return {
    summary: {
      totalSpendCents: spend,
      poCount: rows.length,
      avgPoCents: rows.length ? Math.round(spend / rows.length) : 0,
      totalItemsReceived: rows.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.receivedQty, 0), 0),
      uniqueSuppliers: bySupplier.size,
      avgLeadTimeDays: 5,
    },
    bySupplier: [...bySupplier.entries()]
      .map(([id, v]) => ({ name: supplierById(id).name, ...v }))
      .sort((a, b) => b.spendCents - a.spendCents),
    byPeriod: [...byPeriod.entries()].map(([period, v]) => ({ period, ...v })).sort((a, b) => a.period.localeCompare(b.period)),
  };
};

export const productsReport: DemoHandler = ({ query }) => {
  let rows = realSales().filter((s) => inLocalRange(s.date, query.from, query.to));
  if (query.warehouseId) rows = rows.filter((s) => s.warehouseId === query.warehouseId);

  const map = new Map<string, { revenueCents: number; qtySold: number; cogsCents: number }>();
  for (const s of rows) {
    for (const l of s.lines) {
      const p = productById(l.productId);
      if (query.categoryId && p?.categoryId !== query.categoryId) continue;
      if (query.brandId && p?.brandId !== query.brandId) continue;
      const cur = map.get(l.productId) ?? { revenueCents: 0, qtySold: 0, cogsCents: 0 };
      cur.revenueCents += l.lineTotalCents;
      cur.qtySold += l.qty;
      cur.cogsCents += l.qty * (p?.costCents ?? 0);
      map.set(l.productId, cur);
    }
  }
  const items = [...map.entries()].map(([productId, v]) => {
    const p = productById(productId);
    const gross = v.revenueCents - v.cogsCents;
    return {
      productId, name: p?.name ?? 'Unknown', sku: p?.sku ?? '—',
      revenueCents: v.revenueCents, qtySold: v.qtySold, cogsCents: v.cogsCents,
      grossProfitCents: gross,
      marginPct: v.revenueCents ? Math.round((gross / v.revenueCents) * 1000) / 10 : 0,
    };
  });
  return {
    topByRevenue: [...items].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 20),
    topByQty: [...items].sort((a, b) => b.qtySold - a.qtySold).slice(0, 20),
  };
};

export const customersReport: DemoHandler = ({ query }) => {
  const rows = realSales().filter((s) => inLocalRange(s.date, query.from, query.to) && s.customerId);
  const map = new Map<string, { totalSpentCents: number; orderCount: number; last: string }>();
  for (const s of rows) {
    const cur = map.get(s.customerId!) ?? { totalSpentCents: 0, orderCount: 0, last: s.date };
    cur.totalSpentCents += s.totalCents;
    cur.orderCount += 1;
    if (s.date > cur.last) cur.last = s.date;
    map.set(s.customerId!, cur);
  }
  return [...map.entries()]
    .map(([customerId, v]) => ({
      customerId, name: customerById(customerId)?.name ?? 'Unknown',
      totalSpentCents: v.totalSpentCents, orderCount: v.orderCount,
      avgOrderCents: Math.round(v.totalSpentCents / v.orderCount),
      lastOrder: v.last,
    }))
    .sort((a, b) => b.totalSpentCents - a.totalSpentCents);
};

export const inventoryReport: DemoHandler = ({ query }) => {
  const d = db();
  const products = d.products.filter((p) => {
    if (query.categoryId && p.categoryId !== query.categoryId) return false;
    if (query.brandId && p.brandId !== query.brandId) return false;
    return true;
  });

  const qtyOf = (id: string) =>
    query.warehouseId
      ? (d.stock.find((s) => s.productId === id && s.warehouseId === query.warehouseId)?.qty ?? 0)
      : totalStock(id);

  const items = products.map((p) => {
    const qty = qtyOf(p.id);
    return {
      productId: p.id, name: p.name, sku: p.sku, barcode: p.barcode,
      totalQty: qty, costCents: p.costCents, lastCostCents: p.costCents, priceCents: p.priceCents,
      reorderLevel: p.reorderLevel, isLowStock: qty <= p.reorderLevel,
      costValueCents: qty * p.costCents,
      saleValueCents: qty * p.priceCents,
      potentialMarginCents: qty * (p.priceCents - p.costCents),
    };
  });

  const lastSaleOf = new Map<string, string>();
  for (const s of realSales()) {
    for (const l of s.lines) {
      const cur = lastSaleOf.get(l.productId);
      if (!cur || s.date > cur) lastSaleOf.set(l.productId, s.date);
    }
  }
  const cutoff = Date.now() - 30 * 86400000;

  return {
    items: items.sort((a, b) => b.costValueCents - a.costValueCents),
    totals: {
      totalCostValueCents: items.reduce((n, i) => n + i.costValueCents, 0),
      totalSaleValueCents: items.reduce((n, i) => n + i.saleValueCents, 0),
      totalMarginCents: items.reduce((n, i) => n + i.potentialMarginCents, 0),
      lowStockCount: items.filter((i) => i.isLowStock).length,
      skuCount: items.length,
    },
    slowMovers: items
      .filter((i) => {
        const last = lastSaleOf.get(i.productId);
        return i.totalQty > 0 && (!last || Date.parse(last) < cutoff);
      })
      .map((i) => ({
        productId: i.productId, name: i.name, sku: i.sku, totalQty: i.totalQty,
        costCents: i.costCents, costValueCents: i.costValueCents,
        lastSaleDate: lastSaleOf.get(i.productId) ?? null,
      }))
      .sort((a, b) => b.costValueCents - a.costValueCents)
      .slice(0, 20),
    lowStockItems: items
      .filter((i) => i.isLowStock)
      .map((i) => ({
        productId: i.productId, name: i.name, sku: i.sku, totalQty: i.totalQty,
        reorderLevel: i.reorderLevel, deficit: Math.max(0, i.reorderLevel - i.totalQty),
        costCents: i.costCents,
      }))
      .sort((a, b) => b.deficit - a.deficit),
  };
};

export const profitLoss: DemoHandler = ({ query }) => {
  const rows = realSales().filter((s) => inLocalRange(s.date, query.from, query.to));
  const revenue = rows.reduce((n, s) => n + s.totalCents, 0);
  const cogs = rows.reduce((n, s) => n + cogsOf(s), 0);
  const gross = revenue - cogs;

  const exp = db().expenses.filter((e) => inLocalRange(e.date, query.from, query.to));
  const totalExpenses = exp.reduce((n, e) => n + e.amountCents, 0);
  const net = gross - totalExpenses;

  const byCat = new Map<string, number>();
  for (const e of exp) byCat.set(e.categoryId, (byCat.get(e.categoryId) ?? 0) + e.amountCents);

  const byPeriodMap = new Map<string, { revenueCents: number; cogsCents: number; expensesCents: number }>();
  for (const s of rows) {
    const k = ymdOf(s.date).slice(0, 7);
    const cur = byPeriodMap.get(k) ?? { revenueCents: 0, cogsCents: 0, expensesCents: 0 };
    cur.revenueCents += s.totalCents;
    cur.cogsCents += cogsOf(s);
    byPeriodMap.set(k, cur);
  }
  for (const e of exp) {
    const k = ymdOf(e.date).slice(0, 7);
    const cur = byPeriodMap.get(k) ?? { revenueCents: 0, cogsCents: 0, expensesCents: 0 };
    cur.expensesCents += e.amountCents;
    byPeriodMap.set(k, cur);
  }

  return {
    summary: {
      revenueCents: revenue, taxCents: 0,
      discountCents: rows.reduce((n, s) => n + s.discountCents, 0),
      cogsCents: cogs, grossProfitCents: gross,
      grossMarginPct: revenue ? Math.round((gross / revenue) * 1000) / 10 : 0,
      orderCount: rows.length,
      totalExpensesCents: totalExpenses,
      netProfitCents: net,
      netMarginPct: revenue ? Math.round((net / revenue) * 1000) / 10 : 0,
    },
    expensesByCategory: [...byCat.entries()]
      .map(([id, totalCents]) => {
        const c = db().expenseCategories.find((x) => x.id === id);
        return { name: c?.name ?? 'Other', color: c?.color ?? '#94a3b8', totalCents };
      })
      .sort((a, b) => b.totalCents - a.totalCents),
    byPeriod: [...byPeriodMap.entries()]
      .map(([period, v]) => {
        const g = v.revenueCents - v.cogsCents;
        const n = g - v.expensesCents;
        return {
          period, revenueCents: v.revenueCents, cogsCents: v.cogsCents,
          grossProfitCents: g,
          grossMarginPct: v.revenueCents ? Math.round((g / v.revenueCents) * 1000) / 10 : 0,
          expensesCents: v.expensesCents, netProfitCents: n,
          netMarginPct: v.revenueCents ? Math.round((n / v.revenueCents) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => a.period.localeCompare(b.period)),
  };
};

export const pnlComparison: DemoHandler = ({ query }) => {
  const from = query.dateFrom ?? query.from;
  const to = query.dateTo ?? query.to;
  const metrics = (f?: string, t?: string) => {
    const rows = realSales().filter((s) => inLocalRange(s.date, f, t));
    const revenue = rows.reduce((n, s) => n + s.totalCents, 0);
    const cogs = rows.reduce((n, s) => n + cogsOf(s), 0);
    const expenses = db().expenses.filter((e) => inLocalRange(e.date, f, t)).reduce((n, e) => n + e.amountCents, 0);
    const gross = revenue - cogs;
    const net = gross - expenses;
    return {
      revenue, cogs, purchaseReturns: 0, grossProfit: gross, expenses, netProfit: net,
      grossMarginPct: revenue ? Math.round((gross / revenue) * 1000) / 10 : 0,
      netMarginPct: revenue ? Math.round((net / revenue) * 1000) / 10 : 0,
    };
  };
  let prevFrom: string | undefined;
  let prevTo: string | undefined;
  if (from && to) {
    const f = new Date(from + 'T00:00:00');
    const t = new Date(to + 'T00:00:00');
    const span = Math.max(1, Math.round((t.getTime() - f.getTime()) / 86400000) + 1);
    prevTo = toLocalYMD(new Date(f.getFullYear(), f.getMonth(), f.getDate() - 1));
    prevFrom = toLocalYMD(new Date(f.getFullYear(), f.getMonth(), f.getDate() - span));
  }
  return { period: { from, to }, current: metrics(from, to), previous: metrics(prevFrom, prevTo) };
};

export const agingReport: DemoHandler = ({ query }) => {
  const d = db();
  const receivable = (query.type ?? 'receivable') === 'receivable';
  const dueDays = Number(d.settings.invoiceDueDays ?? 30);
  const now = Date.now();

  const rows = receivable
    ? realSales()
        .filter((s) => s.totalCents > s.paidCents && s.customerId)
        .map((s) => ({
          id: s.id, number: s.number, date: s.date,
          partyId: s.customerId!, partyName: customerById(s.customerId)?.name ?? 'Unknown',
          outstandingCents: s.totalCents - s.paidCents,
        }))
    : d.purchases
        .filter((p) => p.status === 'CONFIRMED' && p.totalCents > p.paidCents)
        .map((p) => ({
          id: p.id, number: p.number, date: p.date,
          partyId: p.supplierId, partyName: supplierById(p.supplierId).name,
          outstandingCents: p.totalCents - p.paidCents,
        }));

  // Bucketed by days past DUE, not document age — a 30-day invoice raised
  // yesterday is not late (sprint 23).
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  const byParty = new Map<string, { name: string; current: number; d30: number; d60: number; d90: number; d90plus: number; totalCents: number }>();

  for (const r of rows) {
    const due = Date.parse(r.date) + dueDays * 86400000;
    const overdue = Math.floor((now - due) / 86400000);
    const key = overdue <= 0 ? 'current' : overdue <= 30 ? 'd30' : overdue <= 60 ? 'd60' : overdue <= 90 ? 'd90' : 'd90plus';
    buckets[key] += r.outstandingCents;
    const p = byParty.get(r.partyId) ?? { name: r.partyName, current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0, totalCents: 0 };
    p[key] += r.outstandingCents;
    p.totalCents += r.outstandingCents;
    byParty.set(r.partyId, p);
  }

  return {
    type: receivable ? 'receivable' : 'payable',
    asOf: query.asOf ?? toLocalYMD(new Date()),
    buckets,
    totalCents: rows.reduce((n, r) => n + r.outstandingCents, 0),
    rows: [...byParty.entries()]
      .map(([partyId, v]) => ({ partyId, ...v }))
      .sort((a, b) => b.totalCents - a.totalCents),
  };
};

export const dashboardStats: DemoHandler = () => {
  const d = db();
  const sales = realSales();
  const today = toLocalYMD(new Date());
  const todayRows = sales.filter((s) => ymdOf(s.date) === today);

  const recentActivity = [
    ...sales.slice(-12).map((s) => ({
      type: 'SALE' as const,
      refNumber: s.number,
      description: customerById(s.customerId)?.name ?? 'Walk-in customer',
      amountCents: s.totalCents,
      createdAt: s.date,
    })),
    ...d.purchases.slice(-6).map((p) => ({
      type: 'PURCHASE' as const,
      refNumber: p.number,
      description: supplierById(p.supplierId).name,
      amountCents: p.totalCents,
      createdAt: p.date,
    })),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);

  return {
    todaySalesCents: todayRows.reduce((n, s) => n + s.totalCents, 0),
    todaySalesCount: todayRows.length,
    outstandingReceivablesCents: sales.reduce((n, s) => n + Math.max(0, s.totalCents - s.paidCents), 0),
    outstandingPayablesCents: d.purchases
      .filter((p) => p.status === 'CONFIRMED')
      .reduce((n, p) => n + Math.max(0, p.totalCents - p.paidCents), 0),
    lowStockCount: d.products.filter((p) => totalStock(p.id) <= p.reorderLevel).length,
    last7Days: daysBack(7).map((ymd) => {
      const rows = sales.filter((s) => ymdOf(s.date) === ymd);
      return { date: ymd, salesCents: rows.reduce((n, s) => n + s.totalCents, 0), salesCount: rows.length };
    }),
    recentActivity,
  };
};

export const todaySummary: DemoHandler = () => {
  const d = db();
  const today = toLocalYMD(new Date());
  const now = new Date();
  const yesterday = toLocalYMD(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

  const rows = realSales().filter((s) => ymdOf(s.date) === today);
  const revenue = rows.reduce((n, s) => n + s.totalCents, 0);
  const cogs = rows.reduce((n, s) => n + cogsOf(s), 0);
  const gross = revenue - cogs;
  const expenses = d.expenses.filter((e) => ymdOf(e.date) === today).reduce((n, e) => n + e.amountCents, 0);
  const yRevenue = realSales().filter((s) => ymdOf(s.date) === yesterday).reduce((n, s) => n + s.totalCents, 0);

  const byMethod = new Map<string, { count: number; revenueCents: number }>();
  for (const s of rows) {
    const cur = byMethod.get(s.paymentMethod) ?? { count: 0, revenueCents: 0 };
    cur.count += 1;
    cur.revenueCents += s.totalCents;
    byMethod.set(s.paymentMethod, cur);
  }

  const prodMap = new Map<string, { qty: number; revenueCents: number }>();
  for (const s of rows) {
    for (const l of s.lines) {
      const cur = prodMap.get(l.productId) ?? { qty: 0, revenueCents: 0 };
      cur.qty += l.qty;
      cur.revenueCents += l.lineTotalCents;
      prodMap.set(l.productId, cur);
    }
  }

  const hourly: { hour: number; revenueCents: number; orders: number }[] = [];
  for (let h = 8; h <= 18; h++) {
    const inHour = rows.filter((s) => new Date(s.date).getHours() === h);
    hourly.push({ hour: h, revenueCents: inHour.reduce((n, s) => n + s.totalCents, 0), orders: inHour.length });
  }

  const lowStockItems = d.products
    .filter((p) => totalStock(p.id) <= p.reorderLevel)
    .map((p) => ({ name: p.name, sku: p.sku, totalQty: totalStock(p.id), reorderLevel: p.reorderLevel }));

  // One row per PRODUCT, not per batch. A product with two lots close to expiry
  // in two warehouses produced two rows with the same SKU, and TodaySummaryPage
  // keys this list by SKU — React then warned about duplicate keys and could
  // drop one of them. The nearest expiry wins and the quantities are summed.
  const expiringBySku = new Map<string, { name: string; sku: string; expiryDate: string; daysLeft: number; totalQty: number }>();
  for (const p of d.products) {
    if (!p.isBatchTracked) continue;
    for (const b of d.batches.filter((x) => x.productId === p.id && x.qty > 0 && x.expiryDate)) {
      const daysLeft = Math.ceil((Date.parse(b.expiryDate!) - Date.now()) / 86400000);
      if (daysLeft > 60) continue;
      const cur = expiringBySku.get(p.sku);
      if (!cur) {
        expiringBySku.set(p.sku, { name: p.name, sku: p.sku, expiryDate: b.expiryDate!, daysLeft, totalQty: b.qty });
      } else {
        cur.totalQty += b.qty;
        if (daysLeft < cur.daysLeft) {
          cur.daysLeft = daysLeft;
          cur.expiryDate = b.expiryDate!;
        }
      }
    }
  }
  const expiringItems = [...expiringBySku.values()];

  return {
    date: today,
    generatedAt: new Date().toISOString(),
    headline: {
      revenueCents: revenue,
      grossRevenueCents: revenue,
      returnsCents: 0,
      orderCount: rows.length,
      itemsSold: rows.reduce((n, s) => n + s.lines.reduce((m, l) => m + l.qty, 0), 0),
      avgOrderCents: rows.length ? Math.round(revenue / rows.length) : 0,
      cogsCents: cogs,
      grossProfitCents: gross,
      grossMarginPct: revenue ? Math.round((gross / revenue) * 1000) / 10 : 0,
    },
    money: { expensesCents: expenses, netProfitCents: gross - expenses },
    payments: [...byMethod.entries()]
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.revenueCents - a.revenueCents),
    topItems: [...prodMap.entries()]
      .map(([productId, v]) => {
        const p = productById(productId);
        return { productId, name: p?.name ?? 'Unknown', sku: p?.sku ?? '—', qty: v.qty, revenueCents: v.revenueCents };
      })
      .sort((a, b) => b.revenueCents - a.revenueCents)
      .slice(0, 10),
    alerts: {
      lowStockCount: lowStockItems.length,
      lowStockItems: lowStockItems.slice(0, 10),
      expiringCount: expiringItems.length,
      expiringItems: expiringItems.sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 10),
    },
    context: {
      yesterdayRevenueCents: yRevenue,
      revenueVsYesterdayPct: yRevenue === 0 ? null : Math.round(((revenue - yRevenue) / yRevenue) * 100),
      newCustomers: 0,
    },
    hourly,
  };
};
