import type { PriceTier } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';

export type CreateTierInput = {
  name: string;
  description?: string | null;
  isDefault?: boolean;
  sortOrder?: number;
};

export type UpdateTierInput = Partial<{
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}>;

export const priceTierService = {
  /** All active tiers ordered by sortOrder, with a count of assigned customers. */
  getAllTiers: async () => {
    try {
      return await prisma.priceTier.findMany({
        where:   { isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: { _count: { select: { customers: true } } },
      });
    } catch (err) {
      logger.error(err, 'priceTierService.getAllTiers failed');
      throw err;
    }
  },

  /** Create a tier. If isDefault, unset the default flag on all other tiers. */
  createTier: async (data: CreateTierInput): Promise<PriceTier> => {
    try {
      if (!data.name?.trim()) throw new HttpError(400, 'Tier name is required');

      return await prisma.$transaction(async (tx) => {
        if (data.isDefault) {
          await tx.priceTier.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        }
        return tx.priceTier.create({
          data: {
            name:        data.name.trim(),
            description: data.description ?? null,
            isDefault:   data.isDefault ?? false,
            sortOrder:   data.sortOrder ?? 0,
          },
        });
      });
    } catch (err) {
      logger.error(err, 'priceTierService.createTier failed');
      throw err;
    }
  },

  /** Surgical update. If isDefault becomes true, unset other defaults. */
  updateTier: async (id: string, data: UpdateTierInput): Promise<PriceTier> => {
    try {
      const existing = await prisma.priceTier.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'Price tier not found');

      return await prisma.$transaction(async (tx) => {
        if (data.isDefault === true) {
          await tx.priceTier.updateMany({
            where: { isDefault: true, id: { not: id } },
            data:  { isDefault: false },
          });
        }
        return tx.priceTier.update({
          where: { id },
          data: {
            ...(data.name        !== undefined ? { name: data.name.trim() } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.isDefault   !== undefined ? { isDefault: data.isDefault } : {}),
            ...(data.isActive    !== undefined ? { isActive: data.isActive } : {}),
            ...(data.sortOrder   !== undefined ? { sortOrder: data.sortOrder } : {}),
          },
        });
      });
    } catch (err) {
      logger.error(err, 'priceTierService.updateTier failed');
      throw err;
    }
  },

  /** Soft delete (isActive=false). Blocked while customers are assigned. */
  deleteTier: async (id: string): Promise<PriceTier> => {
    try {
      const existing = await prisma.priceTier.findUnique({
        where:   { id },
        include: { _count: { select: { customers: true } } },
      });
      if (!existing) throw new HttpError(404, 'Price tier not found');
      if (existing._count.customers > 0) {
        throw new HttpError(400, 'Cannot delete tier with active customers');
      }
      return await prisma.priceTier.update({
        where: { id },
        data:  { isActive: false, isDefault: false },
      });
    } catch (err) {
      logger.error(err, 'priceTierService.deleteTier failed');
      throw err;
    }
  },

  /** Upsert a per-tier price for a product. priceCents must be positive. */
  setProductPrice: async (productId: string, tierId: string, priceCents: number) => {
    try {
      if (priceCents <= 0) throw new HttpError(400, 'priceCents must be greater than 0');

      return await prisma.productPrice.upsert({
        where:  { productId_tierId: { productId, tierId } },
        update: { priceCents },
        create: { productId, tierId, priceCents },
      });
    } catch (err) {
      logger.error(err, 'priceTierService.setProductPrice failed');
      throw err;
    }
  },

  /** All tier prices configured for a product, including the tier name. */
  getProductPrices: async (productId: string) => {
    try {
      const prices = await prisma.productPrice.findMany({
        where:   { productId },
        include: { tier: { select: { id: true, name: true, isActive: true } } },
      });
      return prices.map((p) => ({
        id:         p.id,
        productId:  p.productId,
        tierId:     p.tierId,
        tierName:   p.tier.name,
        priceCents: p.priceCents,
      }));
    } catch (err) {
      logger.error(err, 'priceTierService.getProductPrices failed');
      throw err;
    }
  },

  /**
   * The price a specific customer should pay for a product. If the customer is
   * on a tier and a tier price exists, returns it; otherwise the product's
   * default priceCents. This is the function POS uses at checkout.
   */
  getPriceForCustomer: async (productId: string, customerId: string): Promise<number> => {
    try {
      const product = await prisma.product.findUnique({
        where:  { id: productId },
        select: { priceCents: true },
      });
      if (!product) throw new HttpError(404, 'Product not found');

      const customer = await prisma.customer.findUnique({
        where:  { id: customerId },
        select: { priceTierId: true },
      });
      if (!customer?.priceTierId) return product.priceCents;

      const tierPrice = await prisma.productPrice.findUnique({
        where:  { productId_tierId: { productId, tierId: customer.priceTierId } },
        select: { priceCents: true },
      });
      return tierPrice ? tierPrice.priceCents : product.priceCents;
    } catch (err) {
      logger.error(err, 'priceTierService.getPriceForCustomer failed');
      throw err;
    }
  },

  /** Assign (or clear, with null) a customer's price tier. */
  setCustomerTier: async (customerId: string, tierId: string | null) => {
    try {
      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!customer) throw new HttpError(404, 'Customer not found');

      if (tierId) {
        const tier = await prisma.priceTier.findUnique({ where: { id: tierId } });
        if (!tier || !tier.isActive) throw new HttpError(404, 'Price tier not found');
      }

      return await prisma.customer.update({
        where: { id: customerId },
        data:  { priceTierId: tierId },
      });
    } catch (err) {
      logger.error(err, 'priceTierService.setCustomerTier failed');
      throw err;
    }
  },
};
