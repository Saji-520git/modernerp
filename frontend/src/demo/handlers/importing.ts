// ─── Product import (preview + confirm) ──────────────────────────────────────
//
// "Import Products" sits in the ADMIN nav with no module flag behind it, so a
// visitor signed in as the owner can reach it and upload a file. It was
// originally classed out of scope, which was wrong: the page is reachable, and
// an unhandled endpoint would have answered a client's own product list with
// "This part of the system is not included in the demo."
//
// It is also a good thing to show a hardware shop with a few hundred SKUs, so
// it is implemented rather than hidden.
//
// The real endpoint parses the upload server-side. Here the file never leaves
// the browser: `importApi` posts a FormData carrying a File, and these handlers
// read it directly. That is why they are async — the adapter awaits handlers
// for exactly this case.

import { DemoHttpError, type DemoHandler } from '../http';
import { db } from '../support';
import { nextId } from '../db';

interface ParsedRow {
  rowNum: number;
  name: string;
  sku: string;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  unit: string | null;
  costPrice: number;
  sellPrice: number;
  taxPercent: number;
  reorderLevel: number;
  openingStock: number;
  warehouseName: string | null;
}

interface RowError { row: number; field: string; message: string }

const HEADERS = [
  'name', 'sku', 'barcode', 'category', 'brand', 'unit',
  'costPrice', 'sellPrice', 'taxPercent', 'reorderLevel',
  'openingStock', 'warehouseName',
] as const;

/**
 * A CSV line splitter that honours quotes and doubled quotes ("" → ").
 *
 * The exporter in services/import.ts quotes every field and escapes inner
 * quotes that way, so anything it writes must survive a round trip through
 * here — including an error message containing a quoted barcode.
 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }   // escaped quote
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function readUpload(body: unknown): Promise<string> {
  // axios hands the FormData straight through; the adapter does not serialise it.
  const form = body as FormData | undefined;
  const file = form && typeof form.get === 'function' ? form.get('file') : null;
  if (!file || typeof (file as File).text !== 'function') {
    throw new DemoHttpError(400, 'No file was received.');
  }
  const text = await (file as File).text();
  if (!text.trim()) throw new DemoHttpError(400, 'That file is empty.');
  return text;
}

function parse(text: string): { valid: ParsedRow[]; errors: RowError[] } {
  // Strip the UTF-8 BOM Excel writes, and accept CRLF or LF.
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) throw new DemoHttpError(400, 'That file has no rows.');

  const header = splitCsvLine(lines[0]).map((h) => h.replace(/\s+/g, '').toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  if (col('name') < 0 || col('sku') < 0) {
    throw new DemoHttpError(
      400,
      'The header row must include at least `name` and `sku`. Download the template for the expected columns.',
    );
  }

  const d = db();
  const valid: ParsedRow[] = [];
  const errors: RowError[] = [];
  const seenSku = new Set<string>();
  const seenBarcode = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const get = (n: string) => { const c = col(n); return c >= 0 ? (cells[c] ?? '') : ''; };
    const rowNum = i + 1;                       // 1-based, counting the header
    const num = (n: string) => { const v = Number(get(n)); return Number.isFinite(v) ? v : 0; };

    const name = get('name');
    const sku = get('sku');
    const barcode = get('barcode') || null;

    let bad = false;
    if (!name) { errors.push({ row: rowNum, field: 'name', message: 'Name is required.' }); bad = true; }
    if (!sku) { errors.push({ row: rowNum, field: 'sku', message: 'SKU is required.' }); bad = true; }

    // Clashes both with the catalogue and within the file itself — importing a
    // file that repeats a SKU twice would otherwise create two products.
    if (sku && d.products.some((p) => p.sku.toLowerCase() === sku.toLowerCase())) {
      errors.push({ row: rowNum, field: 'sku', message: `SKU ${sku} already exists in the catalogue.` });
      bad = true;
    }
    if (sku && seenSku.has(sku.toLowerCase())) {
      errors.push({ row: rowNum, field: 'sku', message: `SKU ${sku} appears more than once in this file.` });
      bad = true;
    }
    if (barcode && d.products.some((p) => p.barcode === barcode)) {
      errors.push({ row: rowNum, field: 'barcode', message: `Barcode ${barcode} already belongs to another product.` });
      bad = true;
    }
    if (barcode && seenBarcode.has(barcode)) {
      errors.push({ row: rowNum, field: 'barcode', message: `Barcode ${barcode} appears more than once in this file.` });
      bad = true;
    }

    const sellPrice = num('sellPrice');
    if (sellPrice < 0) { errors.push({ row: rowNum, field: 'sellPrice', message: 'Sell price cannot be negative.' }); bad = true; }
    const openingStock = num('openingStock');
    if (openingStock < 0) { errors.push({ row: rowNum, field: 'openingStock', message: 'Opening stock cannot be negative.' }); bad = true; }

    if (bad) continue;
    seenSku.add(sku.toLowerCase());
    if (barcode) seenBarcode.add(barcode);

    valid.push({
      rowNum, name, sku, barcode,
      category: get('category') || null,
      brand: get('brand') || null,
      unit: get('unit') || null,
      costPrice: num('costPrice'),
      sellPrice,
      taxPercent: num('taxPercent'),
      reorderLevel: num('reorderLevel'),
      openingStock,
      warehouseName: get('warehouseName') || null,
    });
  }

  return { valid, errors };
}

export const importPreview: DemoHandler = async ({ body }) => parse(await readUpload(body));

export const importConfirm: DemoHandler = async ({ body }) => {
  const { valid } = parse(await readUpload(body));
  const d = db();
  let withStock = 0;

  for (const r of valid) {
    // Categories, brands and units are created on the fly by NAME, which is what
    // makes a client's own spreadsheet importable without prior setup.
    let category = d.categories.find((c) => c.name.toLowerCase() === (r.category ?? '').toLowerCase());
    if (!category && r.category) {
      category = { id: nextId('cat'), name: r.category, parentId: null };
      d.categories.push(category);
    }
    let brand = d.brands.find((b) => b.name.toLowerCase() === (r.brand ?? '').toLowerCase());
    if (!brand && r.brand) {
      brand = { id: nextId('brd'), name: r.brand };
      d.brands.push(brand);
    }
    let unit = d.units.find(
      (u) => u.name.toLowerCase() === (r.unit ?? '').toLowerCase()
          || u.shortCode.toLowerCase() === (r.unit ?? '').toLowerCase(),
    );
    if (!unit && r.unit) {
      unit = { id: nextId('unit'), name: r.unit, shortCode: r.unit.slice(0, 4), allowDecimal: false, type: 'COUNT' };
      d.units.push(unit);
    }

    const product = {
      id: nextId('p'),
      sku: r.sku,
      barcode: r.barcode ?? '',
      name: r.name,
      categoryId: category?.id ?? d.categories[0].id,
      brandId: brand?.id ?? 'brd_generic',
      unitId: unit?.id ?? 'unit_pcs',
      // The sheet is in rupees; everything downstream is integer cents.
      costCents: Math.round(r.costPrice * 100),
      priceCents: Math.round(r.sellPrice * 100),
      reorderLevel: r.reorderLevel,
      reorderQty: r.reorderLevel * 2,
      stock: {} as Record<string, number>,
      isBatchTracked: false,
    };
    d.products.push(product);

    const target =
      d.warehouses.find((w) => w.name.toLowerCase() === (r.warehouseName ?? '').toLowerCase())
      ?? d.warehouses.find((w) => w.isDefault)
      ?? d.warehouses[0];

    for (const w of d.warehouses) {
      d.stock.push({
        productId: product.id, warehouseId: w.id,
        qty: w.id === target.id ? r.openingStock : 0,
        shortfallQty: 0,
      });
    }

    if (r.openingStock > 0) {
      withStock++;
      d.movements.push({
        id: nextId('mov'), productId: product.id, warehouseId: target.id,
        type: 'ADJUSTMENT', qty: r.openingStock,
        refType: 'IMPORT', refId: product.id, note: 'Opening stock from import',
        createdAt: new Date().toISOString(),
      });
    }
  }

  return { imported: valid.length, withStock, skipped: 0 };
};
