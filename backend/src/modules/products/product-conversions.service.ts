import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import { logger } from '../../config/logger.js';
import { z } from 'zod';

export const conversionLineSchema = z.object({
  fromUnitId:    z.string().min(1),
  toUnitId:      z.string().min(1),
  conversionQty: z.number().positive('Conversion quantity must be greater than 0'),
  priceCents:    z.number().int().min(0).optional().nullable(),
  discountType:  z.enum(['amount', 'percent']).optional().nullable(),
  discountValue: z.number().min(0).optional().nullable(),
  barcode:       z.string().optional().nullable(),
}).refine(
  (c) => !(c.discountType === 'percent' && c.discountValue != null && c.discountValue > 100),
  { message: 'Percent discount cannot exceed 100', path: ['discountValue'] },
);

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
      // ─────────────────────────────────────────────────────────────
      // v1.0.69 cost-entry-unit recalc
      // If this edit changes the conversion factor for the unit the
      // user originally entered the cost in, recompute costCents to
      // preserve the displayed cost-per-entry-unit (D6 policy:
      // preserve user intent). costCents stays per-base-unit; only
      // its value shifts so that costCents × factor remains constant.
      // ─────────────────────────────────────────────────────────────
      const productForRecalc = await tx.product.findUnique({
        where: { id: productId },
        select: {
          id:              true,
          costCents:       true,
          costEntryUnitId: true,
          baseUnitId:      true,
          unitId:          true,
        },
      });

      if (productForRecalc) {
        const effectiveBaseUnitId = productForRecalc.baseUnitId ?? productForRecalc.unitId;
        const entryUnitId = productForRecalc.costEntryUnitId;

        const needsRecalcCheck =
          entryUnitId != null &&
          entryUnitId !== effectiveBaseUnitId &&
          productForRecalc.costCents > 0;

        if (needsRecalcCheck) {
          const oldConv = await tx.productUnitConversion.findFirst({
            where: {
              productId,
              fromUnitId: entryUnitId,
              toUnitId:   effectiveBaseUnitId,
              isActive:   true,
            },
            select: { conversionQty: true },
          });

          if (oldConv) {
            const newConvLine = conversions.find(
              (c) => c.fromUnitId === entryUnitId && c.toUnitId === effectiveBaseUnitId,
            );

            if (!newConvLine) {
              // User is removing the entry-unit's conversion.
              // costCents stays put. Chunk 3 load-side falls back to base display.
              logger.info(
                {
                  productId,
                  costEntryUnitId: entryUnitId,
                  baseUnitId:      effectiveBaseUnitId,
                  costCents:       productForRecalc.costCents,
                },
                '[v1.0.69 cost-recalc] entry-unit conversion removed — costCents unchanged',
              );
            } else {
              const oldFactor = oldConv.conversionQty.toNumber();
              const newFactor = newConvLine.conversionQty;

              if (oldFactor <= 0 || newFactor <= 0) {
                logger.warn(
                  {
                    productId,
                    costEntryUnitId: entryUnitId,
                    oldFactor,
                    newFactor,
                  },
                  '[v1.0.69 cost-recalc] invalid factor (<=0) — recalc skipped',
                );
              } else if (oldFactor !== newFactor) {
                const newCostCents = Math.round(
                  (productForRecalc.costCents * oldFactor) / newFactor,
                );

                if (newCostCents < 0 || newCostCents > 200_000_000_000) {
                  logger.error(
                    {
                      productId,
                      costEntryUnitId: entryUnitId,
                      oldFactor,
                      newFactor,
                      oldCostCents:  productForRecalc.costCents,
                      newCostCents,
                    },
                    '[v1.0.69 cost-recalc] computed cost outside sane range — recalc skipped',
                  );
                } else if (newCostCents !== productForRecalc.costCents) {
                  await tx.product.update({
                    where: { id: productId },
                    data:  { costCents: newCostCents },
                  });
                  logger.info(
                    {
                      productId,
                      costEntryUnitId: entryUnitId,
                      baseUnitId:      effectiveBaseUnitId,
                      oldFactor,
                      newFactor,
                      oldCostCents:    productForRecalc.costCents,
                      newCostCents,
                    },
                    '[v1.0.69 cost-recalc] entry-unit factor changed — costCents recalculated to preserve cost-per-entry-unit',
                  );
                }
              }
            }
          }
        }
      }

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
          discountType:  c.discountType ?? null,
          discountValue: c.discountValue ?? null,
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
