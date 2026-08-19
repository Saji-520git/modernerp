/**
 * Product import — file parsing and validation. Pure, no DB.
 *
 * These exist because the importer accepted bad data silently. Numbers went
 * through parseFloat with a 0 fallback, which takes any valid PREFIX and drops
 * the rest, and nothing was ever flagged:
 *
 *     "1 200"   imported as 1        (1200x under)
 *     "Rs. 450" imported as 0        (the product became free)
 *     "12o0"    imported as 12       (100x under)
 *
 * On a price column that is the worst failure mode available — quiet and wrong.
 * Barcode was worse in the other direction: it is @unique in the schema but was
 * never validated, so preview called a file clean and the insert then failed the
 * ENTIRE import on a constraint with no row number.
 */
import { parseProductsFile } from '../src/modules/import/import-parse';

const csv = (lines: string[]) => Buffer.from(lines.join('\n'), 'utf8');
const HEAD = 'name,sku,barcode,category,brand,unit,costPrice,sellPrice,taxPercent,reorderLevel,openingStock,warehouse';
const row = (over: Partial<Record<string, string>> = {}) => {
  const d: Record<string, string> = { name:'P', sku:'S1', barcode:'', category:'', brand:'',
    unit:'Piece', costPrice:'10', sellPrice:'20', taxPercent:'0', reorderLevel:'0',
    openingStock:'0', warehouse:'' , ...over };
  return [d.name,d.sku,d.barcode,d.category,d.brand,d.unit,d.costPrice,d.sellPrice,
          d.taxPercent,d.reorderLevel,d.openingStock,d.warehouse].join(',');
};
const parse = (rows: string[]) => parseProductsFile(csv([HEAD, ...rows]), 'text/csv');

describe('numbers a real spreadsheet produces are cleaned', () => {
  it.each([
    ['1200',     1200, 'plain'],
    ['1 200',    1200, 'space thousands separator'],
    ['Rs. 450',   450, 'currency prefix'],
    ['450/=',     450, 'local currency suffix'],
    ['1e3',      1000, 'scientific notation from Excel'],
    ['2.5',       2.5, 'decimal'],
  ])('%s → %s (%s)', (input, expected) => {
    const r = parse([row({ sellPrice: String(input) })]);
    expect(r.errors).toEqual([]);
    expect(r.valid[0].sellPrice).toBe(expected);
  });
});

describe('anything still ambiguous is an error, never a guess', () => {
  it.each([
    ['12o0',  'letter o typed for a zero'],
    ['abc',   'pure text'],
    ['1.5.0', 'two decimal points'],
    ['--5',   'double sign'],
  ])('%s is rejected (%s)', (input) => {
    const r = parse([row({ sellPrice: input })]);
    expect(r.valid).toHaveLength(0);
    expect(r.errors.some(e => e.field === 'sellPrice')).toBe(true);
  });

  it('an accounting negative surfaces as a negative, not as zero', () => {
    // (500) used to read as 0 — a free product. It must reach the >= 0 check.
    const r = parse([row({ sellPrice: '(500)' })]);
    expect(r.valid).toHaveLength(0);
    expect(r.errors.some(e => /must be >= 0/.test(e.message))).toBe(true);
  });

  it('a blank cell is "not supplied", not an error', () => {
    const r = parse([row({ taxPercent: '', reorderLevel: '' })]);
    expect(r.errors).toEqual([]);
    expect(r.valid[0].taxPercent).toBe(0);
  });
});

describe('barcode is @unique, so the file is checked for its own duplicates', () => {
  it('flags the same barcode twice in one file', () => {
    const r = parse([
      row({ sku: 'A', barcode: '4001234567890' }),
      row({ sku: 'B', barcode: '4001234567890' }),
    ]);
    expect(r.errors.some(e => e.field === 'barcode')).toBe(true);
    expect(r.valid).toHaveLength(1);
  });

  it('compares exactly, since the database constraint is exact', () => {
    // Lowercasing here would invent a clash the insert would not hit.
    const r = parse([row({ sku:'A', barcode:'abc' }), row({ sku:'B', barcode:'ABC' })]);
    expect(r.errors.filter(e => e.field === 'barcode')).toEqual([]);
    expect(r.valid).toHaveLength(2);
  });

  it('lets many rows omit the barcode without colliding on empty', () => {
    const r = parse([row({ sku:'A' }), row({ sku:'B' }), row({ sku:'C' })]);
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(3);
  });
});

describe('quantities keep the precision the column supports', () => {
  it('preserves a fractional opening stock', () => {
    // Stock.qty is Decimal and units carry allowDecimal — 2.5 kg is 2.5 kg.
    const r = parse([row({ openingStock: '2.5', warehouse: 'Main Warehouse' })]);
    expect(r.valid[0].openingStock).toBe(2.5);
  });

  it('still rounds reorderLevel, which is an Int column', () => {
    const r = parse([row({ reorderLevel: '4.6' })]);
    expect(r.valid[0].reorderLevel).toBe(5);
  });
});

describe('the checks that already worked keep working', () => {
  it('requires name and sku', () => {
    const r = parse([row({ name: '', sku: '' })]);
    expect(r.errors.map(e => e.field).sort()).toEqual(['name', 'sku']);
  });

  it('flags a duplicate SKU within the file', () => {
    const r = parse([row({ sku: 'DUP' }), row({ sku: 'DUP' })]);
    expect(r.errors.some(e => e.field === 'sku')).toBe(true);
  });

  it('requires a warehouse once opening stock is positive', () => {
    const r = parse([row({ openingStock: '5', warehouse: '' })]);
    expect(r.errors.some(e => e.field === 'warehouseName')).toBe(true);
  });

  it('accepts the alternate column headings people actually use', () => {
    const r = parseProductsFile(csv([
      'Product Name,Item Code,Selling Price,Cost,Opening Qty,Location,UOM',
      'Rice,RC-1,150,100,4,Main Warehouse,Piece',
    ]), 'text/csv');
    expect(r.errors).toEqual([]);
    expect(r.valid[0]).toMatchObject({ name:'Rice', sku:'RC-1', sellPrice:150,
      costPrice:100, openingStock:4, warehouseName:'Main Warehouse', unit:'Piece' });
  });

  it('reports an empty file rather than importing nothing quietly', () => {
    const r = parseProductsFile(csv([HEAD]), 'text/csv');
    expect(r.errors.some(e => e.field === 'file')).toBe(true);
  });
});
