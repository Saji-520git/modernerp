import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import { logger } from '../../config/logger.js';
import { convertToBaseUnit } from '../../utils/unit-converter.js';
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
          id:               true,
          costCents:        true,
          costEntryUnitId:  true,
          priceCents:       true,
          priceEntryUnitId: true,
          baseUnitId:       true,
          unitId:           true,
        },
      });

      if (productForRecalc) {
        const effectiveBaseUnitId = productForRecalc.baseUnitId ?? productForRecalc.unitId;
        const costEntryUnitId = productForRecalc.costEntryUnitId;

        const costNeedsRecalcCheck =
          costEntryUnitId != null &&
          costEntryUnitId !== effectiveBaseUnitId &&
          productForRecalc.costCents > 0;

        if (costNeedsRecalcCheck) {
          const oldConv = await tx.productUnitConversion.findFirst({
            where: {
              productId,
              fromUnitId: costEntryUnitId,
              toUnitId:   effectiveBaseUnitId,
              isActive:   true,
            },
            select: { conversionQty: true },
          });

          if (oldConv) {
            const newConvLine = conversions.find(
              (c) => c.fromUnitId === costEntryUnitId && c.toUnitId === effectiveBaseUnitId,
            );

            if (!newConvLine) {
              // User is removing the entry-unit's conversion.
              // costCents stays put. Chunk 3 load-side falls back to base display.
              logger.info(
                {
                  productId,
                  costEntryUnitId: costEntryUnitId,
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
                    costEntryUnitId: costEntryUnitId,
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
                      costEntryUnitId: costEntryUnitId,
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
                      costEntryUnitId: costEntryUnitId,
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

        // ─────────────────────────────────────────────────────────────
        // v1.0.70 price-entry-unit recalc
        // Mirror of the cost recalc above for priceCents. If this edit
        // changes the conversion factor for the unit the user originally
        // entered the price in, recompute priceCents to preserve the
        // displayed price-per-entry-unit (same D6 policy as cost).
        // Shares productForRecalc + effectiveBaseUnitId with the cost
        // block — semantically independent (different columns); only
        // the snapshot fetch is shared.
        // ─────────────────────────────────────────────────────────────
        const priceEntryUnitId = productForRecalc.priceEntryUnitId;

        const priceNeedsRecalcCheck =
          priceEntryUnitId != null &&
          priceEntryUnitId !== effectiveBaseUnitId &&
          productForRecalc.priceCents > 0;

        if (priceNeedsRecalcCheck) {
          const oldConv = await tx.productUnitConversion.findFirst({
            where: {
              productId,
              fromUnitId: priceEntryUnitId,
              toUnitId:   effectiveBaseUnitId,
              isActive:   true,
            },
            select: { conversionQty: true },
          });

          if (oldConv) {
            const newConvLine = conversions.find(
              (c) => c.fromUnitId === priceEntryUnitId && c.toUnitId === effectiveBaseUnitId,
            );

            if (!newConvLine) {
              // User is removing the entry-unit's conversion.
              // priceCents stays put. Chunk 3 load-side falls back to base display.
              logger.info(
                {
                  productId,
                  priceEntryUnitId: priceEntryUnitId,
                  baseUnitId:       effectiveBaseUnitId,
                  priceCents:       productForRecalc.priceCents,
                },
                '[v1.0.70 price-recalc] entry-unit conversion removed — priceCents unchanged',
              );
            } else {
              const oldFactor = oldConv.conversionQty.toNumber();
              const newFactor = newConvLine.conversionQty;

              if (oldFactor <= 0 || newFactor <= 0) {
                logger.warn(
                  {
                    productId,
                    priceEntryUnitId: priceEntryUnitId,
                    oldFactor,
                    newFactor,
                  },
                  '[v1.0.70 price-recalc] invalid factor (<=0) — recalc skipped',
                );
              } else if (oldFactor !== newFactor) {
                const newPriceCents = Math.round(
                  (productForRecalc.priceCents * oldFactor) / newFactor,
                );

                if (newPriceCents < 0 || newPriceCents > 200_000_000_000) {
                  logger.error(
                    {
                      productId,
                      priceEntryUnitId: priceEntryUnitId,
                      oldFactor,
                      newFactor,
                      oldPriceCents: productForRecalc.priceCents,
                      newPriceCents,
                    },
                    '[v1.0.70 price-recalc] computed price outside sane range — recalc skipped',
                  );
                } else if (newPriceCents !== productForRecalc.priceCents) {
                  await tx.product.update({
                    where: { id: productId },
                    data:  { priceCents: newPriceCents },
                  });
                  logger.info(
                    {
                      productId,
                      priceEntryUnitId: priceEntryUnitId,
                      baseUnitId:       effectiveBaseUnitId,
                      oldFactor,
                      newFactor,
                      oldPriceCents:    productForRecalc.priceCents,
                      newPriceCents,
                    },
                    '[v1.0.70 price-recalc] entry-unit factor changed — priceCents recalculated to preserve price-per-entry-unit',
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

      // ── Direction / reachability validation ─────────────────────────────────
      // Stock math (convertToBaseUnit) requires every unit to resolve a path TO
      // the base unit — directly or through a chain. A reversed row (base→unit)
      // or a disconnected unit would otherwise save fine and only fail later at
      // the till. Validate against the just-created rows (inside the tx, so a
      // failure rolls the whole replace back) using the exact runtime resolver.
      const baseUnitId = product.baseUnitId ?? product.unitId;
      const referenced = new Set<string>();
      for (const c of conversions) { referenced.add(c.fromUnitId); referenced.add(c.toUnitId); }
      referenced.delete(baseUnitId);
      for (const unitId of referenced) {
        try {
          await convertToBaseUnit(productId, unitId, new Decimal(1), tx);
        } catch {
          const u = units.find((x) => x.id === unitId);
          throw new HttpError(
            400,
            `Unit "${u?.name ?? unitId}" has no conversion path to the base unit. ` +
            `Every unit must convert to the base unit (e.g. 1 Box = 24 Piece, with Piece as base) — ` +
            `check the direction of your conversion rows.`,
          );
        }
      }

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
