import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BOMLineInput {
  materialId: string;
  qty: number;        // qty of material per BOM yield
  wastePct?: number;  // expected wastage % added to required qty
  notes?: string | null;
}

export interface CreateBOMInput {
  productId: string;
  name: string;
  yieldQty?: number;  // units produced per batch run (default 1)
  notes?: string | null;
  lines: BOMLineInput[];
}

export interface UpdateBOMInput {
  name?: string;
  yieldQty?: number;
  notes?: string | null;
  isActive?: boolean;
  lines?: BOMLineInput[];
}

// ─── Includes ─────────────────────────────────────────────────────────────────

const fullInclude = {
  product: { select: { id: true, name: true, sku: true } },
  lines: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      material: { select: { id: true, name: true, sku: true, costCents: true } },
    },
  },
} satisfies Prisma.BOMInclude;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Total material cost (integer cents) for a set of BOM lines.
 * costCents is integer cents per material unit; qty is a Decimal quantity.
 * Effective qty includes the line's wastage %. Math.round() guarantees we
 * never leak fractional cents.
 */
function calculateMaterialCost(
  lines: { qty: Prisma.Decimal | number; wastePct?: number; material: { costCents: number } }[],
): number {
  return lines.reduce((sum, line) => {
    const qty = Number(line.qty);
    const effective = qty * (1 + (line.wastePct ?? 0) / 100);
    return sum + Math.round(line.material.costCents * effective);
  }, 0);
}

/**
 * Reject a BOM whose materials are invalid:
 *  - a product cannot be a material of its own BOM (circular reference)
 *  - the same material cannot appear twice
 */
function assertNoBadLines(productId: string, lines: BOMLineInput[]): void {
  if (lines.some((l) => l.materialId === productId)) {
    throw new HttpError(400, 'A product cannot be its own material');
  }
  const ids = lines.map((l) => l.materialId);
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, 'Duplicate material in BOM lines');
  }
}

/** Validate that all referenced material products exist and are active. */
async function assertMaterialsExist(lines: BOMLineInput[]): Promise<void> {
  const ids = [...new Set(lines.map((l) => l.materialId))];
  const found = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  if (found.length !== ids.length) {
    throw new HttpError(400, 'One or more materials do not exist');
  }
}

// ─── Service ────────────────────────────────────────────────────────────────

export const bomService = {
  getAllBOMs: async () => {
    try {
      const boms = await prisma.bOM.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          lines: {
            include: { material: { select: { costCents: true } } },
          },
          _count: { select: { lines: true } },
        },
      });
      // Attach a computed material cost for each BOM.
      return boms.map((b) => ({
        ...b,
        materialCostCents: calculateMaterialCost(b.lines),
      }));
    } catch (err) {
      logger.error(err, 'bomService.getAllBOMs failed');
      throw err;
    }
  },

  getBOMById: async (id: string) => {
    try {
      const bom = await prisma.bOM.findFirst({
        where: { id, deletedAt: null },
        include: fullInclude,
      });
      if (!bom) throw new HttpError(404, 'BOM not found');
      return { ...bom, materialCostCents: calculateMaterialCost(bom.lines) };
    } catch (err) {
      logger.error(err, 'bomService.getBOMById failed');
      throw err;
    }
  },

  getBOMByProductId: async (productId: string) => {
    try {
      const bom = await prisma.bOM.findFirst({
        where: { productId, deletedAt: null },
        include: fullInclude,
      });
      if (!bom) return null;
      return { ...bom, materialCostCents: calculateMaterialCost(bom.lines) };
    } catch (err) {
      logger.error(err, 'bomService.getBOMByProductId failed');
      throw err;
    }
  },

  createBOM: async (data: CreateBOMInput) => {
    try {
      if (!data.lines || data.lines.length === 0) {
        throw new HttpError(400, 'A BOM needs at least one material line');
      }

      const product = await prisma.product.findUnique({ where: { id: data.productId } });
      if (!product) throw new HttpError(400, 'Finished product not found');

      // Enforce one active BOM per finished product (productId is @unique).
      const existing = await prisma.bOM.findFirst({
        where: { productId: data.productId, deletedAt: null },
      });
      if (existing) {
        throw new HttpError(409, 'This product already has a BOM');
      }

      assertNoBadLines(data.productId, data.lines);
      await assertMaterialsExist(data.lines);

      const created = await prisma.bOM.create({
        data: {
          productId: data.productId,
          name: data.name,
          yieldQty: data.yieldQty ?? 1,
          notes: data.notes ?? null,
          lines: {
            create: data.lines.map((l) => ({
              materialId: l.materialId,
              qty: l.qty,
              wastePct: l.wastePct ?? 0,
              notes: l.notes ?? null,
            })),
          },
        },
        include: fullInclude,
      });

      logger.info({ bomId: created.id, productId: data.productId }, 'BOM created');
      return { ...created, materialCostCents: calculateMaterialCost(created.lines) };
    } catch (err) {
      logger.error(err, 'bomService.createBOM failed');
      throw err;
    }
  },

  updateBOM: async (id: string, data: UpdateBOMInput) => {
    try {
      const existing = await prisma.bOM.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new HttpError(404, 'BOM not found');

      if (data.lines) {
        if (data.lines.length === 0) {
          throw new HttpError(400, 'A BOM needs at least one material line');
        }
        assertNoBadLines(existing.productId, data.lines);
        await assertMaterialsExist(data.lines);
      }

      const updated = await prisma.$transaction(async (tx) => {
        // Replace lines wholesale when provided (simpler + avoids drift).
        if (data.lines) {
          await tx.bOMLine.deleteMany({ where: { bomId: id } });
        }
        return tx.bOM.update({
          where: { id },
          data: {
            name: data.name ?? existing.name,
            yieldQty: data.yieldQty ?? undefined,
            notes: data.notes === undefined ? undefined : data.notes,
            isActive: data.isActive ?? undefined,
            ...(data.lines
              ? {
                  lines: {
                    create: data.lines.map((l) => ({
                      materialId: l.materialId,
                      qty: l.qty,
                      wastePct: l.wastePct ?? 0,
                      notes: l.notes ?? null,
                    })),
                  },
                }
              : {}),
          },
          include: fullInclude,
        });
      });

      logger.info({ bomId: id }, 'BOM updated');
      return { ...updated, materialCostCents: calculateMaterialCost(updated.lines) };
    } catch (err) {
      logger.error(err, 'bomService.updateBOM failed');
      throw err;
    }
  },

  deleteBOM: async (id: string) => {
    try {
      const existing = await prisma.bOM.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new HttpError(404, 'BOM not found');
      await prisma.bOM.update({ where: { id }, data: { deletedAt: new Date() } });
      logger.info({ bomId: id }, 'BOM soft-deleted');
      return { id };
    } catch (err) {
      logger.error(err, 'bomService.deleteBOM failed');
      throw err;
    }
  },

  /** Public helper — total material cost (cents) for a given BOM id. */
  calculateMaterialCost: async (bomId: string): Promise<number> => {
    const bom = await prisma.bOM.findFirst({
      where: { id: bomId, deletedAt: null },
      include: { lines: { include: { material: { select: { costCents: true } } } } },
    });
    if (!bom) throw new HttpError(404, 'BOM not found');
    return calculateMaterialCost(bom.lines);
  },
};
