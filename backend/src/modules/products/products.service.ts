import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import type { ListProductsInput, CreateProductInput, UpdateProductInput } from './products.schema.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateSku(): Promise<string> {
  const count = await prisma.product.count();
  const candidate = `PRD-${String(count + 1).padStart(4, '0')}`;
  // Ensure uniqueness in case of gaps
  const existing = await prisma.product.findUnique({ where: { sku: candidate } });
  if (existing) return `PRD-${String(count + 100).padStart(4, '0')}-${Date.now().toString(36)}`;
  return candidate;
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
