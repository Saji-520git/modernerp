import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DailyRevenue {
  day: Date;
  revenue: bigint;
  orders: bigint;
}

interface TopProduct {
  productId: string;
  name: string;
  revenue: bigint;
  qty: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// ─── Dashboard service ────────────────────────────────────────────────────────

export const dashboardService = {

  // ── KPI cards ──────────────────────────────────────────────────────────────

  kpis: async () => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const monthStart = startOfMonth(now);

    // Yesterday for trend calculation
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const lastMonthStart = new Date(monthStart);
    lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
    const lastMonthEnd = new Date(monthStart);

    const [
      todaySales,
      yesterdaySales,
      monthSales,
      lastMonthSales,
      todayOrderCount,
      pendingOrders,
      openPOs,
      lowStockCount,
      activeUsers,
    ] = await prisma.$transaction([
      // Today revenue (confirmed sales)
      prisma.sale.aggregate({
        where: { status: 'CONFIRMED', date: { gte: todayStart } },
        _sum: { totalCents: true },
        _count: true,
      }),
      // Yesterday revenue
      prisma.sale.aggregate({
        where: { status: 'CONFIRMED', date: { gte: yesterdayStart, lt: todayStart } },
        _sum: { totalCents: true },
      }),
      // This month revenue
      prisma.sale.aggregate({
        where: { status: 'CONFIRMED', date: { gte: monthStart } },
        _sum: { totalCents: true },
        _count: true,
      }),
      // Last month revenue
      prisma.sale.aggregate({
        where: { status: 'CONFIRMED', date: { gte: lastMonthStart, lt: lastMonthEnd } },
        _sum: { totalCents: true },
      }),
      // Today's confirmed order count (all types)
      prisma.sale.count({
        where: { status: 'CONFIRMED', date: { gte: todayStart } },
      }),
      // Pending (draft) sales
      prisma.sale.count({ where: { status: 'DRAFT' } }),
      // Open purchase orders
      prisma.purchase.count({ where: { status: 'DRAFT' } }),
      // Low stock: products where total stock <= reorderLevel
      prisma.product.count({
        where: {
          isActive: true,
          reorderLevel: { gt: 0 },
          stock: {
            some: {},
          },
        },
      }),
      // Active users
      prisma.user.count({ where: { isActive: true } }),
    ]);

    // Actually count low stock properly via raw query
    const lowStockResult = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT p.id)::bigint as count
      FROM "Product" p
      JOIN "Stock" s ON s."productId" = p.id
      WHERE p."isActive" = true
        AND p."reorderLevel" > 0
      GROUP BY p.id
      HAVING SUM(s.qty) <= (SELECT "reorderLevel" FROM "Product" WHERE id = p.id)
    `;
    const actualLowStock = Number(lowStockResult[0]?.count ?? 0);

    // Sales returns reduce net revenue (v1.0.54). SaleReturn has no `date` field,
    // so filter on createdAt. Yesterday is also adjusted so the trend % stays net-vs-net.
    const [todayReturns, yesterdayReturns, monthReturns, lastMonthReturns] = await Promise.all([
      prisma.saleReturn.aggregate({ where: { createdAt: { gte: todayStart } }, _sum: { totalCents: true } }),
      prisma.saleReturn.aggregate({ where: { createdAt: { gte: yesterdayStart, lt: todayStart } }, _sum: { totalCents: true } }),
      prisma.saleReturn.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { totalCents: true } }),
      prisma.saleReturn.aggregate({ where: { createdAt: { gte: lastMonthStart, lt: lastMonthEnd } }, _sum: { totalCents: true } }),
    ]);

    const todayRevenue = Math.max(0, (todaySales._sum.totalCents ?? 0) - (todayReturns._sum.totalCents ?? 0));
    const yesterdayRevenue = Math.max(0, (yesterdaySales._sum.totalCents ?? 0) - (yesterdayReturns._sum.totalCents ?? 0));
    const monthRevenue = Math.max(0, (monthSales._sum.totalCents ?? 0) - (monthReturns._sum.totalCents ?? 0));
    const lastMonthRevenue = Math.max(0, (lastMonthSales._sum.totalCents ?? 0) - (lastMonthReturns._sum.totalCents ?? 0));

    const pctChange = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    // Outstanding receivables: confirmed sales where paidCents < totalCents
    const receivablesResult = await prisma.sale.aggregate({
      where: { status: 'CONFIRMED' },
      _sum: { totalCents: true, paidCents: true },
    });
    const totalSaleCents = receivablesResult._sum.totalCents ?? 0;
    const totalPaidCents = receivablesResult._sum.paidCents ?? 0;
    // Approximation (v1.0.54): subtract ALL sales returns from total outstanding.
    // A per-sale returns join would be exact but costly across all confirmed sales;
    // this may slightly under-state receivables when returns occurred on already-paid invoices.
    const allReturnsAgg = await prisma.saleReturn.aggregate({ _sum: { totalCents: true } });
    const totalReturnedCents = allReturnsAgg._sum.totalCents ?? 0;
    const unpaidCents = Math.max(0, totalSaleCents - totalPaidCents - totalReturnedCents);

    // Month purchases (confirmed POs)
    const monthPurchasesResult = await prisma.purchase.aggregate({
      where: { status: 'CONFIRMED', date: { gte: monthStart } },
      _sum: { totalCents: true },
      _count: true,
    });

    // Inventory value (sum of qty * costCents across all active products)
    const invValueResult = await prisma.$queryRaw<[{ value: bigint }]>`
      SELECT COALESCE(SUM(s.qty * p."costCents"), 0)::bigint AS value
      FROM "Stock" s
      JOIN "Product" p ON p.id = s."productId"
      WHERE p."isActive" = true AND s.qty > 0
    `;
    const inventoryValueCents = Number(invValueResult[0]?.value ?? 0);

    return {
      todayRevenueCents: todayRevenue,
      monthRevenueCents: monthRevenue,
      todayOrders: todayOrderCount,
      monthOrders: monthSales._count,
      pendingOrders,
      openPOs,
      lowStockCount: actualLowStock,
      activeUsers,
      unpaidCents,
      monthPurchasesCents: monthPurchasesResult._sum.totalCents ?? 0,
      monthPurchaseCount: monthPurchasesResult._count,
      inventoryValueCents,
      trends: {
        todayRevenue: pctChange(todayRevenue, yesterdayRevenue),
        monthRevenue: pctChange(monthRevenue, lastMonthRevenue),
      },
    };
  },

  // ── Daily revenue chart (last 14 days) ─────────────────────────────────────

  revenueChart: async (days: 30 | 60 | 90 = 30) => {
    const interval = `${days} days`;

    const [salesRows, expenseRows] = await Promise.all([
      prisma.$queryRaw<DailyRevenue[]>`
        SELECT
          DATE_TRUNC('day', date)::date AS day,
          COALESCE(SUM("totalCents"), 0)::bigint AS revenue,
          COUNT(*)::bigint AS orders
        FROM "Sale"
        WHERE status = 'CONFIRMED'
          AND "deletedAt" IS NULL
          AND date >= NOW() - INTERVAL '1 day' * ${days}
        GROUP BY DATE_TRUNC('day', date)
        ORDER BY day ASC
      `,
      prisma.$queryRaw<{ day: Date; total: bigint }[]>`
        SELECT DATE_TRUNC('day', date)::date AS day,
          COALESCE(SUM(amount), 0)::bigint AS total
        FROM "expenses"
        WHERE "isRecurring" = false
          AND "deletedAt" IS NULL
          AND date >= NOW() - INTERVAL '1 day' * ${days}
        GROUP BY DATE_TRUNC('day', date)
        ORDER BY day ASC
      `,
    ]);

    const salesMap = new Map<string, { revenue: number; orders: number }>();
    for (const row of salesRows) {
      const key = new Date(row.day).toISOString().slice(0, 10);
      salesMap.set(key, { revenue: Number(row.revenue), orders: Number(row.orders) });
    }
    const expMap = new Map<string, number>();
    for (const row of expenseRows) {
      expMap.set(new Date(row.day).toISOString().slice(0, 10), Number(row.total));
    }

    const result: { date: string; revenue: number; orders: number; expensesCents: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      result.push({
        date:          key,
        revenue:       salesMap.get(key)?.revenue ?? 0,
        orders:        salesMap.get(key)?.orders  ?? 0,
        expensesCents: expMap.get(key) ?? 0,
      });
    }

    return result;
  },

  // ── Top 5 products by revenue this month ───────────────────────────────────

  topProducts: async () => {
    const monthStart = startOfMonth(new Date());

    const rows = await prisma.$queryRaw<TopProduct[]>`
      SELECT
        p.id AS "productId",
        p.name,
        SUM(sl."lineTotalCents")::bigint AS revenue,
        SUM(sl.qty)::float AS qty
      FROM "SaleLine" sl
      JOIN "Product" p ON p.id = sl."productId"
      JOIN "Sale" s ON s.id = sl."saleId"
      WHERE s.status = 'CONFIRMED'
        AND s.date >= ${monthStart}
      GROUP BY p.id, p.name
      ORDER BY revenue DESC
      LIMIT 5
    `;

    return rows.map((r) => ({
      productId: r.productId,
      name: r.name,
      revenueCents: Number(r.revenue),
      qty: r.qty,
    }));
  },

  // ── Recent 5 confirmed sales ────────────────────────────────────────────────

  recentSales: async () => {
    return prisma.sale.findMany({
      where: { status: 'CONFIRMED' },
      orderBy: { date: 'desc' },
      take: 5,
      select: {
        id: true,
        number: true,
        date: true,
        totalCents: true,
        isPos: true,
        paymentMethod: true,
        customer: { select: { name: true } },
        createdBy: { select: { fullName: true } },
      },
    });
  },

  // ── Low stock alerts ────────────────────────────────────────────────────────

  lowStockAlerts: async () => {
    const rows = await prisma.$queryRaw<
      {
        id: string;
        name: string;
        sku: string;
        reorderLevel: number;
        totalQty: number;
      }[]
    >`
      SELECT
        p.id,
        p.name,
        p.sku,
        p."reorderLevel",
        COALESCE(SUM(s.qty), 0)::float AS "totalQty"
      FROM "Product" p
      LEFT JOIN "Stock" s ON s."productId" = p.id
      WHERE p."isActive" = true AND p."reorderLevel" > 0
      GROUP BY p.id, p.name, p.sku, p."reorderLevel"
      HAVING COALESCE(SUM(s.qty), 0) <= p."reorderLevel"
      ORDER BY (COALESCE(SUM(s.qty), 0) - p."reorderLevel") ASC
      LIMIT 5
    `;

    return rows;
  },

  // ── Module counts ───────────────────────────────────────────────────────────

  counts: async () => {
    const [products, customers, suppliers] = await prisma.$transaction([
      prisma.product.count({ where: { isActive: true } }),
      prisma.customer.count({ where: { isActive: true } }),
      prisma.supplier.count({ where: { isActive: true } }),
    ]);
    return { products, customers, suppliers };
  },

  // ── Full summary (single request) ──────────────────────────────────────────

  summary: async () => {
    const [kpis, revenueChart, topProducts, recentSales, lowStockAlerts, counts] =
      await Promise.all([
        dashboardService.kpis(),
        dashboardService.revenueChart(30),
        dashboardService.topProducts(),
        dashboardService.recentSales(),
        dashboardService.lowStockAlerts(),
        dashboardService.counts(),
      ]);

    return { kpis, revenueChart, topProducts, recentSales, lowStockAlerts, counts };
  },
};
