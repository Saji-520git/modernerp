import { prisma } from '../../config/prisma.js';

// ─── Reports Service ──────────────────────────────────────────────────────────

export const reportsService = {

  // ── 1. Sales Report ───────────────────────────────────────────────────────────

  salesReport: async (from: Date, to: Date, groupBy: 'day' | 'week' | 'month') => {
    // Compute the previous equal-length period
    const durationMs  = to.getTime() - from.getTime();
    const prevTo      = new Date(from.getTime() - 1);          // day before from
    const prevFrom    = new Date(from.getTime() - durationMs); // same length back

    const [summary, byWarehouseRaw, byPaymentRaw, cogsRaw, topProductsRaw, prevPeriodRaw] = await Promise.all([
      prisma.sale.aggregate({
        where: { status: 'CONFIRMED', date: { gte: from, lte: to } },
        _sum: { totalCents: true, taxCents: true, discountCents: true, paidCents: true },
        _count: true,
      }),
      prisma.$queryRaw<{ name: string; code: string; revenue: bigint; orders: bigint }[]>`
        SELECT w.name, w.code,
          SUM(s."totalCents")::bigint AS revenue,
          COUNT(s.id)::bigint AS orders
        FROM "Sale" s
        JOIN "warehouses" w ON w.id = s."warehouseId"
        WHERE s.status = 'CONFIRMED' AND s.date >= ${from} AND s.date <= ${to}
        GROUP BY w.name, w.code
        ORDER BY revenue DESC
      `,
      prisma.$queryRaw<{ method: string; count: bigint; revenue: bigint }[]>`
        SELECT "paymentMethod" AS method,
          COUNT(*)::bigint AS count,
          SUM("totalCents")::bigint AS revenue
        FROM "Sale"
        WHERE status = 'CONFIRMED' AND date >= ${from} AND date <= ${to}
        GROUP BY "paymentMethod"
        ORDER BY revenue DESC
      `,
      prisma.$queryRaw<[{ cogs: bigint }]>`
        SELECT COALESCE(SUM(sl.qty * p."costCents"), 0)::bigint AS cogs
        FROM "SaleLine" sl
        JOIN "Product" p ON p.id = sl."productId"
        JOIN "Sale"    s ON s.id = sl."saleId"
        WHERE s.status = 'CONFIRMED'
          AND s."deletedAt" IS NULL
          AND s.date >= ${from} AND s.date <= ${to}
      `,
      prisma.$queryRaw<{ productId: string; name: string; sku: string; revenue: bigint; qtySold: number; cogs: bigint }[]>`
        SELECT p.id AS "productId", p.name, p.sku,
          SUM(sl."lineTotalCents")::bigint AS revenue,
          SUM(sl.qty)::float              AS "qtySold",
          COALESCE(SUM(sl.qty * p."costCents"), 0)::bigint AS cogs
        FROM "SaleLine" sl
        JOIN "Product" p ON p.id = sl."productId"
        JOIN "Sale"    s ON s.id = sl."saleId"
        WHERE s.status = 'CONFIRMED'
          AND s."deletedAt" IS NULL
          AND s.date >= ${from} AND s.date <= ${to}
        GROUP BY p.id, p.name, p.sku
        ORDER BY revenue DESC
        LIMIT 10
      `,
      // Previous equal-length period for trend calculation
      prisma.sale.aggregate({
        where: { status: 'CONFIRMED', date: { gte: prevFrom, lte: prevTo } },
        _sum: { totalCents: true },
      }),
    ]);

    // Period grouping — separate queries to avoid Prisma.raw complexity
    const byPeriodRaw =
      groupBy === 'month'
        ? await prisma.$queryRaw<{ period: Date; revenue: bigint; orders: bigint }[]>`
            SELECT DATE_TRUNC('month', date)::date AS period,
              SUM("totalCents")::bigint AS revenue,
              COUNT(*)::bigint AS orders
            FROM "Sale"
            WHERE status = 'CONFIRMED' AND date >= ${from} AND date <= ${to}
            GROUP BY 1 ORDER BY 1
          `
        : groupBy === 'week'
        ? await prisma.$queryRaw<{ period: Date; revenue: bigint; orders: bigint }[]>`
            SELECT DATE_TRUNC('week', date)::date AS period,
              SUM("totalCents")::bigint AS revenue,
              COUNT(*)::bigint AS orders
            FROM "Sale"
            WHERE status = 'CONFIRMED' AND date >= ${from} AND date <= ${to}
            GROUP BY 1 ORDER BY 1
          `
        : await prisma.$queryRaw<{ period: Date; revenue: bigint; orders: bigint }[]>`
            SELECT DATE_TRUNC('day', date)::date AS period,
              SUM("totalCents")::bigint AS revenue,
              COUNT(*)::bigint AS orders
            FROM "Sale"
            WHERE status = 'CONFIRMED' AND date >= ${from} AND date <= ${to}
            GROUP BY 1 ORDER BY 1
          `;

    const totalRevenue         = summary._sum.totalCents ?? 0;
    const totalCogs            = Number(cogsRaw[0]?.cogs ?? 0);
    const count                = summary._count;
    const prevPeriodRevenue    = prevPeriodRaw._sum.totalCents ?? 0;

    return {
      summary: {
        totalRevenueCents:      totalRevenue,
        totalTaxCents:          summary._sum.taxCents ?? 0,
        totalDiscountCents:     summary._sum.discountCents ?? 0,
        totalPaidCents:         summary._sum.paidCents ?? 0,
        totalCogsCents:         totalCogs,
        orderCount:             count,
        avgOrderCents:          count > 0 ? Math.round(totalRevenue / count) : 0,
        prevPeriodRevenueCents: prevPeriodRevenue,
      },
      byPeriod: byPeriodRaw.map((r) => ({
        period: new Date(r.period).toISOString().slice(0, 10),
        revenueCents: Number(r.revenue),
        orders: Number(r.orders),
      })),
      byWarehouse: byWarehouseRaw.map((r) => ({
        name: r.name,
        code: r.code,
        revenueCents: Number(r.revenue),
        orders: Number(r.orders),
      })),
      byPayment: byPaymentRaw.map((r) => ({
        method: r.method,
        count: Number(r.count),
        revenueCents: Number(r.revenue),
      })),
      topProducts: topProductsRaw.map((r) => {
        const rev  = Number(r.revenue);
        const cogs = Number(r.cogs);
        return {
          productId:        r.productId,
          name:             r.name,
          sku:              r.sku,
          revenueCents:     rev,
          qtySold:          r.qtySold,
          cogsCents:        cogs,
          grossProfitCents: rev - cogs,
          marginPct:        rev > 0 ? Math.round(((rev - cogs) / rev) * 1000) / 10 : 0,
        };
      }),
    };
  },

  // ── 2. Purchases Report ───────────────────────────────────────────────────────

  purchasesReport: async (from: Date, to: Date) => {
    const [summary, bySupplierRaw, byPeriodRaw, itemsRaw, suppliersRaw] = await Promise.all([
      prisma.purchase.aggregate({
        where: { status: 'CONFIRMED', date: { gte: from, lte: to } },
        _sum: { totalCents: true },
        _count: true,
      }),
      prisma.$queryRaw<{ name: string; spend: bigint; poCount: bigint }[]>`
        SELECT sup.name,
          SUM(p."totalCents")::bigint AS spend,
          COUNT(p.id)::bigint AS "poCount"
        FROM "Purchase" p
        JOIN "Supplier" sup ON sup.id = p."supplierId"
        WHERE p.status = 'CONFIRMED' AND p.date >= ${from} AND p.date <= ${to}
        GROUP BY sup.name
        ORDER BY spend DESC
        LIMIT 10
      `,
      prisma.$queryRaw<{ period: Date; spend: bigint; poCount: bigint }[]>`
        SELECT DATE_TRUNC('day', date)::date AS period,
          SUM("totalCents")::bigint AS spend,
          COUNT(*)::bigint AS "poCount"
        FROM "Purchase"
        WHERE status = 'CONFIRMED' AND date >= ${from} AND date <= ${to}
        GROUP BY 1 ORDER BY 1
      `,
      // Total items received across all confirmed purchase lines
      prisma.$queryRaw<[{ total: number }]>`
        SELECT COALESCE(SUM(pl.qty), 0)::float AS total
        FROM "PurchaseLine" pl
        JOIN "Purchase" p ON p.id = pl."purchaseId"
        WHERE p.status = 'CONFIRMED' AND p.date >= ${from} AND p.date <= ${to}
      `,
      // Unique suppliers
      prisma.$queryRaw<[{ cnt: bigint }]>`
        SELECT COUNT(DISTINCT "supplierId")::bigint AS cnt
        FROM "Purchase"
        WHERE status = 'CONFIRMED' AND date >= ${from} AND date <= ${to}
      `,
    ]);

    const totalSpend        = summary._sum.totalCents ?? 0;
    const count             = summary._count;
    const totalItemsReceived = Number(itemsRaw[0]?.total ?? 0);
    const uniqueSuppliers    = Number(suppliersRaw[0]?.cnt ?? 0);

    return {
      summary: {
        totalSpendCents:     totalSpend,
        poCount:             count,
        avgPoCents:          count > 0 ? Math.round(totalSpend / count) : 0,
        totalItemsReceived,
        uniqueSuppliers,
        avgLeadTimeDays:     0,
      },
      bySupplier: bySupplierRaw.map((r) => ({
        name: r.name,
        spendCents: Number(r.spend),
        poCount: Number(r.poCount),
      })),
      byPeriod: byPeriodRaw.map((r) => ({
        period: new Date(r.period).toISOString().slice(0, 10),
        spendCents: Number(r.spend),
        poCount: Number(r.poCount),
      })),
    };
  },

  // ── 3. Product Performance ────────────────────────────────────────────────────

  productReport: async (from: Date, to: Date) => {
    type ProductRow = {
      productId: string;
      name: string;
      sku: string;
      costCents: number;
      revenue: bigint;
      qty: number;
    };

    const [topByRevRaw, topByQtyRaw] = await Promise.all([
      prisma.$queryRaw<ProductRow[]>`
        SELECT p.id AS "productId", p.name, p.sku, p."costCents",
          SUM(sl."lineTotalCents")::bigint AS revenue,
          SUM(sl.qty)::float AS qty
        FROM "SaleLine" sl
        JOIN "Product" p ON p.id = sl."productId"
        JOIN "Sale" s ON s.id = sl."saleId"
        WHERE s.status = 'CONFIRMED' AND s.date >= ${from} AND s.date <= ${to}
        GROUP BY p.id, p.name, p.sku, p."costCents"
        ORDER BY revenue DESC
        LIMIT 10
      `,
      prisma.$queryRaw<ProductRow[]>`
        SELECT p.id AS "productId", p.name, p.sku, p."costCents",
          SUM(sl."lineTotalCents")::bigint AS revenue,
          SUM(sl.qty)::float AS qty
        FROM "SaleLine" sl
        JOIN "Product" p ON p.id = sl."productId"
        JOIN "Sale" s ON s.id = sl."saleId"
        WHERE s.status = 'CONFIRMED' AND s.date >= ${from} AND s.date <= ${to}
        GROUP BY p.id, p.name, p.sku, p."costCents"
        ORDER BY qty DESC
        LIMIT 10
      `,
    ]);

    const mapRow = (r: ProductRow) => {
      const rev = Number(r.revenue);
      const cogs = Math.round(r.qty * r.costCents);
      return {
        productId: r.productId,
        name: r.name,
        sku: r.sku,
        revenueCents: rev,
        qtySold: r.qty,
        cogsCents: cogs,
        grossProfitCents: rev - cogs,
        marginPct: rev > 0 ? Math.round(((rev - cogs) / rev) * 1000) / 10 : 0,
      };
    };

    return {
      topByRevenue: topByRevRaw.map(mapRow),
      topByQty: topByQtyRaw.map(mapRow),
    };
  },

  // ── 4. Customer Report ────────────────────────────────────────────────────────

  customerReport: async (from: Date, to: Date) => {
    const rows = await prisma.$queryRaw<{
      customerId: string;
      name: string;
      totalSpent: bigint;
      orderCount: bigint;
      lastOrder: Date;
    }[]>`
      SELECT c.id AS "customerId", c.name,
        SUM(s."totalCents")::bigint AS "totalSpent",
        COUNT(s.id)::bigint AS "orderCount",
        MAX(s.date) AS "lastOrder"
      FROM "Sale" s
      JOIN "Customer" c ON c.id = s."customerId"
      WHERE s.status = 'CONFIRMED' AND s.date >= ${from} AND s.date <= ${to}
      GROUP BY c.id, c.name
      ORDER BY "totalSpent" DESC
      LIMIT 20
    `;

    return rows.map((r) => ({
      customerId: r.customerId,
      name: r.name,
      totalSpentCents: Number(r.totalSpent),
      orderCount: Number(r.orderCount),
      avgOrderCents:
        Number(r.orderCount) > 0
          ? Math.round(Number(r.totalSpent) / Number(r.orderCount))
          : 0,
      lastOrder: new Date(r.lastOrder).toISOString().slice(0, 10),
    }));
  },

  // ── 5. Inventory Valuation ────────────────────────────────────────────────────

  inventoryReport: async (warehouseId?: string) => {
    type InvRow = {
      productId: string;
      name: string;
      sku: string;
      costCents: number;
      priceCents: number;
      reorderLevel: number;
      totalQty: number;
    };

    const rows: InvRow[] = warehouseId
      ? await prisma.$queryRaw<InvRow[]>`
          SELECT p.id AS "productId", p.name, p.sku,
            p."costCents", p."priceCents", p."reorderLevel",
            COALESCE(SUM(s.qty), 0)::float AS "totalQty"
          FROM "Product" p
          LEFT JOIN "Stock" s ON s."productId" = p.id AND s."warehouseId" = ${warehouseId}
          WHERE p."isActive" = true
          GROUP BY p.id, p.name, p.sku, p."costCents", p."priceCents", p."reorderLevel"
          ORDER BY (COALESCE(SUM(s.qty), 0) * p."costCents") DESC
        `
      : await prisma.$queryRaw<InvRow[]>`
          SELECT p.id AS "productId", p.name, p.sku,
            p."costCents", p."priceCents", p."reorderLevel",
            COALESCE(SUM(s.qty), 0)::float AS "totalQty"
          FROM "Product" p
          LEFT JOIN "Stock" s ON s."productId" = p.id
          WHERE p."isActive" = true
          GROUP BY p.id, p.name, p.sku, p."costCents", p."priceCents", p."reorderLevel"
          ORDER BY (COALESCE(SUM(s.qty), 0) * p."costCents") DESC
        `;

    const items = rows.map((r) => ({
      productId: r.productId,
      name: r.name,
      sku: r.sku,
      totalQty: r.totalQty,
      costCents: r.costCents,
      priceCents: r.priceCents,
      reorderLevel: r.reorderLevel,
      isLowStock: r.totalQty <= r.reorderLevel && r.reorderLevel > 0,
      costValueCents: Math.round(r.totalQty * r.costCents),
      saleValueCents: Math.round(r.totalQty * r.priceCents),
      potentialMarginCents: Math.round(r.totalQty * (r.priceCents - r.costCents)),
    }));

    const totals = {
      totalCostValueCents: items.reduce((s, i) => s + i.costValueCents, 0),
      totalSaleValueCents: items.reduce((s, i) => s + i.saleValueCents, 0),
      totalMarginCents: items.reduce((s, i) => s + i.potentialMarginCents, 0),
      lowStockCount: items.filter((i) => i.isLowStock).length,
      skuCount: items.length,
    };

    // Slow movers: products with stock on hand but zero confirmed sales in the last 30 days
    const slowMoversRaw = await prisma.$queryRaw<{
      productId: string; name: string; sku: string;
      costCents: number; totalQty: number; lastSaleDate: Date | null;
    }[]>`
      SELECT p.id AS "productId", p.name, p.sku, p."costCents",
        COALESCE(SUM(DISTINCT s.qty), 0)::float AS "totalQty",
        MAX(sale.date) AS "lastSaleDate"
      FROM "Product" p
      LEFT JOIN "Stock"    s    ON s."productId" = p.id
      LEFT JOIN "SaleLine" sl   ON sl."productId" = p.id
      LEFT JOIN "Sale"     sale ON sale.id = sl."saleId"
                                AND sale.status = 'CONFIRMED'
                                AND sale."deletedAt" IS NULL
                                AND sale.date >= NOW() - INTERVAL '30 days'
      WHERE p."isActive" = true
      GROUP BY p.id, p.name, p.sku, p."costCents"
      HAVING COALESCE(SUM(DISTINCT s.qty), 0) > 0
         AND COUNT(sale.id) = 0
      ORDER BY (COALESCE(SUM(DISTINCT s.qty), 0) * p."costCents") DESC
      LIMIT 20
    `;

    const slowMovers = slowMoversRaw.map((r) => ({
      productId:      r.productId,
      name:           r.name,
      sku:            r.sku,
      totalQty:       r.totalQty,
      costCents:      r.costCents,
      costValueCents: Math.round(r.totalQty * r.costCents),
      lastSaleDate:   r.lastSaleDate ? new Date(r.lastSaleDate).toISOString().slice(0, 10) : null,
    }));

    // Low stock items pre-filtered for direct rendering (avoids client-side filter)
    const lowStockItems = items
      .filter((i) => i.isLowStock)
      .map((i) => ({
        productId:    i.productId,
        name:         i.name,
        sku:          i.sku,
        totalQty:     i.totalQty,
        reorderLevel: i.reorderLevel,
        deficit:      Math.max(0, i.reorderLevel - i.totalQty),
        costCents:    i.costCents,
      }));

    return { items, totals, slowMovers, lowStockItems };
  },

  // ── 6. Profit & Loss ──────────────────────────────────────────────────────────

  profitLoss: async (from: Date, to: Date) => {
    const [salesAgg, cogsRaw, byPeriodRaw, expenseRows] = await Promise.all([
      prisma.sale.aggregate({
        where: { status: 'CONFIRMED', date: { gte: from, lte: to } },
        _sum: { totalCents: true, taxCents: true, discountCents: true },
        _count: true,
      }),
      prisma.$queryRaw<[{ cogs: bigint }]>`
        SELECT COALESCE(SUM(sl.qty * p."costCents"), 0)::bigint AS cogs
        FROM "SaleLine" sl
        JOIN "Product" p ON p.id = sl."productId"
        JOIN "Sale" s ON s.id = sl."saleId"
        WHERE s.status = 'CONFIRMED' AND s.date >= ${from} AND s.date <= ${to}
      `,
      prisma.$queryRaw<{ period: Date; revenue: bigint; cogs: bigint }[]>`
        SELECT
          DATE_TRUNC('month', s.date)::date AS period,
          SUM(s."totalCents")::bigint AS revenue,
          COALESCE(SUM(sl.qty * p."costCents"), 0)::bigint AS cogs
        FROM "Sale" s
        JOIN "SaleLine" sl ON sl."saleId" = s.id
        JOIN "Product" p ON p.id = sl."productId"
        WHERE s.status = 'CONFIRMED' AND s.date >= ${from} AND s.date <= ${to}
        GROUP BY 1
        ORDER BY 1
      `,
      // Expenses in the same period — isRecurring: false excludes templates; deletedAt: null excludes soft-deleted
      (prisma as any).expense.findMany({
        where: { isRecurring: false, deletedAt: null, date: { gte: from, lte: to } },
        include: { category: { select: { name: true, color: true } } },
      }),
    ]);

    const revenueCents = salesAgg._sum.totalCents ?? 0;
    const taxCents = salesAgg._sum.taxCents ?? 0;
    const discountCents = salesAgg._sum.discountCents ?? 0;
    const cogsCents = Number(cogsRaw[0]?.cogs ?? 0);
    const grossProfitCents = revenueCents - cogsCents;
    const grossMarginPct =
      revenueCents > 0
        ? Math.round((grossProfitCents / revenueCents) * 1000) / 10
        : 0;

    // Aggregate expenses by category
    const expByCat = new Map<string, { name: string; color: string; totalCents: number }>();
    for (const e of expenseRows as any[]) {
      const key = e.category.name;
      const existing = expByCat.get(key) ?? { name: e.category.name, color: e.category.color, totalCents: 0 };
      expByCat.set(key, { ...existing, totalCents: existing.totalCents + e.amount });
    }
    const totalExpensesCents = (expenseRows as any[]).reduce((s: number, e: any) => s + e.amount, 0);
    const netProfitCents = grossProfitCents - totalExpensesCents;

    return {
      summary: {
        revenueCents,
        taxCents,
        discountCents,
        cogsCents,
        grossProfitCents,
        grossMarginPct,
        orderCount: salesAgg._count,
        totalExpensesCents,
        netProfitCents,
        netMarginPct: revenueCents > 0
          ? Math.round((netProfitCents / revenueCents) * 1000) / 10
          : 0,
      },
      expensesByCategory: [...expByCat.values()].sort((a, b) => b.totalCents - a.totalCents),
      byPeriod: await (async () => {
        // Group expenses by month so each period row gets a net profit figure
        const expByMonthRaw = await prisma.$queryRaw<{ period: Date; total: bigint }[]>`
          SELECT DATE_TRUNC('month', date)::date AS period,
            COALESCE(SUM(amount), 0)::bigint AS total
          FROM "expenses"
          WHERE "isRecurring" = false
            AND "deletedAt" IS NULL
            AND date >= ${from} AND date <= ${to}
          GROUP BY 1
          ORDER BY 1
        `;
        const expMap = new Map<string, number>();
        for (const r of expByMonthRaw) {
          expMap.set(new Date(r.period).toISOString().slice(0, 10), Number(r.total));
        }
        return byPeriodRaw.map((r) => {
          const rev      = Number(r.revenue);
          const cogs     = Number(r.cogs);
          const gp       = rev - cogs;
          const periodKey = new Date(r.period).toISOString().slice(0, 10);
          const expenses  = expMap.get(periodKey) ?? 0;
          const net       = gp - expenses;
          return {
            period:           periodKey,
            revenueCents:     rev,
            cogsCents:        cogs,
            grossProfitCents: gp,
            grossMarginPct:   rev > 0 ? Math.round((gp / rev) * 1000) / 10 : 0,
            expensesCents:    expenses,
            netProfitCents:   net,
            netMarginPct:     rev > 0 ? Math.round((net / rev) * 1000) / 10 : 0,
          };
        });
      })(),
    };
  },

  // ─── Dashboard Live Stats ────────────────────────────────────────────────────

  getDashboardStats: async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setDate(todayEnd.getDate() + 1);

    // Last 7 days array (oldest first)
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today);
      d.setDate(d.getDate() - (6 - i));
      return d;
    });

    const [
      todaySalesAgg,
      receivablesAgg,
      payablesAgg,
      stocks,
      day7Results,
      [sales, purchases, cpays, spays],
    ] = await Promise.all([
      // 1. Today's sales
      prisma.sale.aggregate({
        where: { status: 'CONFIRMED', date: { gte: today, lt: todayEnd }, deletedAt: null },
        _sum:   { totalCents: true },
        _count: { id: true },
      }),

      // 2. Outstanding receivables (confirmed sales not fully paid)
      prisma.sale.aggregate({
        where: {
          status:        'CONFIRMED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
          deletedAt:     null,
        },
        _sum: { totalCents: true, paidCents: true },
      }),

      // 3. Outstanding payables (confirmed purchases not fully paid)
      prisma.purchase.aggregate({
        where: {
          status:        'CONFIRMED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
          deletedAt:     null,
        },
        _sum: { totalCents: true, paidCents: true },
      }),

      // 4. Low stock count (application-code filter — no raw SQL)
      prisma.stock.findMany({
        where:   { qty: { gt: 0 } },
        include: { product: { select: { reorderLevel: true } } },
      }),

      // 5. Last 7 days daily sales
      Promise.all(days.map((day) => {
        const nextDay = new Date(day);
        nextDay.setDate(nextDay.getDate() + 1);
        return prisma.sale.aggregate({
          where: { status: 'CONFIRMED', date: { gte: day, lt: nextDay }, deletedAt: null },
          _sum:   { totalCents: true },
          _count: { id: true },
        });
      })),

      // 6. Recent activity — 4 separate queries
      Promise.all([
        prisma.sale.findMany({
          where:   { status: 'CONFIRMED', deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take:    5,
          select:  {
            id: true, number: true, totalCents: true, createdAt: true,
            customer: { select: { name: true } },
          },
        }),
        prisma.purchase.findMany({
          where:   { status: 'CONFIRMED', deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take:    5,
          select:  {
            id: true, number: true, totalCents: true, createdAt: true,
            supplier: { select: { name: true } },
          },
        }),
        prisma.customerPayment.findMany({
          where:   { isActive: true },
          orderBy: { createdAt: 'desc' },
          take:    5,
          select:  {
            id: true, paymentNumber: true, amountCents: true, createdAt: true,
            sale: { select: { number: true } },
          },
        }),
        prisma.supplierPayment.findMany({
          where:   { isActive: true },
          orderBy: { createdAt: 'desc' },
          take:    5,
          select:  {
            id: true, paymentNumber: true, amountCents: true, createdAt: true,
            purchase: { select: { number: true } },
          },
        }),
      ]),
    ]);

    const lowStockCount = stocks.filter(
      (s) => Number(s.qty) <= (s.product.reorderLevel ?? 0),
    ).length;

    const outstandingReceivablesCents =
      (receivablesAgg._sum.totalCents ?? 0) - (receivablesAgg._sum.paidCents ?? 0);
    const outstandingPayablesCents =
      (payablesAgg._sum.totalCents ?? 0) - (payablesAgg._sum.paidCents ?? 0);

    const last7Days = days.map((day, i) => ({
      date:       day.toISOString().split('T')[0],
      salesCents: day7Results[i]._sum.totalCents ?? 0,
      salesCount: day7Results[i]._count.id ?? 0,
    }));

    const activity = [
      ...sales.map((s) => ({
        type:        'SALE' as const,
        refNumber:   s.number,
        description: s.customer?.name ?? 'Walk-in',
        amountCents: s.totalCents,
        createdAt:   s.createdAt.toISOString(),
      })),
      ...purchases.map((p) => ({
        type:        'PURCHASE' as const,
        refNumber:   p.number,
        description: p.supplier.name,
        amountCents: p.totalCents,
        createdAt:   p.createdAt.toISOString(),
      })),
      ...cpays.map((c) => ({
        type:        'PAYMENT_IN' as const,
        refNumber:   c.paymentNumber,
        description: `Receipt for ${c.sale.number}`,
        amountCents: c.amountCents,
        createdAt:   c.createdAt.toISOString(),
      })),
      ...spays.map((s) => ({
        type:        'PAYMENT_OUT' as const,
        refNumber:   s.paymentNumber,
        description: `Payment for ${s.purchase.number}`,
        amountCents: s.amountCents,
        createdAt:   s.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10);

    return {
      todaySalesCents:             todaySalesAgg._sum.totalCents ?? 0,
      todaySalesCount:             todaySalesAgg._count.id ?? 0,
      outstandingReceivablesCents,
      outstandingPayablesCents,
      lowStockCount,
      last7Days,
      recentActivity: activity,
    };
  },

  // ─── P&L Comparison (current vs previous period) ────────────────────────────

  getPnlComparison: async (dateFrom: string, dateTo: string, warehouseId?: string) => {
    const from       = new Date(dateFrom);
    const to         = new Date(dateTo);
    const durationMs = to.getTime() - from.getTime();
    const prevFrom   = new Date(from.getTime() - durationMs);
    const prevTo     = from;

    async function getPeriodMetrics(pFrom: Date, pTo: Date, whId?: string) {
      const warehouseFilter = whId ? { warehouseId: whId } : {};

      // COGS via raw SQL — two variants (with / without warehouseId) to keep types clean
      const cogsRows = whId
        ? await prisma.$queryRaw<[{ cogs: bigint }]>`
            SELECT COALESCE(SUM(sl.qty * p."costCents"), 0)::bigint AS cogs
            FROM "SaleLine" sl
            JOIN "Sale" s ON s.id = sl."saleId"
            JOIN "Product" p ON p.id = sl."productId"
            WHERE s.status = 'CONFIRMED'
              AND s.date >= ${pFrom} AND s.date < ${pTo}
              AND s."deletedAt" IS NULL
              AND s."warehouseId" = ${whId}
          `
        : await prisma.$queryRaw<[{ cogs: bigint }]>`
            SELECT COALESCE(SUM(sl.qty * p."costCents"), 0)::bigint AS cogs
            FROM "SaleLine" sl
            JOIN "Sale" s ON s.id = sl."saleId"
            JOIN "Product" p ON p.id = sl."productId"
            WHERE s.status = 'CONFIRMED'
              AND s.date >= ${pFrom} AND s.date < ${pTo}
              AND s."deletedAt" IS NULL
          `;

      const [revResult, returnResult, expResult] = await Promise.all([
        prisma.sale.aggregate({
          where: {
            status:    'CONFIRMED',
            date:      { gte: pFrom, lt: pTo },
            deletedAt: null,
            ...warehouseFilter,
          },
          _sum: { totalCents: true },
        }),

        prisma.purchaseReturn.aggregate({
          where: {
            status:    'CONFIRMED',
            createdAt: { gte: pFrom, lt: pTo },
            isActive:  true,
          },
          _sum: { totalCents: true },
        }),

        // Expense.amount is the cents field (not amountCents); date field is 'date'
        prisma.expense.aggregate({
          where: {
            date:      { gte: pFrom, lt: pTo },
            deletedAt: null,
          },
          _sum: { amount: true },
        }),
      ]);

      const revenue        = revResult._sum.totalCents ?? 0;
      const cogs           = Number(cogsRows[0]?.cogs ?? 0);
      const purchaseReturns = returnResult._sum.totalCents ?? 0;
      const expenses        = expResult._sum.amount ?? 0;

      // Purchase returns of unsold goods are a balance-sheet event (inventory ↓,
      // payable ↓) — they do NOT reduce COGS, which only counts items actually sold.
      // purchaseReturns is still surfaced in the response object below for reference.
      const grossProfit    = revenue - cogs;
      const netProfit      = grossProfit - expenses;
      const grossMarginPct = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;
      const netMarginPct   = revenue > 0 ? Math.round((netProfit  / revenue) * 1000) / 10 : 0;

      return {
        revenue, cogs, purchaseReturns,
        grossProfit, expenses, netProfit,
        grossMarginPct, netMarginPct,
      };
    }

    const [current, previous] = await Promise.all([
      getPeriodMetrics(from,     to,      warehouseId),
      getPeriodMetrics(prevFrom, prevTo,  warehouseId),
    ]);

    return {
      period:   { from: from.toISOString(), to: to.toISOString() },
      current,
      previous,
    };
  },
};
