import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import { computePromotions, type PromoInput, type PromoCartLine, type PromoResult } from './promotions.engine.js';
import type { CreatePromotionInput, UpdatePromotionInput, PreviewInput } from './promotions.schema.js';

/** Map a Prisma Promotion row → engine PromoInput (Decimal → number). */
function toPromoInput(r: {
  id: string; name: string; type: string; scope: string;
  scopeCategoryId: string | null; scopeBrandId: string | null; scopeProductId: string | null;
  value: number; minQty: { toNumber(): number } | null; minCartCents: number | null;
  startsAt: Date | null; endsAt: Date | null; priority: number; stackable: boolean;
  maxDiscountCents: number | null; active: boolean; usageLimit: number | null; timesUsed: number;
}): PromoInput {
  return {
    id: r.id, name: r.name, type: r.type, scope: r.scope,
    scopeCategoryId: r.scopeCategoryId, scopeBrandId: r.scopeBrandId, scopeProductId: r.scopeProductId,
    value: r.value, minQty: r.minQty != null ? r.minQty.toNumber() : null, minCartCents: r.minCartCents,
    startsAt: r.startsAt, endsAt: r.endsAt, priority: r.priority, stackable: r.stackable,
    maxDiscountCents: r.maxDiscountCents, active: r.active, usageLimit: r.usageLimit, timesUsed: r.timesUsed,
  };
}

export const promotionsService = {
  list: () =>
    prisma.promotion.findMany({ orderBy: [{ active: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }] }),

  getById: async (id: string) => {
    const p = await prisma.promotion.findUnique({ where: { id } });
    if (!p) throw new HttpError(404, 'Promotion not found');
    return p;
  },

  create: (data: CreatePromotionInput, userId?: string) =>
    prisma.promotion.create({ data: { ...data, createdById: userId ?? null } }),

  update: async (id: string, data: UpdatePromotionInput) => {
    await promotionsService.getById(id);
    return prisma.promotion.update({ where: { id }, data });
  },

  remove: async (id: string) => {
    await promotionsService.getById(id);
    // Keep sales history intact: block hard-delete once the promo has been used.
    const used = await prisma.salePromotion.count({ where: { promotionId: id } });
    if (used > 0) {
      await prisma.promotion.update({ where: { id }, data: { active: false } });
      return { success: true, deactivated: true };
    }
    await prisma.promotion.delete({ where: { id } });
    return { success: true, deactivated: false };
  },

  /** Active promotions as engine inputs (used by preview + POS checkout). */
  getActiveInputs: async (): Promise<PromoInput[]> => {
    const rows = await prisma.promotion.findMany({ where: { active: true } });
    return rows.map(toPromoInput);
  },

  /** Compute promotions for a cart (POS preview). Resolves category/brand per product. */
  preview: async (input: PreviewInput): Promise<PromoResult> => {
    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, categoryId: true, brandId: true },
    });
    const pmap = new Map(products.map((p) => [p.id, p]));

    const lines: PromoCartLine[] = input.items.map((i, idx) => ({
      lineKey: i.lineKey ?? String(idx),
      productId: i.productId,
      categoryId: pmap.get(i.productId)?.categoryId ?? null,
      brandId: pmap.get(i.productId)?.brandId ?? null,
      qty: i.qty,
      lineAfterManualCents: i.lineAfterManualCents,
    }));
    const cartSubtotal = lines.reduce((s, l) => s + l.lineAfterManualCents, 0);
    const promos = await promotionsService.getActiveInputs();
    return computePromotions(lines, cartSubtotal, promos, new Date());
  },
};
