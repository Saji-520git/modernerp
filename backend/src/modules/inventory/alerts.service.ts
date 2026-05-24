import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';

// ─── Generate + sync alerts from current stock state ──────────────────────────

async function saveAlert(
  id: string,
  createData: Omit<Prisma.StockAlertUncheckedCreateInput, 'id'>,
  updateData: Prisma.StockAlertUpdateInput,
): Promise<void> {
  const existing = await prisma.stockAlert.findFirst({ where: { id } });

  if (existing) {
    await prisma.stockAlert.update({
      where: { id },
      data: updateData,
    });
    return;
  }

  await prisma.stockAlert.create({
    data: { id, ...createData },
  });
}

export async function generateAlerts(): Promise<void> {
  const settings = await prisma.appSettings.findFirst();
  if (!settings) return;

  const now = new Date();
  const expiryThreshold = new Date(now);
  expiryThreshold.setDate(expiryThreshold.getDate() + (settings.alertExpiryDays ?? 30));

  // ── LOW STOCK ──────────────────────────────────────────────────────────────

  if (settings.alertLowStockEnabled) {
    const stockRows = await prisma.stock.findMany({
      where: { product: { isActive: true } },
      include: {
        product:   { select: { id: true, name: true, reorderLevel: true } },
        warehouse: { select: { id: true, name: true } },
      },
    });

    for (const row of stockRows) {
      const qty      = Number(row.qty);
      const level    = row.product.reorderLevel;
      const alertId  = `low_${row.productId}_${row.warehouseId}`;

      if (level > 0 && qty <= level) {
        const severity = qty === 0 || qty <= level * 0.5 ? 'CRITICAL' : 'WARNING';
        const message = `${row.product.name} stock (${qty}) is below reorder level (${level}) at ${row.warehouse.name}`;
        await saveAlert(
          alertId,
          {
            type:        'LOW_STOCK',
            severity,
            productId:   row.productId,
            warehouseId: row.warehouseId,
            qty,
            threshold:   level,
            message,
          },
          {
            qty, severity,
            threshold:   level,
            message,
            updatedAt:   now,
            isDismissed: false,
          },
        );
      } else {
        // Stock is OK — clear any existing alert for this combo
        await prisma.stockAlert.deleteMany({ where: { id: alertId } });
      }
    }

    // Out-of-stock products that have no stock row at all
    const outOfStock = await prisma.product.findMany({
      where: {
        isActive:     true,
        reorderLevel: { gt: 0 },
        stock:        { none: { qty: { gt: new Decimal(0) } } },
      },
      select: { id: true, name: true, reorderLevel: true },
    });

    for (const p of outOfStock) {
      const alertId = `oos_${p.id}`;
      const message = `${p.name} is OUT OF STOCK`;
      await saveAlert(
        alertId,
        {
          type:      'LOW_STOCK',
          severity:  'CRITICAL',
          productId: p.id,
          qty:       0,
          threshold: p.reorderLevel,
          message,
        },
        {
          qty:         0,
          severity:    'CRITICAL',
          threshold:   p.reorderLevel,
          message,
          updatedAt:   now,
          isDismissed: false,
        },
      );
    }
  }

  // ── EXPIRY ─────────────────────────────────────────────────────────────────

  if (settings.alertExpiryEnabled) {
    const batches = await prisma.stockBatch.findMany({
      where: {
        qty:        { gt: new Decimal(0) },
        expiryDate: { not: null, lte: expiryThreshold },
      },
      include: {
        product:   { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true } },
      },
    });

    for (const batch of batches) {
      if (!batch.expiryDate) continue;

      const isExpired = batch.expiryDate < now;
      const type      = isExpired ? 'EXPIRED' : 'EXPIRING_SOON';
      const severity  = isExpired ? 'CRITICAL' : 'WARNING';
      const daysLeft  = Math.ceil((batch.expiryDate.getTime() - now.getTime()) / 86_400_000);
      const alertId   = `exp_${batch.id}`;
      const message   = isExpired
        ? `${batch.product.name} batch EXPIRED on ${batch.expiryDate.toLocaleDateString()} (${Number(batch.qty)} units at ${batch.warehouse.name})`
        : `${batch.product.name} expires in ${daysLeft} day(s) (${Number(batch.qty)} units at ${batch.warehouse.name})`;

      await saveAlert(
        alertId,
        {
          type,
          severity,
          productId:   batch.productId,
          warehouseId: batch.warehouseId,
          qty:         Number(batch.qty),
          threshold:   settings.alertExpiryDays ?? 30,
          expiryDate:  batch.expiryDate,
          message,
        },
        {
          qty:         Number(batch.qty),
          severity,
          type,
          expiryDate:  batch.expiryDate,
          message,
          updatedAt:   now,
          isDismissed: false,
        },
      );
    }
  }

  logger.info('Stock alerts generated');
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const alertsService = {

  getAlerts: async (filters?: {
    type?: string;
    severity?: string;
    isRead?: boolean;
    page?: number;
    pageSize?: number;
  }) => {
    await generateAlerts();

    const where: Prisma.StockAlertWhereInput = { isDismissed: false };
    if (filters?.type)               where.type     = filters.type;
    if (filters?.severity)           where.severity = filters.severity;
    if (filters?.isRead !== undefined) where.isRead  = filters.isRead;

    const page     = filters?.page     ?? 1;
    const pageSize = filters?.pageSize ?? 50;

    const [items, total, unreadCount, criticalCount] = await Promise.all([
      prisma.stockAlert.findMany({
        where,
        include: {
          product:   { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true } },
        },
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.stockAlert.count({ where }),
      prisma.stockAlert.count({ where: { ...where, isRead: false } }),
      prisma.stockAlert.count({ where: { ...where, severity: 'CRITICAL' } }),
    ]);

    return { items, total, unreadCount, criticalCount, page, pageSize };
  },

  getUnreadCount: async () => {
    await generateAlerts();
    const [count, critical] = await Promise.all([
      prisma.stockAlert.count({ where: { isRead: false, isDismissed: false } }),
      prisma.stockAlert.count({ where: { isRead: false, isDismissed: false, severity: 'CRITICAL' } }),
    ]);
    return { count, critical };
  },

  markRead: async (ids: string[]) => {
    await prisma.stockAlert.updateMany({
      where: { id: { in: ids } },
      data:  { isRead: true },
    });
  },

  markAllRead: async () => {
    await prisma.stockAlert.updateMany({
      where: { isRead: false, isDismissed: false },
      data:  { isRead: true },
    });
  },

  dismiss: async (id: string) => {
    await prisma.stockAlert.update({ where: { id }, data: { isDismissed: true } });
  },

  dismissAll: async (type?: string) => {
    const where: Prisma.StockAlertWhereInput = {};
    if (type) where.type = type;
    await prisma.stockAlert.updateMany({ where, data: { isDismissed: true } });
  },
};
