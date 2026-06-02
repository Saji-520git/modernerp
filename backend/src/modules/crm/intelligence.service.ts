import type { CustomerInteraction } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { loyaltyService } from './loyalty.service.js';

export type SpendPeriod = 'all' | '30d' | '90d' | '1y';

export type InteractionType = 'NOTE' | 'CALL' | 'VISIT' | 'PAYMENT_REMINDER' | 'OTHER';

export type AddInteractionInput = {
  customerId: string;
  type: InteractionType;
  note: string;
  followUpAt?: Date | null;
  createdBy: string;
};

const CONFIRMED_SALE = { status: 'CONFIRMED' as const, deletedAt: null };

/** Returns the cutoff Date for a spend period, or null for 'all'. */
function periodSince(period: SpendPeriod): Date | null {
  if (period === 'all') return null;
  const days = period === '30d' ? 30 : period === '90d' ? 90 : 365;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export const intelligenceService = {
  /** Customers ranked by total confirmed spend over the given period. */
  getTopCustomers: async (limit = 10, period: SpendPeriod = 'all') => {
    try {
      const since = periodSince(period);
      const grouped = await prisma.sale.groupBy({
        by: ['customerId'],
        where: {
          ...CONFIRMED_SALE,
          customerId: { not: null },
          ...(since ? { date: { gte: since } } : {}),
        },
        _sum: { totalCents: true },
        _count: { _all: true },
        _max: { date: true },
        orderBy: { _sum: { totalCents: 'desc' } },
        take: limit,
      });

      const ids = grouped.map((g) => g.customerId as string);
      const customers = await prisma.customer.findMany({
        where:  { id: { in: ids } },
        select: { id: true, name: true, loyaltyPoints: true },
      });
      const byId = new Map(customers.map((c) => [c.id, c]));

      return grouped.map((g) => {
        const c = byId.get(g.customerId as string);
        return {
          customerId:    g.customerId as string,
          name:          c?.name ?? 'Unknown',
          totalSpent:    g._sum.totalCents ?? 0,
          orderCount:    g._count._all,
          lastPurchase:  g._max.date,
          loyaltyPoints: c?.loyaltyPoints ?? 0,
        };
      });
    } catch (err) {
      logger.error(err, 'intelligenceService.getTopCustomers failed');
      throw err;
    }
  },

  /** Active customers whose most recent purchase is older than daysSince days. */
  getInactiveCustomers: async (daysSince = 30) => {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - daysSince);

      // Last purchase + lifetime spend per customer (confirmed sales only).
      const grouped = await prisma.sale.groupBy({
        by: ['customerId'],
        where: { ...CONFIRMED_SALE, customerId: { not: null } },
        _sum: { totalCents: true },
        _max: { date: true },
      });

      const stale = grouped.filter((g) => g._max.date !== null && (g._max.date as Date) < cutoff);
      const ids = stale.map((g) => g.customerId as string);
      if (ids.length === 0) return [];

      const customers = await prisma.customer.findMany({
        where:  { id: { in: ids }, isActive: true },
        select: { id: true, name: true },
      });
      const byId = new Map(customers.map((c) => [c.id, c]));

      return stale
        .filter((g) => byId.has(g.customerId as string))
        .map((g) => ({
          customerId:   g.customerId as string,
          name:         byId.get(g.customerId as string)!.name,
          lastPurchase: g._max.date as Date,
          totalSpent:   g._sum.totalCents ?? 0,
        }))
        .sort((a, b) => b.lastPurchase.getTime() - a.lastPurchase.getTime());
    } catch (err) {
      logger.error(err, 'intelligenceService.getInactiveCustomers failed');
      throw err;
    }
  },

  /** Full purchase profile for a single customer. */
  getCustomerStats: async (customerId: string) => {
    try {
      const customer = await prisma.customer.findUnique({
        where:  { id: customerId },
        select: { id: true, name: true, loyaltyPoints: true },
      });
      if (!customer) throw new HttpError(404, 'Customer not found');

      const agg = await prisma.sale.aggregate({
        where: { ...CONFIRMED_SALE, customerId },
        _sum:  { totalCents: true },
        _count: { _all: true },
        _max:  { date: true },
        _min:  { date: true },
      });

      const totalSpent  = agg._sum.totalCents ?? 0;
      const orderCount  = agg._count._all;
      const averageOrderValue = orderCount > 0 ? Math.round(totalSpent / orderCount) : 0;

      // Top 3 products by line frequency.
      const favGrouped = await prisma.saleLine.groupBy({
        by: ['productId'],
        where: { sale: { ...CONFIRMED_SALE, customerId } },
        _count: { _all: true },
        orderBy: { _count: { productId: 'desc' } },
        take: 3,
      });
      const favIds = favGrouped.map((f) => f.productId);
      const favProducts = await prisma.product.findMany({
        where:  { id: { in: favIds } },
        select: { id: true, name: true },
      });
      const favById = new Map(favProducts.map((p) => [p.id, p.name]));
      const favoriteProducts = favGrouped.map((f) => ({
        productId: f.productId,
        name:      favById.get(f.productId) ?? 'Unknown',
        count:     f._count._all,
      }));

      // Payment behaviour from confirmed sales' payment methods.
      const [creditCount, totalCount] = await Promise.all([
        prisma.sale.count({ where: { ...CONFIRMED_SALE, customerId, paymentMethod: 'CREDIT' } }),
        prisma.sale.count({ where: { ...CONFIRMED_SALE, customerId } }),
      ]);
      const paymentBehavior =
        totalCount === 0 || creditCount === 0 ? 'always_cash'
        : creditCount === totalCount          ? 'always_credit'
        :                                       'sometimes_credit';

      const config = await loyaltyService.getLoyaltyConfig();

      return {
        customerId:       customer.id,
        name:             customer.name,
        totalSpent,
        orderCount,
        averageOrderValue,
        lastPurchase:     agg._max.date,
        firstPurchase:    agg._min.date,
        favoriteProducts,
        paymentBehavior,
        loyaltyPoints:    customer.loyaltyPoints,
        loyaltyValueCents: loyaltyService.calculateRedemptionValue(customer.loyaltyPoints, config),
      };
    } catch (err) {
      logger.error(err, 'intelligenceService.getCustomerStats failed');
      throw err;
    }
  },

  /** High-level KPIs for the business owner's CRM dashboard. */
  getOwnerDashboard: async () => {
    try {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const riskCutoff = new Date();
      riskCutoff.setDate(riskCutoff.getDate() - 30);

      const [
        totalCustomers,
        newThisMonth,
        loyaltyAgg,
        config,
        topMonthGroup,
        creditAgg,
        saleMaxByCustomer,
      ] = await Promise.all([
        prisma.customer.count({ where: { isActive: true } }),
        prisma.customer.count({ where: { isActive: true, createdAt: { gte: monthStart } } }),
        prisma.customer.aggregate({ _sum: { loyaltyPoints: true } }),
        loyaltyService.getLoyaltyConfig(),
        prisma.sale.groupBy({
          by: ['customerId'],
          where: { ...CONFIRMED_SALE, customerId: { not: null }, date: { gte: monthStart } },
          _sum: { totalCents: true },
          orderBy: { _sum: { totalCents: 'desc' } },
          take: 1,
        }),
        prisma.sale.aggregate({
          where: { ...CONFIRMED_SALE, paymentStatus: { in: ['UNPAID', 'PARTIAL'] } },
          _sum:  { totalCents: true, paidCents: true },
        }),
        prisma.sale.groupBy({
          by: ['customerId'],
          where: { ...CONFIRMED_SALE, customerId: { not: null } },
          _max: { date: true },
        }),
      ]);

      // Top spender this month — resolve name.
      let topSpenderThisMonth: { name: string; amount: number } | null = null;
      if (topMonthGroup.length > 0 && topMonthGroup[0].customerId) {
        const c = await prisma.customer.findUnique({
          where:  { id: topMonthGroup[0].customerId },
          select: { name: true },
        });
        topSpenderThisMonth = {
          name:   c?.name ?? 'Unknown',
          amount: topMonthGroup[0]._sum.totalCents ?? 0,
        };
      }

      const totalLoyaltyPointsOutstanding = loyaltyAgg._sum.loyaltyPoints ?? 0;
      const loyaltyLiabilityCents = totalLoyaltyPointsOutstanding * config.pointValueCents;
      const creditExposureCents =
        (creditAgg._sum.totalCents ?? 0) - (creditAgg._sum.paidCents ?? 0);
      const customersAtRisk = saleMaxByCustomer.filter(
        (g) => g._max.date !== null && (g._max.date as Date) < riskCutoff,
      ).length;

      return {
        totalCustomers,
        newThisMonth,
        topSpenderThisMonth,
        totalLoyaltyPointsOutstanding,
        loyaltyLiabilityCents,
        customersAtRisk,
        creditExposureCents,
      };
    } catch (err) {
      logger.error(err, 'intelligenceService.getOwnerDashboard failed');
      throw err;
    }
  },

  /** Log a customer interaction (note, call, visit, reminder). */
  addInteraction: async (data: AddInteractionInput): Promise<CustomerInteraction> => {
    try {
      if (!data.note?.trim()) throw new HttpError(400, 'Interaction note is required');
      const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
      if (!customer) throw new HttpError(404, 'Customer not found');

      return await prisma.customerInteraction.create({
        data: {
          customerId: data.customerId,
          type:       data.type,
          note:       data.note.trim(),
          followUpAt: data.followUpAt ?? null,
          createdBy:  data.createdBy,
        },
      });
    } catch (err) {
      logger.error(err, 'intelligenceService.addInteraction failed');
      throw err;
    }
  },

  /** All interactions for a customer, newest first. */
  getInteractions: async (customerId: string): Promise<CustomerInteraction[]> => {
    try {
      return await prisma.customerInteraction.findMany({
        where:   { customerId },
        orderBy: { createdAt: 'desc' },
      });
    } catch (err) {
      logger.error(err, 'intelligenceService.getInteractions failed');
      throw err;
    }
  },

  /** Mark a follow-up as done. */
  markFollowUpDone: async (interactionId: string): Promise<CustomerInteraction> => {
    try {
      const existing = await prisma.customerInteraction.findUnique({ where: { id: interactionId } });
      if (!existing) throw new HttpError(404, 'Interaction not found');
      return await prisma.customerInteraction.update({
        where: { id: interactionId },
        data:  { isDone: true },
      });
    } catch (err) {
      logger.error(err, 'intelligenceService.markFollowUpDone failed');
      throw err;
    }
  },

  /** Pending (not done) follow-ups that are due now or overdue, soonest first. */
  getPendingFollowUps: async () => {
    try {
      return await prisma.customerInteraction.findMany({
        where: {
          isDone:     false,
          followUpAt: { not: null, lte: new Date() },
        },
        orderBy: { followUpAt: 'asc' },
        include: { customer: { select: { id: true, name: true } } },
      });
    } catch (err) {
      logger.error(err, 'intelligenceService.getPendingFollowUps failed');
      throw err;
    }
  },
};
