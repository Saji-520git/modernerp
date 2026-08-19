import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { recordStockMovement } from '../../utils/stock-movement.js';

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// Parsing rules live in the pure module next door so they can be tested
// without a database. Re-exported here so callers keep one import site.
export type { ParsedRow, RowError, ParseResult, ImportSummary } from './import-parse.js';
export { parseProductsFile } from './import-parse.js';
import type { ParsedRow, RowError, ImportSummary } from './import-parse.js';
import { unitProfile } from './import-parse.js';

/** A shortCode nothing else has taken — the column is @unique. */
async function freeShortCode(tx: TxClient, preferred: string): Promise<string> {
  const base = (preferred || 'unit').slice(0, 8);
  if (!await tx.unit.findFirst({ where: { shortCode: base }, select: { id: true } })) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base.slice(0, 6)}${i}`;
    if (!await tx.unit.findFirst({ where: { shortCode: candidate }, select: { id: true } })) return candidate;
  }
  return `${base.slice(0, 4)}${Date.now().toString(36).slice(-4)}`;
}

// ─── DB validation (check SKU uniqueness against DB) ─────────────────────────

export async function validateAgainstDb(rows: ParsedRow[]): Promise<RowError[]> {
  const skus = rows.map((r) => r.sku);
  const existing = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { sku: true },
  });
  const existingSet = new Set(existing.map((p) => p.sku.toLowerCase()));

  // Barcode is @unique too. Without this the insert was the first thing to
  // notice a clash, which fails the ENTIRE file with a raw constraint error and
  // no row number — after preview had already called the file clean.
  const barcodes = rows.map((r) => r.barcode).filter((b): b is string => !!b);
  const existingBarcodes = barcodes.length > 0
    ? await prisma.product.findMany({
        where:  { barcode: { in: barcodes } },
        select: { barcode: true, sku: true },
      })
    : [];
  const barcodeOwner = new Map(existingBarcodes.map((p) => [p.barcode as string, p.sku]));

  // Validate warehouse names
  const warehouseNames = [...new Set(rows.filter((r) => r.warehouseName).map((r) => r.warehouseName as string))];
  const foundWarehouses = warehouseNames.length > 0
    ? await prisma.warehouse.findMany({
        where: { name: { in: warehouseNames }, isActive: true },
        select: { name: true },
      })
    : [];
  const warehouseSet = new Set(foundWarehouses.map((w) => w.name.toLowerCase()));

  const errors: RowError[] = [];
  for (const row of rows) {
    if (existingSet.has(row.sku.toLowerCase())) {
      errors.push({ row: row.rowNum, field: 'sku', message: `SKU "${row.sku}" already exists in database` });
    }
    if (row.barcode && barcodeOwner.has(row.barcode)) {
      errors.push({
        row: row.rowNum, field: 'barcode',
        message: `Barcode "${row.barcode}" already belongs to product ${barcodeOwner.get(row.barcode)}`,
      });
    }
    if (row.warehouseName && !warehouseSet.has(row.warehouseName.toLowerCase())) {
      errors.push({ row: row.rowNum, field: 'warehouseName', message: `Warehouse "${row.warehouseName}" not found or inactive` });
    }
  }
  return errors;
}

// ─── Import confirmed rows ────────────────────────────────────────────────────

export async function importProducts(rows: ParsedRow[], userId: string): Promise<ImportSummary> {
  let imported  = 0;
  let withStock = 0;
  let skipped   = 0;

  // Pre-load warehouses to avoid per-row lookups
  const warehouseNames = [...new Set(rows.filter((r) => r.warehouseName).map((r) => r.warehouseName as string))];
  const warehouses = warehouseNames.length > 0
    ? await prisma.warehouse.findMany({
        where: { name: { in: warehouseNames }, isActive: true },
        select: { id: true, name: true },
      })
    : [];
  const warehouseMap = new Map(warehouses.map((w) => [w.name.toLowerCase(), w.id]));

  // Get or create a default unit (first active unit)
  const defaultUnit = await prisma.unit.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      // ── find-or-create Category ──
      let categoryId: string | null = null;
      if (row.category) {
        // Case-insensitive, the way Unit already resolves. An exact-match upsert
        // filed "Dairy" and "dairy" as two separate categories.
        const found = await tx.category.findFirst({
          where: { name: { equals: row.category, mode: 'insensitive' } },
        });
        categoryId = found
          ? found.id
          : (await tx.category.create({ data: { name: row.category } })).id;
      }

      // ── find-or-create Brand ──
      let brandId: string | null = null;
      if (row.brand) {
        const found = await tx.brand.findFirst({
          where: { name: { equals: row.brand, mode: 'insensitive' } },
        });
        brandId = found
          ? found.id
          : (await tx.brand.create({ data: { name: row.brand } })).id;
      }

      // ── find-or-create Unit ──
      let unitId: string | null = null;
      if (row.unit) {
        const existing = await tx.unit.findFirst({
          where: { name: { equals: row.unit, mode: 'insensitive' } },
        });
        if (existing) {
          unitId = existing.id;
        } else {
          const profile = unitProfile(row.unit);
          const created = await tx.unit.create({
            data: {
              name:         row.unit,
              shortCode:    await freeShortCode(tx, profile.short),
              type:         profile.type,
              allowDecimal: profile.allowDecimal,
              isActive:     true,
            },
          });
          unitId = created.id;
        }
      }

      if (!unitId) {
        if (!defaultUnit) {
          // Counted, not swallowed: the summary used to hardcode skipped: 0
          // while this branch quietly dropped rows.
          logger.warn({ sku: row.sku }, 'No default unit found — skipping row');
          skipped++;
          continue;
        }
        unitId = defaultUnit.id;
      }

      // ── create Product ──
      const product = await tx.product.create({
        data: {
          name:         row.name,
          sku:          row.sku,
          barcode:      row.barcode,
          categoryId,
          brandId,
          unitId,
          costCents:    Math.round(row.costPrice  * 100),
          priceCents:   Math.round(row.sellPrice  * 100),
          taxPercent:   row.taxPercent,
          reorderLevel: row.reorderLevel,
          isActive:     true,
        },
      });
      imported++;

      // ── opening stock ──
      if (row.openingStock > 0 && row.warehouseName) {
        const warehouseId = warehouseMap.get(row.warehouseName.toLowerCase());
        if (warehouseId) {
          await tx.stock.upsert({
            where:  { productId_warehouseId: { productId: product.id, warehouseId } },
            create: { productId: product.id, warehouseId, qty: row.openingStock },
            update: { qty: { increment: row.openingStock } },
          });
          await recordStockMovement(tx, {
            productId:   product.id,
            warehouseId,
            type:        'OPENING',
            qty:         row.openingStock,
            refType:     'Import',
            note:        `Opening stock via import`,
          });
          withStock++;
        }
      }
    }
  }, { timeout: 60_000 });

  return { imported, withStock, skipped };
}
