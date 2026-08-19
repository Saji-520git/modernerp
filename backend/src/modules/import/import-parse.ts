// ─── Product import: file parsing ────────────────────────────────────────────
//
// Pure. No database, no Prisma — everything here is decided from the file alone,
// so the rules can be exercised by tests without a live schema. Anything that
// needs to ask the database (SKU and barcode conflicts, warehouse existence,
// the import itself) lives in import.service.ts.

import * as XLSX from 'xlsx';
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

export function normaliseKey(raw: string): string {
  return COL_ALIASES[raw.toLowerCase().replace(/[^a-z]/g, '')] ?? raw;
}

/**
 * Spreadsheet cells are not numbers. They arrive as "Rs. 1,200", "1 200",
 * "450/=", and — when someone types the letter o for a zero — "12o0".
 *
 * This used to be `parseFloat` with a 0 fallback, which takes any valid PREFIX
 * and silently discards the rest: "12o0" imported as 12, "1 200" as 1,
 * "Rs. 450" as 0. Nothing was ever flagged, so a single typo shipped a product
 * at a hundredth of its price — or free. On a price column that is the worst
 * failure mode there is: quiet and wrong.
 *
 * So strip only the presentation a real spreadsheet adds, then require what is
 * left to be unambiguously a number. Anything else is an error reported against
 * its row — never a guess.
 */
function cleanNumeric(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  // Accounting negatives: (500) → -500. Converted rather than stripped so the
  // ">= 0" checks report the real problem instead of silently seeing zero.
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) s = '-' + paren[1].trim();
  return s
    .replace(/(?:rs\.?|₨|lkr|\$)/gi, '')   // currency marks
    .replace(/\/[=-]\s*$/, '')             // local "450/=" / "450/-"
    .replace(/[,\u00A0\s](?=\d)/g, '')     // thousands separators, incl. nbsp
    .trim();
}

/** Digits, optional decimal, optional exponent (Excel emits 1E+15 for big values). */
const NUMERIC_RE = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function readNumber(
  value:    unknown,
  field:    string,
  rowNum:   number,
  errors:   RowError[],
  fallback = 0,
): number {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;   // blank means "not supplied", which is not an error
  const cleaned = cleanNumeric(raw);
  if (!NUMERIC_RE.test(cleaned)) {
    errors.push({ row: rowNum, field, message: `"${raw}" is not a number` });
    return fallback;
  }
  return Number(cleaned);
}

function toStr(v: unknown): string {
  return String(v ?? '').trim();
}

// ─── Unit resolution ──────────────────────────────────────────────────────────
//
// Units named in a spreadsheet have to become real Unit rows. Two things went
// wrong doing that naively:
//
//   * every auto-created unit was type COUNT with allowDecimal false, so
//     importing "Kilogram" produced a unit that cannot hold 2.5 kg — which
//     silently defeats decimal opening stock
//   * shortCode is @unique and was name.slice(0, 6), so "Kilogram" and
//     "Kilograms" both wanted "kilogr" and the second one failed the whole
//     import on a constraint the file never mentioned
//
// Known names get a sensible profile; anything unrecognised stays COUNT, which
// is the safe default. Short codes are de-duplicated before insert.
export type UnitProfile = { short: string; type: 'COUNT' | 'WEIGHT' | 'VOLUME' | 'LENGTH'; allowDecimal: boolean };

const UNIT_PROFILES: Record<string, UnitProfile> = {
  piece:      { short: 'pcs', type: 'COUNT',  allowDecimal: false },
  pieces:     { short: 'pcs', type: 'COUNT',  allowDecimal: false },
  pcs:        { short: 'pcs', type: 'COUNT',  allowDecimal: false },
  each:       { short: 'ea',  type: 'COUNT',  allowDecimal: false },
  unit:       { short: 'unit',type: 'COUNT',  allowDecimal: false },
  nos:        { short: 'nos', type: 'COUNT',  allowDecimal: false },
  box:        { short: 'box', type: 'COUNT',  allowDecimal: false },
  carton:     { short: 'ctn', type: 'COUNT',  allowDecimal: false },
  packet:     { short: 'pkt', type: 'COUNT',  allowDecimal: false },
  pack:       { short: 'pk',  type: 'COUNT',  allowDecimal: false },
  dozen:      { short: 'dz',  type: 'COUNT',  allowDecimal: false },
  bottle:     { short: 'btl', type: 'COUNT',  allowDecimal: false },
  can:        { short: 'can', type: 'COUNT',  allowDecimal: false },
  kilogram:   { short: 'kg',  type: 'WEIGHT', allowDecimal: true },
  kilograms:  { short: 'kg',  type: 'WEIGHT', allowDecimal: true },
  kilo:       { short: 'kg',  type: 'WEIGHT', allowDecimal: true },
  kg:         { short: 'kg',  type: 'WEIGHT', allowDecimal: true },
  gram:       { short: 'g',   type: 'WEIGHT', allowDecimal: true },
  grams:      { short: 'g',   type: 'WEIGHT', allowDecimal: true },
  g:          { short: 'g',   type: 'WEIGHT', allowDecimal: true },
  milligram:  { short: 'mg',  type: 'WEIGHT', allowDecimal: true },
  pound:      { short: 'lb',  type: 'WEIGHT', allowDecimal: true },
  litre:      { short: 'l',   type: 'VOLUME', allowDecimal: true },
  liter:      { short: 'l',   type: 'VOLUME', allowDecimal: true },
  litres:     { short: 'l',   type: 'VOLUME', allowDecimal: true },
  l:          { short: 'l',   type: 'VOLUME', allowDecimal: true },
  millilitre: { short: 'ml',  type: 'VOLUME', allowDecimal: true },
  milliliter: { short: 'ml',  type: 'VOLUME', allowDecimal: true },
  ml:         { short: 'ml',  type: 'VOLUME', allowDecimal: true },
  metre:      { short: 'm',   type: 'LENGTH', allowDecimal: true },
  meter:      { short: 'm',   type: 'LENGTH', allowDecimal: true },
  m:          { short: 'm',   type: 'LENGTH', allowDecimal: true },
  centimetre: { short: 'cm',  type: 'LENGTH', allowDecimal: true },
  centimeter: { short: 'cm',  type: 'LENGTH', allowDecimal: true },
  cm:         { short: 'cm',  type: 'LENGTH', allowDecimal: true },
};

export function unitProfile(name: string): UnitProfile {
  const key = name.toLowerCase().replace(/[^a-z]/g, '');
  return UNIT_PROFILES[key]
      ?? { short: key.slice(0, 8) || 'unit', type: 'COUNT', allowDecimal: false };
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

  // Track SKUs and barcodes seen in this file. Barcode is @unique in the schema
  // exactly like SKU, but only SKU was ever checked — so a repeated barcode
  // sailed through preview and then killed the whole import on the insert.
  const seenSkus     = new Set<string>();
  const seenBarcodes = new Set<string>();

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

    const costPrice    = readNumber(r['costPrice'],    'costPrice',    rowNum, rowErrors);
    const sellPrice    = readNumber(r['sellPrice'],     'sellPrice',    rowNum, rowErrors);
    const taxPercent   = readNumber(r['taxPercent'],    'taxPercent',   rowNum, rowErrors);
    // reorderLevel is an Int column, so rounding is correct there.
    const reorderLevel = Math.round(readNumber(r['reorderLevel'], 'reorderLevel', rowNum, rowErrors));
    // openingStock is NOT rounded: Stock.qty is Decimal and units carry
    // allowDecimal, so 2.5 kg must import as 2.5 kg, not 3.
    const openingStock = readNumber(r['openingStock'],  'openingStock', rowNum, rowErrors);

    if (costPrice < 0)    rowErrors.push({ row: rowNum, field: 'costPrice',    message: 'Cost price must be >= 0' });
    if (sellPrice < 0)    rowErrors.push({ row: rowNum, field: 'sellPrice',    message: 'Sell price must be >= 0' });
    if (taxPercent < 0 || taxPercent > 100) {
      rowErrors.push({ row: rowNum, field: 'taxPercent', message: 'Tax % must be 0–100' });
    }
    if (openingStock < 0) rowErrors.push({ row: rowNum, field: 'openingStock', message: 'Opening stock must be >= 0' });

    const barcode = toStr(r['barcode']) || null;
    if (barcode) {
      // Compared exactly, because the database constraint is exact — lowercasing
      // here would invent conflicts the insert would not actually hit.
      if (seenBarcodes.has(barcode)) {
        rowErrors.push({ row: rowNum, field: 'barcode', message: `Duplicate barcode "${barcode}" within file` });
      } else {
        seenBarcodes.add(barcode);
      }
    }

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
      barcode,
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
