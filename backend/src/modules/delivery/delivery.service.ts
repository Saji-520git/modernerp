import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateDeliveryInput {
  saleId?: string | null;
  quotationId?: string | null;
  customerId?: string | null;
  scheduledAt?: Date | null;
  address: string;
  contactName?: string | null;
  contactPhone?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  note?: string | null;
  createdById: string;
}

export interface UpdateDeliveryInput {
  scheduledAt?: Date | null;
  address?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  note?: string | null;
}

export interface DeliveryFilters {
  status?: string;
  customerId?: string;
  driverName?: string;
  from?: Date;
  to?: Date;
  search?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** DEL-2026-0001 — sequential per year. */
async function generateDeliveryNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `DEL-${year}-`;
  const last = await prisma.delivery.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { createdAt: 'desc' },
    select: { number: true },
  });
  let next = 1;
  if (last) {
    const parsed = parseInt(last.number.slice(prefix.length), 10);
    if (Number.isInteger(parsed)) next = parsed + 1;
    else next = (await prisma.delivery.count({ where: { number: { startsWith: prefix } } })) + 1;
  }
  return `${prefix}${String(next).padStart(4, '0')}`;
}

const fullInclude = {
  customer: { select: { id: true, name: true } },
  sale: { select: { id: true, number: true } },
  quotation: { select: { id: true, number: true } },
  createdBy: { select: { fullName: true } },
} satisfies Prisma.DeliveryInclude;

// Allowed delivery status transitions.
const DELIVERY_TRANSITIONS: Record<string, string[]> = {
  PENDING:          ['ASSIGNED', 'CANCELLED'],
  ASSIGNED:         ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  DELIVERED:        [],
  FAILED:           [],
  CANCELLED:        [],
};

const LOCKED_STATUSES = ['DELIVERED', 'CANCELLED', 'FAILED'];

// ─── Service ────────────────────────────────────────────────────────────────

export const deliveryService = {
  getAllDeliveries: async (filters: DeliveryFilters = {}) => {
    try {
      const where: Prisma.DeliveryWhereInput = { deletedAt: null };
      if (filters.status) where.status = filters.status;
      if (filters.customerId) where.customerId = filters.customerId;
      if (filters.driverName) where.driverName = { contains: filters.driverName, mode: 'insensitive' };
      if (filters.from || filters.to) {
        where.scheduledAt = {};
        if (filters.from) where.scheduledAt.gte = filters.from;
        if (filters.to) where.scheduledAt.lte = filters.to;
      }
      if (filters.search) {
        where.OR = [
          { number: { contains: filters.search, mode: 'insensitive' } },
          { address: { contains: filters.search, mode: 'insensitive' } },
          { contactName: { contains: filters.search, mode: 'insensitive' } },
          { customer: { name: { contains: filters.search, mode: 'insensitive' } } },
        ];
      }
      return await prisma.delivery.findMany({
        where,
        orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        include: fullInclude,
      });
    } catch (err) {
      logger.error(err, 'deliveryService.getAllDeliveries failed');
      throw err;
    }
  },

  getDeliveryById: async (id: string) => {
    try {
      const delivery = await prisma.delivery.findFirst({
        where: { id, deletedAt: null },
        include: fullInclude,
      });
      if (!delivery) throw new HttpError(404, 'Delivery not found');
      return delivery;
    } catch (err) {
      logger.error(err, 'deliveryService.getDeliveryById failed');
      throw err;
    }
  },

  createDelivery: async (data: CreateDeliveryInput) => {
    try {
      if (!data.address || !data.address.trim()) {
        throw new HttpError(400, 'Delivery address is required');
      }
      if (data.customerId) {
        const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
        if (!customer) throw new HttpError(400, 'Customer not found');
      }
      if (data.saleId) {
        const existing = await prisma.delivery.findUnique({ where: { saleId: data.saleId } });
        if (existing) throw new HttpError(400, 'This sale already has a delivery');
      }

      const number = await generateDeliveryNumber();
      const created = await prisma.delivery.create({
        data: {
          number,
          saleId: data.saleId ?? null,
          quotationId: data.quotationId ?? null,
          customerId: data.customerId ?? null,
          status: 'PENDING',
          scheduledAt: data.scheduledAt ?? null,
          address: data.address.trim(),
          contactName: data.contactName ?? null,
          contactPhone: data.contactPhone ?? null,
          driverName: data.driverName ?? null,
          driverPhone: data.driverPhone ?? null,
          note: data.note ?? null,
          createdById: data.createdById,
        },
        include: fullInclude,
      });
      logger.info({ deliveryId: created.id, number }, 'Delivery created');
      return created;
    } catch (err) {
      logger.error(err, 'deliveryService.createDelivery failed');
      throw err;
    }
  },

  updateDelivery: async (id: string, data: UpdateDeliveryInput) => {
    try {
      const existing = await prisma.delivery.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new HttpError(404, 'Delivery not found');
      if (LOCKED_STATUSES.includes(existing.status)) {
        throw new HttpError(400, `A ${existing.status.toLowerCase()} delivery cannot be edited`);
      }
      if (data.address !== undefined && !data.address.trim()) {
        throw new HttpError(400, 'Delivery address cannot be empty');
      }

      const fields: Prisma.DeliveryUpdateInput = {};
      if (data.scheduledAt !== undefined) fields.scheduledAt = data.scheduledAt;
      if (data.address !== undefined) fields.address = data.address.trim();
      if (data.contactName !== undefined) fields.contactName = data.contactName;
      if (data.contactPhone !== undefined) fields.contactPhone = data.contactPhone;
      if (data.driverName !== undefined) fields.driverName = data.driverName;
      if (data.driverPhone !== undefined) fields.driverPhone = data.driverPhone;
      if (data.note !== undefined) fields.note = data.note;

      const updated = await prisma.delivery.update({ where: { id }, data: fields, include: fullInclude });
      logger.info({ deliveryId: id }, 'Delivery updated');
      return updated;
    } catch (err) {
      logger.error(err, 'deliveryService.updateDelivery failed');
      throw err;
    }
  },

  updateStatus: async (id: string, status: string) => {
    try {
      const existing = await prisma.delivery.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new HttpError(404, 'Delivery not found');

      const allowed = DELIVERY_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(status)) {
        throw new HttpError(400, `Invalid status transition: ${existing.status} → ${status}`);
      }

      const fields: Prisma.DeliveryUpdateInput = { status };
      if (status === 'DELIVERED') fields.deliveredAt = new Date();

      const updated = await prisma.delivery.update({ where: { id }, data: fields, include: fullInclude });
      logger.info({ deliveryId: id, from: existing.status, to: status }, 'Delivery status updated');
      return updated;
    } catch (err) {
      logger.error(err, 'deliveryService.updateStatus failed');
      throw err;
    }
  },

  getDeliveryStats: async () => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - 6);

      const todayWhere: Prisma.DeliveryWhereInput = { deletedAt: null, createdAt: { gte: todayStart } };
      const [pending, assigned, outForDelivery, delivered] = await Promise.all([
        prisma.delivery.count({ where: { ...todayWhere, status: 'PENDING' } }),
        prisma.delivery.count({ where: { ...todayWhere, status: 'ASSIGNED' } }),
        prisma.delivery.count({ where: { ...todayWhere, status: 'OUT_FOR_DELIVERY' } }),
        prisma.delivery.count({ where: { ...todayWhere, status: 'DELIVERED' } }),
      ]);

      const weekDelivered = await prisma.delivery.findMany({
        where: { deletedAt: null, status: 'DELIVERED', deliveredAt: { gte: weekStart } },
        select: { scheduledAt: true, deliveredAt: true },
      });
      const totalDelivered = weekDelivered.length;
      const onTime = weekDelivered.filter(
        (d) => d.scheduledAt && d.deliveredAt && d.deliveredAt <= d.scheduledAt,
      ).length;
      const onTimeRate = totalDelivered > 0 ? Math.round((onTime / totalDelivered) * 1000) / 10 : 0;

      return {
        today: { pending, assigned, outForDelivery, delivered },
        thisWeek: { delivered: totalDelivered },
        onTimeRate,
      };
    } catch (err) {
      logger.error(err, 'deliveryService.getDeliveryStats failed');
      throw err;
    }
  },

  getPendingDeliveries: async () => {
    try {
      return await prisma.delivery.findMany({
        where: { deletedAt: null, status: { in: ['PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY'] } },
        orderBy: [{ scheduledAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        include: fullInclude,
      });
    } catch (err) {
      logger.error(err, 'deliveryService.getPendingDeliveries failed');
      throw err;
    }
  },
};
