import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { pointsForAmount } from './loyalty.calc.js';
import type { UpdateLoyaltyConfigInput, AdjustPointsInput } from './loyalty.schema.js';

const CONFIG_ID = 'singleton';

export const loyaltyService = {
  /** The loyalty config (singleton, auto-created with defaults). */
  getConfig: () =>
    prisma.loyaltyConfig.upsert({ where: { id: CONFIG_ID }, update: {}, create: { id: CONFIG_ID } }),

  updateConfig: async (input: UpdateLoyaltyConfigInput) => {
    await loyaltyService.getConfig(); // ensure it exists
    const result = await prisma.loyaltyConfig.update({ where: { id: CONFIG_ID }, data: input });
    logger.info({ fields: Object.keys(input) }, 'Loyalty config updated');
    return result;
  },

  /** A customer's current balance + transaction history (newest first). */
  getCustomerLoyalty: async (customerId: string) => {
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, loyaltyPoints: true } });
    if (!customer) throw new HttpError(404, 'Customer not found');
    const transactions = await prisma.loyaltyTransaction.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { sale: { select: { number: true } } },
    });
    return { balance: customer.loyaltyPoints, transactions };
  },

  /** Manual admin adjustment (+/- points) with a ledger entry. Balance floored at 0. */
  adjust: async (customerId: string, input: AdjustPointsInput) => {
    return prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { loyaltyPoints: true } });
      if (!customer) throw new HttpError(404, 'Customer not found');
      const before = customer.loyaltyPoints;
      const after = Math.max(0, before + input.points);
      await tx.customer.update({ where: { id: customerId }, data: { loyaltyPoints: after } });
      await tx.loyaltyTransaction.create({
        data: { customerId, type: 'ADJUST', points: after - before, balanceBefore: before, balanceAfter: after, note: input.note ?? null },
      });
      return { balance: after };
    });
  },

  /**
   * Record loyalty for a completed sale, inside the checkout transaction. Writes
   * REDEEM (if any) then EARN ledger rows and updates the customer balance.
   * `redeemedPoints`/`earnedPoints` are pre-computed by the caller. Returns the
   * new balance. No-op when there is nothing to record.
   */
  recordForSale: async (
    tx: Prisma.TransactionClient,
    params: { customerId: string; saleId: string; redeemedPoints: number; earnedPoints: number },
  ): Promise<void> => {
    const { customerId, saleId, redeemedPoints, earnedPoints } = params;
    if (redeemedPoints <= 0 && earnedPoints <= 0) return;

    const c = await tx.customer.findUnique({ where: { id: customerId }, select: { loyaltyPoints: true } });
    let balance = c?.loyaltyPoints ?? 0;

    if (redeemedPoints > 0) {
      const before = balance;
      balance = Math.max(0, before - redeemedPoints);
      await tx.loyaltyTransaction.create({
        data: { customerId, saleId, type: 'REDEEM', points: -(before - balance), balanceBefore: before, balanceAfter: balance, note: 'Redeemed at POS' },
      });
    }
    if (earnedPoints > 0) {
      const before = balance;
      balance = before + earnedPoints;
      await tx.loyaltyTransaction.create({
        data: { customerId, saleId, type: 'EARN', points: earnedPoints, balanceBefore: before, balanceAfter: balance, note: 'Earned on purchase' },
      });
    }
    await tx.customer.update({ where: { id: customerId }, data: { loyaltyPoints: balance } });
  },
};

export { pointsForAmount };
