import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import { z } from 'zod';

export const conversionLineSchema = z.object({
  fromUnitId:    z.string().min(1),
  toUnitId:      z.string().min(1),
  conversionQty: z.number().positive('Conversion quantity must be greater than 0'),
  priceCents:    z.number().int().min(0).optional().nullable(),
  barcode:       z.string().optional().nullable(),
});

export type ConversionLineInput = z.infer<typeof conversionLineSchema>;

export const productConversionsService = {

  async getConversions(productId: string) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new HttpError(404, 'Product not found');

    return prisma.productUnitConversion.findMany({
      where: { productId, isActive: true },
      include: {
        fromUnit: { select: { id: true, name: true, shortCode: true } },
        toUnit:   { select: { id: true, name: true, shortCode: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  },

  async setConversions(productId: string, conversions: ConversionLineInput[]) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new HttpError(404, 'Product not found');

    // Validate: fromUnit ≠ toUnit
    for (const c of conversions) {
      if (c.fromUnitId === c.toUnitId) {
        throw new HttpError(400, 'From unit and To unit cannot be the same');
      }
    }

    // Validate: no duplicate fromUnit+toUnit pairs in the request
    const pairs = conversions.map((c) => `${c.fromUnitId}:${c.toUnitId}`);
    const uniquePairs = new Set(pairs);
    if (uniquePairs.size !== pairs.length) {
      throw new HttpError(400, 'Duplicate from→to unit pairs are not allowed on the same product');
    }

    // Validate: referenced units exist
    const unitIds = [...new Set([...conversions.map((c) => c.fromUnitId), ...conversions.map((c) => c.toUnitId)])];
    const units = await prisma.unit.findMany({ where: { id: { in: unitIds } } });
    if (units.length !== unitIds.length) {
      throw new HttpError(400, 'One or more referenced units do not exist');
    }

    return prisma.$transaction(async (tx) => {
      // Replace all conversions atomically
      await tx.productUnitConversion.deleteMany({ where: { productId } });

      if (conversions.length === 0) return [];

      await tx.productUnitConversion.createMany({
        data: conversions.map((c) => ({
          productId,
          fromUnitId:    c.fromUnitId,
          toUnitId:      c.toUnitId,
          conversionQty: c.conversionQty,
          priceCents:    c.priceCents ?? null,
          barcode:       c.barcode || null,
          isActive:      true,
        })),
      });

      return tx.productUnitConversion.findMany({
        where: { productId },
        include: {
          fromUnit: { select: { id: true, name: true, shortCode: true } },
          toUnit:   { select: { id: true, name: true, shortCode: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
    });
  },
};
