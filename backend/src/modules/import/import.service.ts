import * as XLSX from 'xlsx';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { recordStockMovement } from '../../utils/stock-movement.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedRow {
  rowNum:        number;
  name:          string;
  sku:           string;
  barcode:       string | null;
  category:      string | null;
  brand:         string | null;
  unit:          string | null;
  costPrice:     number;      // already in Rs (not cents)
  sellPrice:     number;
  taxPercent:    number;
  reorderLevel:  number;
  openingStock:  number;
  warehouseName: string | null;
}

export interface RowError {
  row:     number;
  field:   string;
  message: string;
}

export interface ParseResult {
  valid:  ParsedRow[];
  errors: RowError[];
}

export interface ImportSummary {
  imported:     number;
  withStock:    number;
  skipped:      number;
}

// ─── Column normaliser ────────────────────────────────────────────────────────

const COL_ALIASES: Record<string, string> = {
  name: 'name', productname: 'name', product: 'name',
  sku: 'sku', code: 'sku', itemcode: 'sku',
  barcode: 'barcode', ean: 'barcode', upc: 'barcode',
  category: 'category', categoryname: 'category',
  brand: 'brand', brandname: 'brand',
  unit: 'unit', unitname: 'unit', uom: 'unit',
  costprice: 'costPrice', cost: 'costPrice', purchaseprice: 'costPrice',
  sellprice: 'sellPrice', price: 'sellPrice', sellingprice: 'sellPrice', salesprice: 'sellPrice',
  taxpercent: 'taxPercent', tax: 'taxPercent', vat: 'taxPercent',
  reorderlevel: 'reorderLevel', reorder: 'reorderLevel', minstock: 'reorderLevel',
  openingstock: 'openingStock', openingqty: 'openingStock', initialstock: 'openingStock',
  warehousename: 'warehouseName', warehouse: 'warehouseName', location: 'warehouseName',
};

function normaliseKey(raw: string): string {
  return COL_ALIASES[raw.toLowerCase().replace(/[^a-z]/g, '')] ?? raw;
}

function toNum(v: unknown, fallback = 0): number {
  const n = parseFloat(String(v ?? '').trim());
  return isNaN(n) ? fallback : n;
}

function toStr(v: unknown): string {
  return String(v ?? '').trim();
}

// ─── Parse file buffer → rows ─────────────────────────────────────────────────

export function parseProductsFile(buffer: Buffer, mimetype: string): ParseResult {
  const valid: ParsedRow[]  = [];
  const errors: RowError[]  = [];

  // Parse workbook
  const wb  = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: '',
    raw:    false,
  });

  if (raw.length === 0) {
    errors.push({ row: 0, field: 'file', message: 'File is empty or has no data rows' });
    return { valid, errors };
  }

  // Normalise header keys
  const rows = raw.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) out[normaliseKey(k)] = v;
    return out;
  });

  // Track SKUs seen in this file (for within-file duplicate check)
  const seenSkus = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 2; // 1-based, row 1 = header
    const r      = rows[i];
    const rowErrors: RowError[] = [];

    const name  = toStr(r['name']);
    const sku   = toStr(r['sku']);

    if (!name)  rowErrors.push({ row: rowNum, field: 'name', message: 'Name is required' });
    if (!sku)   rowErrors.push({ row: rowNum, field: 'sku',  message: 'SKU is required' });

    if (sku && seenSkus.has(sku.toLowerCase())) {
      rowErrors.push({ row: rowNum, field: 'sku', message: `Duplicate SKU "${sku}" within file` });
    } else if (sku) {
      seenSkus.add(sku.toLowerCase());
    }

    const costPrice    = toNum(r['costPrice']);
    const sellPrice    = toNum(r['sellPrice']);
    const taxPercent   = toNum(r['taxPercent']);
    const reorderLevel = Math.round(toNum(r['reorderLevel']));
    const openingStock = Math.round(toNum(r['openingStock']));

    if (costPrice < 0)    rowErrors.push({ row: rowNum, field: 'costPrice',    message: 'Cost price must be >= 0' });
    if (sellPrice < 0)    rowErrors.push({ row: rowNum, field: 'sellPrice',    message: 'Sell price must be >= 0' });
    if (taxPercent < 0 || taxPercent > 100) {
      rowErrors.push({ row: rowNum, field: 'taxPercent', message: 'Tax % must be 0–100' });
    }
    if (openingStock < 0) rowErrors.push({ row: rowNum, field: 'openingStock', message: 'Opening stock must be >= 0' });

    const warehouseName = toStr(r['warehouseName']) || null;
    if (openingStock > 0 && !warehouseName) {
      rowErrors.push({ row: rowNum, field: 'warehouseName', message: 'Warehouse name is required when opening stock > 0' });
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    valid.push({
      rowNum,
      name,
      sku,
      barcode:       toStr(r['barcode'])   || null,
      category:      toStr(r['category'])  || null,
      brand:         toStr(r['brand'])     || null,
      unit:          toStr(r['unit'])      || null,
      costPrice,
      sellPrice,
      taxPercent,
      reorderLevel,
      openingStock,
      warehouseName,
    });
  }

  return { valid, errors };
}

// ─── DB validation (check SKU uniqueness against DB) ─────────────────────────

export async function validateAgainstDb(rows: ParsedRow[]): Promise<RowError[]> {
  const skus = rows.map((r) => r.sku);
  const existing = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { sku: true },
  });
  const existingSet = new Set(existing.map((p) => p.sku.toLowerCase()));

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
        const cat = await tx.category.upsert({
          where:  { name: row.category },
          create: { name: row.category },
          update: {},
        });
        categoryId = cat.id;
      }

      // ── find-or-create Brand ──
      let brandId: string | null = null;
      if (row.brand) {
        const brand = await tx.brand.upsert({
          where:  { name: row.brand },
          create: { name: row.brand },
          update: {},
        });
        brandId = brand.id;
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
          const created = await tx.unit.create({
            data: { name: row.unit, shortCode: row.unit.slice(0, 6).toLowerCase(), type: 'COUNT', isActive: true },
          });
          unitId = created.id;
        }
      }

      if (!unitId) {
        if (!defaultUnit) {
          logger.warn({ sku: row.sku }, 'No default unit found — skipping row');
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

  return { imported, withStock, skipped: 0 };
}
