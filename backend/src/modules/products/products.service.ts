import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import type { ListProductsInput, CreateProductInput, UpdateProductInput } from './products.schema.js';
import { nextDocNumber } from '../../utils/doc-number.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Highest PRD- SKU issued + 1, scoped to that prefix.
//
// This counted EVERY product, prefix or not. With 3,264 products — nearly all
// imported under their own P0xxxx codes — the next generated SKU came out as
// PRD-3265 while the PRD sequence stood at 2. Not a failure, since the old
// collision guard appended a timestamp, but the numbers were arbitrary and the
// guard produced SKUs like PRD-3364-lq3k2p when they did clash.
async function generateSku(): Promise<string> {
  return nextDocNumber(prisma.product, 'PRD-', 4, 'sku');
}

// ─── Barcode sanitizer ────────────────────────────────────────────────────────
// Converts scientific-notation strings (e.g. "7.57218E+11") to plain integers.
// Returns null for empty/null input.  Leaves non-scientific strings unchanged.

function sanitizeBarcode(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^-?[\d.]+[eE][+\-]?\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!isNaN(num) && isFinite(num)) {
      return Math.round(num).toString();
    }
  }
  return trimmed;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const productsService = {

  async list(input: ListProductsInput) {
    const { search, categoryId, brandId, isActive, page, pageSize } = input;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};
    if (isActive !== 'all') where.isActive = isActive !== 'false';
    if (categoryId) where.categoryId = categoryId;
    if (brandId)    where.brandId = brandId;
    if (search) {
      where.OR = [
        { name:    { contains: search, mode: 'insensitive' } },
        { sku:     { contains: search, mode: 'insensitive' } },
        { barcode: { equals:   search } },
      ];
    }

    const [total, data] = await prisma.$transaction([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { name: 'asc' },
        include: {
          category: { select: { id: true, name: true } },
          brand:    { select: { id: true, name: true } },
          unit:     { select: { id: true, name: true, shortCode: true } },
          baseUnit: { select: { id: true, name: true, shortCode: true } },
          unitConversions: {
            where: { isActive: true },
            select: {
              fromUnitId: true,
              toUnitId: true,
              conversionQty: true,
              fromUnit: { select: { shortCode: true } },
            },
          },
          stock: {
            select: {
              qty: true,
              warehouseId: true,
              warehouse: { select: { name: true, code: true } },
            },
          },
        },
      }),
    ]);

    return { total, page, pageSize, data };
  },

  async getByBarcode(rawBarcode: string) {
    const barcode = sanitizeBarcode(rawBarcode);
    if (!barcode) {
      throw new HttpError(400, 'Invalid barcode');
    }

    // Build a set of candidate strings to catch scientific-notation variants
    // already stored in the DB (e.g. "7.57218E+11", "7.57218e+11").
    const variants = new Set<string>([barcode]);
    const asNum = Number(barcode);
    if (!isNaN(asNum) && isFinite(asNum) && asNum > 0) {
      variants.add(asNum.toExponential());
      variants.add(asNum.toExponential().toUpperCase());
      const parts = asNum.toExponential(5).toUpperCase().split('E');
      if (parts.length === 2) {
        variants.add(`${parts[0]}E+${parts[1].replace('+', '').replace('-', '-')}`);
      }
    }

    const product = await prisma.product.findFirst({
      where: {
        OR: [
          { barcode: { in: [...variants] } },
          { sku: barcode },
        ],
        isActive: true,
      },
      include: {
        category: { select: { id: true, name: true } },
        brand:    { select: { id: true, name: true } },
        unit:     { select: { id: true, name: true, shortCode: true } },
        baseUnit:     { select: { id: true, name: true, shortCode: true } },
        purchaseUnit: { select: { id: true, name: true, shortCode: true } },
        salesUnit:    { select: { id: true, name: true, shortCode: true } },
        stock: {
          include: { warehouse: { select: { id: true, name: true, code: true } } },
        },
      },
    });
    if (!product) {
      throw new HttpError(404, 'No product with this barcode', { barcode });
    }
    return product;
  },

  async getById(id: string) {
    const p = await prisma.product.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
        brand:    { select: { id: true, name: true } },
        unit:     { select: { id: true, name: true, shortCode: true } },
        stock: {
          include: {
            warehouse: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });
    if (!p) throw new HttpError(404, 'Product not found');
    return p;
  },

  async create(input: CreateProductInput) {
    const sku = input.sku?.trim() || (await generateSku());

    const skuConflict = await prisma.product.findUnique({ where: { sku } });
    if (skuConflict) throw new HttpError(409, `SKU "${sku}" is already taken`);

    const cleanBarcode = sanitizeBarcode(input.barcode);
    if (cleanBarcode) {
      const bcConflict = await prisma.product.findUnique({ where: { barcode: cleanBarcode } });
      if (bcConflict) throw new HttpError(409, `Barcode "${cleanBarcode}" is already taken`);
    }

    return prisma.product.create({
      data: { ...input, sku, barcode: cleanBarcode },
      include: {
        category: { select: { id: true, name: true } },
        brand:    { select: { id: true, name: true } },
        unit:     { select: { id: true, name: true, shortCode: true } },
        stock: {
          select: { qty: true, warehouseId: true, warehouse: { select: { name: true, code: true } } },
        },
      },
    });
  },

  async update(id: string, input: UpdateProductInput) {
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Product not found');

    // ── Base-unit lock ──────────────────────────────────────────────────────
    // Stock, batches and historical baseQty are all recorded in the product's
    // base unit. Changing the base unit after any stock/history exists would
    // silently reinterpret every recorded quantity (e.g. 100 pieces read as 100
    // boxes). Block it: the base unit is immutable once the product has been
    // used. (A brand-new product with no history can still set/correct it.)
    const oldBase = existing.baseUnitId ?? existing.unitId;
    const newBase =
      (input.baseUnitId !== undefined ? input.baseUnitId : existing.baseUnitId) ??
      (input.unitId !== undefined ? input.unitId : existing.unitId);
    if (newBase !== oldBase) {
      const [movementCount, stockAgg] = await Promise.all([
        prisma.stockMovement.count({ where: { productId: id } }),
        prisma.stock.aggregate({ where: { productId: id }, _sum: { qty: true } }),
      ]);
      const onHand = stockAgg._sum.qty != null ? Number(stockAgg._sum.qty) : 0;
      if (movementCount > 0 || onHand !== 0) {
        throw new HttpError(
          409,
          'Cannot change the base/stock unit: this product already has stock or transaction history. ' +
          'The base unit is locked to protect recorded quantities. Create a new product instead.',
        );
      }
    }

    if (input.sku && input.sku !== existing.sku) {
      const conflict = await prisma.product.findUnique({ where: { sku: input.sku } });
      if (conflict) throw new HttpError(409, `SKU "${input.sku}" is already taken`);
    }

    const cleanBarcode = input.barcode !== undefined
      ? sanitizeBarcode(input.barcode)
      : undefined;
    if (cleanBarcode && cleanBarcode !== existing.barcode) {
      const conflict = await prisma.product.findUnique({ where: { barcode: cleanBarcode } });
      if (conflict) throw new HttpError(409, `Barcode "${cleanBarcode}" is already taken`);
    }

    return prisma.product.update({
      where: { id },
      data: {
        ...input,
        ...(input.barcode !== undefined ? { barcode: cleanBarcode } : {}),
      },
      include: {
        category: { select: { id: true, name: true } },
        brand:    { select: { id: true, name: true } },
        unit:     { select: { id: true, name: true, shortCode: true } },
        stock: {
          select: { qty: true, warehouseId: true, warehouse: { select: { name: true, code: true } } },
        },
      },
    });
  },

  async toggleActive(id: string) {
    const p = await prisma.product.findUnique({ where: { id } });
    if (!p) throw new HttpError(404, 'Product not found');
    return prisma.product.update({
      where: { id },
      data: { isActive: !p.isActive },
      select: { id: true, isActive: true, name: true },
    });
  },

  // ─── Smart delete ─────────────────────────────────────────────────────────
  // Client-facing "Delete" button always succeeds.  Behaviour is decided here:
  //   • Product with ANY transaction history (sale, purchase, stock movement,
  //     or batch) → soft delete (isActive:false) so the history stays intact.
  //   • Product with NO history → permanently removed from the DB.
  // On hard delete we first clear the non-cascading operational child rows that
  // reference the product (stock levels, generated stock alerts, held POS-draft
  // lines) so the final product.delete() cannot hit a FK constraint.
  // ProductUnitConversion rows cascade automatically (schema onDelete: Cascade).
  async smartDelete(id: string): Promise<void> {
    const product = await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) throw new HttpError(404, 'Product not found');

    // Check remaining stock — block delete if any stock on hand (must write off
    // first to record the loss properly). Applies to BOTH soft and hard delete
    // paths since it runs before the transaction-history branching below.
    const stockAgg = await prisma.stock.aggregate({
      where: { productId: id },
      _sum: { qty: true },
    });
    const totalStock = Number(stockAgg._sum.qty ?? 0);
    if (totalStock > 0) {
      throw new HttpError(
        400,
        `Cannot delete: ${totalStock} units still in stock. ` +
          `Write off the stock first to record the loss, then delete.`,
      );
    }

    const [saleCount, purchaseCount, movementCount, batchCount] = await Promise.all([
      prisma.saleLine.count({ where: { productId: id } }),
      prisma.purchaseLine.count({ where: { productId: id } }),
      prisma.stockMovement.count({ where: { productId: id } }),
      prisma.stockBatch.count({ where: { productId: id } }),
    ]);

    const hasTransactions =
      saleCount > 0 || purchaseCount > 0 || movementCount > 0 || batchCount > 0;

    if (hasTransactions) {
      // History exists — keep the record, just hide it everywhere.
      await prisma.product.update({ where: { id }, data: { isActive: false } });
      return;
    }

    // No history — safe to remove permanently.  Clear non-cascading children
    // first (order matters to avoid FK errors), then delete the product.
    await prisma.$transaction([
      prisma.stock.deleteMany({ where: { productId: id } }),
      prisma.stockAlert.deleteMany({ where: { productId: id } }),
      prisma.posDraftItem.deleteMany({ where: { productId: id } }),
      prisma.product.delete({ where: { id } }),
    ]);
  },

  async meta() {
    const [categories, brands, units] = await prisma.$transaction([
      prisma.category.findMany({ orderBy: { name: 'asc' } }),
      prisma.brand.findMany({ orderBy: { name: 'asc' } }),
      prisma.unit.findMany({ orderBy: { name: 'asc' } }),
    ]);
    return { categories, brands, units };
  },

  // ─── One-time seed data cleanup (ADMIN only) ──────────────────────────────
  // Soft-deletes demo products seeded at setup time that have no real
  // purchase or sale history.  Products with any transaction are preserved.
  // Safe to call multiple times — idempotent.
  async cleanupSeedData() {
    // Exact names used in seed.ts — must match character-for-character
    const SEED_NAMES = [
      'AA Battery (4-pack)',
      'Chocolate Bar 50g',
      'Cola Can 330ml',
      'Fresh Milk 1L',
      'Greek Yogurt 200g',
      'Milk Powder 400g',   // kept if has transactions
      'Mineral Water 500ml',
      'Mixed Nuts 200g',
      'Orange Juice 1L',
      'Potato Chips 150g',
      'USB-C Cable 1m',
    ];

    // Find all seed-named products (active or already inactive)
    const candidates = await prisma.product.findMany({
      where: { name: { in: SEED_NAMES } },
      select: {
        id: true,
        name: true,
        isActive: true,
        purchaseLines: { select: { id: true }, take: 1 },
        saleLines:     { select: { id: true }, take: 1 },
      },
    });

    const toDeactivate: string[] = [];
    const skippedNames: string[]  = [];

    for (const p of candidates) {
      const hasPurchase = p.purchaseLines.length > 0;
      const hasSale     = p.saleLines.length > 0;

      if (hasPurchase || hasSale) {
        skippedNames.push(p.name);
      } else if (p.isActive) {
        toDeactivate.push(p.id);
      }
      // already inactive — count as done, neither skipped nor deleted again
    }

    if (toDeactivate.length > 0) {
      await prisma.product.updateMany({
        where: { id: { in: toDeactivate } },
        data:  { isActive: false },
      });
    }

    return {
      deleted:      toDeactivate.length,
      skipped:      skippedNames.length,
      skippedNames,
    };
  },

  // ─── Fix scientific-notation barcodes already in the DB ──────────────────
  // Safe to call repeatedly — idempotent.
  async cleanupScientificBarcodes() {
    const products = await prisma.product.findMany({
      where: {
        OR: [
          { barcode: { contains: 'E' } },
          { barcode: { contains: 'e' } },
        ],
      },
      select: { id: true, barcode: true, name: true },
    });

    let fixed = 0;
    const errors: string[] = [];

    for (const p of products) {
      if (!p.barcode) continue;
      const clean = sanitizeBarcode(p.barcode);
      if (!clean || clean === p.barcode) continue;

      const collision = await prisma.product.findFirst({
        where: { barcode: clean, id: { not: p.id } },
      });
      if (collision) {
        errors.push(`${p.name}: barcode collision with existing "${clean}"`);
        continue;
      }

      await prisma.product.update({
        where: { id: p.id },
        data:  { barcode: clean },
      });
      fixed++;
    }

    return { fixed, total: products.length, errors };
  },
};
