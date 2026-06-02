import type { LoyaltyConfig, LoyaltyTransaction } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';

const CONFIG_ID = 'singleton';

// Sensible defaults — mirror the Prisma model defaults. Used when no config row
// exists yet (first read creates it).
const DEFAULT_CONFIG = {
  isEnabled:       true,
  pointsPerAmount: 100,
  amountPerPoint:  100,
  minRedeemPoints: 100,
  pointValueCents: 100,
  expiryDays:      null as number | null,
};

export type UpdateLoyaltyConfigInput = Partial<{
  isEnabled: boolean;
  pointsPerAmount: number;
  amountPerPoint: number;
  minRedeemPoints: number;
  pointValueCents: number;
  expiryDays: number | null;
}>;

export const loyaltyService = {
  /** Returns the singleton LoyaltyConfig, creating it with defaults if absent. */
  getLoyaltyConfig: async (): Promise<LoyaltyConfig> => {
    try {
      return await prisma.loyaltyConfig.upsert({
        where:  { id: CONFIG_ID },
        update: {},
        create: { id: CONFIG_ID, ...DEFAULT_CONFIG },
      });
    } catch (err) {
      logger.error(err, 'loyaltyService.getLoyaltyConfig failed');
      throw err;
    }
  },

  /** Upserts the singleton config. Validates positive earn/value settings. */
  updateLoyaltyConfig: async (data: UpdateLoyaltyConfigInput): Promise<LoyaltyConfig> => {
    try {
      if (data.pointsPerAmount !== undefined && data.pointsPerAmount <= 0) {
        throw new HttpError(400, 'pointsPerAmount must be greater than 0');
      }
      if (data.amountPerPoint !== undefined && data.amountPerPoint <= 0) {
        throw new HttpError(400, 'amountPerPoint must be greater than 0');
      }
      if (data.pointValueCents !== undefined && data.pointValueCents <= 0) {
        throw new HttpError(400, 'pointValueCents must be greater than 0');
      }
      if (data.minRedeemPoints !== undefined && data.minRedeemPoints < 0) {
        throw new HttpError(400, 'minRedeemPoints cannot be negative');
      }

      const updated = await prisma.loyaltyConfig.upsert({
        where:  { id: CONFIG_ID },
        update: data,
        create: { id: CONFIG_ID, ...DEFAULT_CONFIG, ...data },
      });
      logger.info({ changed: Object.keys(data) }, 'Loyalty config updated');
      return updated;
    } catch (err) {
      logger.error(err, 'loyaltyService.updateLoyaltyConfig failed');
      throw err;
    }
  },

  /** Points earned for a spend: floor(totalCents / amountPerPoint). */
  calculatePointsEarned: (totalCents: number, config: LoyaltyConfig): number => {
    if (config.amountPerPoint <= 0) return 0;
    return Math.floor(totalCents / config.amountPerPoint);
  },

  /** Cash value (cents) of a points balance: points * pointValueCents. */
  calculateRedemptionValue: (points: number, config: LoyaltyConfig): number => {
    return points * config.pointValueCents;
  },

  /**
   * Award points for a sale. Creates an EARN transaction, bumps the customer
   * balance, and records pointsEarned on the sale. Atomic. No-op (returns null)
   * when loyalty is disabled or the spend earns zero points.
   */
  earnPoints: async (
    customerId: string,
    saleId: string,
    totalCents: number,
  ): Promise<LoyaltyTransaction | null> => {
    try {
      const config = await loyaltyService.getLoyaltyConfig();
      if (!config.isEnabled) return null;

      const points = loyaltyService.calculatePointsEarned(totalCents, config);
      if (points <= 0) return null;

      return await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id: customerId } });
        if (!customer) throw new HttpError(404, 'Customer not found');

        const balanceBefore = customer.loyaltyPoints;
        const balanceAfter  = balanceBefore + points;

        const txn = await tx.loyaltyTransaction.create({
          data: {
            customerId,
            saleId,
            type: 'EARN',
            points,
            balanceBefore,
            balanceAfter,
            note: `Earned on sale`,
          },
        });

        await tx.customer.update({
          where: { id: customerId },
          data:  { loyaltyPoints: balanceAfter },
        });

        await tx.sale.update({
          where: { id: saleId },
          data:  { pointsEarned: points },
        }).catch(() => undefined); // sale row should exist; never fail the earn over this

        return txn;
      });
    } catch (err) {
      logger.error(err, 'loyaltyService.earnPoints failed');
      throw err;
    }
  },

  /**
   * Redeem points for cash value. Validates the customer has enough points and
   * that the amount meets the configured minimum. Returns the transaction plus
   * the cash value (cents) the redemption is worth.
   */
  redeemPoints: async (
    customerId: string,
    points: number,
    saleId?: string,
  ): Promise<{ transaction: LoyaltyTransaction; valueCents: number }> => {
    try {
      if (points <= 0) throw new HttpError(400, 'Points to redeem must be greater than 0');

      const config = await loyaltyService.getLoyaltyConfig();
      if (!config.isEnabled) throw new HttpError(400, 'Loyalty program is disabled');
      if (points < config.minRedeemPoints) {
        throw new HttpError(400, `Minimum ${config.minRedeemPoints} points required to redeem`);
      }

      const valueCents = loyaltyService.calculateRedemptionValue(points, config);

      const transaction = await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id: customerId } });
        if (!customer) throw new HttpError(404, 'Customer not found');
        if (customer.loyaltyPoints < points) {
          throw new HttpError(400, `Insufficient points. Balance: ${customer.loyaltyPoints}, requested: ${points}`);
        }

        const balanceBefore = customer.loyaltyPoints;
        const balanceAfter  = balanceBefore - points;

        const txn = await tx.loyaltyTransaction.create({
          data: {
            customerId,
            saleId: saleId ?? null,
            type: 'REDEEM',
            points: -points,
            balanceBefore,
            balanceAfter,
            note: `Redeemed for Rs. ${(valueCents / 100).toFixed(2)}`,
          },
        });

        await tx.customer.update({
          where: { id: customerId },
          data:  { loyaltyPoints: balanceAfter },
        });

        if (saleId) {
          await tx.sale.update({
            where: { id: saleId },
            data:  { pointsRedeemed: points },
          }).catch(() => undefined);
        }

        return txn;
      });

      return { transaction, valueCents };
    } catch (err) {
      logger.error(err, 'loyaltyService.redeemPoints failed');
      throw err;
    }
  },

  /**
   * Manual balance adjustment (positive or negative). Result must not go below
   * zero. Used by admins to correct balances or grant goodwill points.
   */
  adjustPoints: async (
    customerId: string,
    points: number,
    note: string,
  ): Promise<LoyaltyTransaction> => {
    try {
      if (points === 0) throw new HttpError(400, 'Adjustment cannot be zero');
      if (!note?.trim()) throw new HttpError(400, 'A note is required for manual adjustments');

      return await prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id: customerId } });
        if (!customer) throw new HttpError(404, 'Customer not found');

        const balanceBefore = customer.loyaltyPoints;
        const balanceAfter  = balanceBefore + points;
        if (balanceAfter < 0) {
          throw new HttpError(400, `Adjustment would result in a negative balance (${balanceAfter})`);
        }

        const txn = await tx.loyaltyTransaction.create({
          data: {
            customerId,
            type: 'ADJUST',
            points,
            balanceBefore,
            balanceAfter,
            note: note.trim(),
          },
        });

        await tx.customer.update({
          where: { id: customerId },
          data:  { loyaltyPoints: balanceAfter },
        });

        return txn;
      });
    } catch (err) {
      logger.error(err, 'loyaltyService.adjustPoints failed');
      throw err;
    }
  },

  /**
   * Returns a customer's loyalty balance, the cash value of that balance, and
   * their 20 most recent transactions.
   */
  getCustomerLoyalty: async (customerId: string) => {
    try {
      const customer = await prisma.customer.findUnique({
        where:  { id: customerId },
        select: { id: true, name: true, loyaltyPoints: true },
      });
      if (!customer) throw new HttpError(404, 'Customer not found');

      const config = await loyaltyService.getLoyaltyConfig();
      const transactions = await prisma.loyaltyTransaction.findMany({
        where:   { customerId },
        orderBy: { createdAt: 'desc' },
        take:    20,
      });

      return {
        customerId:    customer.id,
        customerName:  customer.name,
        loyaltyPoints: customer.loyaltyPoints,
        pointValueCents: config.pointValueCents,
        valueCents:    loyaltyService.calculateRedemptionValue(customer.loyaltyPoints, config),
        minRedeemPoints: config.minRedeemPoints,
        isEnabled:     config.isEnabled,
        transactions,
      };
    } catch (err) {
      logger.error(err, 'loyaltyService.getCustomerLoyalty failed');
      throw err;
    }
  },
};
