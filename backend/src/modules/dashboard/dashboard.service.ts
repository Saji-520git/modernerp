import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { toLocalYMD, localOffsetMinutes, localMidnightDaysAgo } from '../../utils/local-date.js';

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
      -- Counted in an OUTER query over the grouped rows. GROUP BY p.id makes
      -- each row one product, so COUNT(DISTINCT p.id) inside it is 1 on every
      -- row — and the caller reads [0].count. The KPI could therefore only ever
      -- report 1 or 0, however many products were low. It went unnoticed while
      -- exactly one product qualified; three oversold rows exposed it.
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT p.id
        FROM "Product" p
        JOIN "Stock" s ON s."productId" = p.id
        WHERE p."isActive" = true
        GROUP BY p.id
        -- reorderLevel > 0 moved out of WHERE and into the second branch on
        -- purpose: an oversold product needs restocking whether or not anyone
        -- ever set a reorder level, and under the old filter one without a level
        -- could sit at -5 and never be counted. With no shortfalls anywhere the
        -- first branch is always false and this matches the previous rule.
        HAVING SUM(s."shortfallQty") > 0
            OR ((SELECT "reorderLevel" FROM "Product" WHERE id = p.id) > 0
                AND SUM(s.qty) <= (SELECT "reorderLevel" FROM "Product" WHERE id = p.id))
      ) q
    `;
    const actualLowStock = Number(lowStockResult[0]?.count ?? 0);

    // Sales returns reduce net revenue (v1.0.54). SaleReturn has no `date` field,
    // so filter on createdAt. Yesterday is also adjusted so the trend % stays net-vs-net.
    // SaleReturn has no soft-delete. If voiding is added: add isActive:true filter here.
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
    // SaleReturn has no soft-delete. If voiding is added: add isActive:true filter here.
    const allReturnsAgg = await prisma.saleReturn.aggregate({ _sum: { totalCents: true } });
    const totalReturnedCents = allReturnsAgg._sum.totalCents ?? 0;
    const unpaidCents = Math.max(0, totalSaleCents - totalPaidCents - totalReturnedCents);

    // Month purchases (confirmed POs) — actual spend = delivered value.
    const monthPurchasesResult = await prisma.purchase.aggregate({
      where: { status: 'CONFIRMED', date: { gte: monthStart } },
      _sum: { receivedValueCents: true },
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
      monthPurchasesCents: monthPurchasesResult._sum.receivedValueCents ?? 0,
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

    // Bucket by the SHOP's day, not UTC. Timestamps are stored in UTC, so a bare
    // DATE_TRUNC grouped by UTC day while the "Today" KPI on the same screen used
    // local midnight — the hero card read "Today Rs. 350" while the chart's today
    // bar read zero and yesterday carried the 350. Shifting by the local offset
    // before truncating makes each bucket a local calendar day.
    const tzMin = localOffsetMinutes();
    // One extra day of raw rows so the earliest local day is not clipped by the
    // UTC-based window boundary. The assembly loop still emits exactly `days`.
    const span  = days + 1;

    const [salesRows, expenseRows, cogsRows, returnsRows] = await Promise.all([
      prisma.$queryRaw<DailyRevenue[]>`
        SELECT
          DATE_TRUNC('day', date + INTERVAL '1 minute' * ${tzMin})::date AS day,
          COALESCE(SUM("totalCents"), 0)::bigint AS revenue,
          COUNT(*)::bigint AS orders
        FROM "Sale"
        WHERE status = 'CONFIRMED'
          AND "deletedAt" IS NULL
          AND date >= NOW() - INTERVAL '1 day' * ${span}
        GROUP BY 1
        ORDER BY day ASC
      `,
      prisma.$queryRaw<{ day: Date; total: bigint }[]>`
        SELECT DATE_TRUNC('day', date + INTERVAL '1 minute' * ${tzMin})::date AS day,
          COALESCE(SUM(amount), 0)::bigint AS total
        FROM "expenses"
        WHERE "isRecurring" = false
          AND "deletedAt" IS NULL
          AND date >= NOW() - INTERVAL '1 day' * ${span}
        GROUP BY 1
        ORDER BY day ASC
      `,
      // Daily COGS (qty × cost of goods actually sold) so the chart can show a
      // TRUE net profit (revenue − COGS − expenses), consistent with the P&L.
      // Previously the footer computed "Net Profit" as revenue − expenses only,
      // silently ignoring COGS and overstating profit.
      prisma.$queryRaw<{ day: Date; cogs: bigint }[]>`
        SELECT DATE_TRUNC('day', s.date + INTERVAL '1 minute' * ${tzMin})::date AS day,
          COALESCE(SUM(sl.qty * p."costCents"), 0)::bigint AS cogs
        FROM "Sale" s
        JOIN "SaleLine" sl ON sl."saleId" = s.id
        JOIN "Product" p ON p.id = sl."productId"
        WHERE s.status = 'CONFIRMED'
          AND s."deletedAt" IS NULL
          AND s.date >= NOW() - INTERVAL '1 day' * ${span}
        GROUP BY 1
        ORDER BY day ASC
      `,
      // Daily sales returns, so the chart/footer can show TRUE net revenue
      // (audit fix — this chart previously summed gross totalCents with no
      // return-netting, overstating both Revenue and Net Profit on the
      // Dashboard's first screen). SaleReturn has no soft-delete.
      prisma.$queryRaw<{ day: Date; returned: bigint }[]>`
        SELECT DATE_TRUNC('day', "createdAt" + INTERVAL '1 minute' * ${tzMin})::date AS day,
          COALESCE(SUM("totalCents"), 0)::bigint AS returned
        FROM "SaleReturn"
        WHERE "createdAt" >= NOW() - INTERVAL '1 day' * ${span}
        GROUP BY 1
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
    const cogsMap = new Map<string, number>();
    for (const row of cogsRows) {
      cogsMap.set(new Date(row.day).toISOString().slice(0, 10), Number(row.cogs));
    }
    const returnsMap = new Map<string, number>();
    for (const row of returnsRows) {
      returnsMap.set(new Date(row.day).toISOString().slice(0, 10), Number(row.returned));
    }

    const result: { date: string; revenue: number; orders: number; expensesCents: number; cogsCents: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      // Local days, matching the buckets above. Walking UTC days here while the
      // SQL grouped locally would silently drop or duplicate a bar.
      const key = toLocalYMD(localMidnightDaysAgo(i));
      const grossRevenue = salesMap.get(key)?.revenue ?? 0;
      result.push({
        date:          key,
        revenue:       Math.max(0, grossRevenue - (returnsMap.get(key) ?? 0)),
        orders:        salesMap.get(key)?.orders  ?? 0,
        expensesCents: expMap.get(key) ?? 0,
        cogsCents:     cogsMap.get(key) ?? 0,
      });
    }

    return result;
  },

  // ── Top 5 products by revenue this month ───────────────────────────────────

  topProducts: async () => {
    const monthStart = startOfMonth(new Date());

    const [rows, returnRows] = await Promise.all([
      prisma.$queryRaw<TopProduct[]>`
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
      `,
      // Returns netting (audit fix) — mirrors reports.service.ts's productReport/
      // salesReport topProducts. SaleReturn has no soft-delete.
      prisma.saleReturnLine.groupBy({
        by: ['productId'],
        where: { saleReturn: { createdAt: { gte: monthStart } } },
        _sum: { lineTotalCents: true },
      }),
    ]);

    const returnsMap = new Map(returnRows.map((r) => [r.productId, r._sum.lineTotalCents ?? 0]));

    return rows.map((r) => ({
      productId: r.productId,
      name: r.name,
      revenueCents: Math.max(0, Number(r.revenue) - (returnsMap.get(r.productId) ?? 0)),
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
        -- Net of anything sold past stock, so an oversold product reports the
        -- negative the counter sees rather than a flat zero.
        (COALESCE(SUM(s.qty), 0) - COALESCE(SUM(s."shortfallQty"), 0))::float AS "totalQty"
      FROM "Product" p
      LEFT JOIN "Stock" s ON s."productId" = p.id
      WHERE p."isActive" = true
      GROUP BY p.id, p.name, p.sku, p."reorderLevel"
      -- Oversold products qualify with or without a reorder level; everything
      -- else behaves exactly as before (the first branch is never true when no
      -- shortfall exists anywhere).
      HAVING COALESCE(SUM(s."shortfallQty"), 0) > 0
          OR (p."reorderLevel" > 0 AND COALESCE(SUM(s.qty), 0) <= p."reorderLevel")
      -- Oversold first as a class, then deepest shortage. Ranking purely by
      -- distance below the reorder level would bury a product the shop actually
      -- owes units of beneath one that is merely under its threshold — and the
      -- alert generator already calls the former CRITICAL.
      ORDER BY (CASE WHEN COALESCE(SUM(s."shortfallQty"), 0) > 0 THEN 0 ELSE 1 END) ASC,
               (COALESCE(SUM(s.qty), 0) - COALESCE(SUM(s."shortfallQty"), 0) - p."reorderLevel") ASC
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
