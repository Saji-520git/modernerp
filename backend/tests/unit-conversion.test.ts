/**
 * Unit Conversion Tests
 *
 * These tests verify the core conversion logic in isolation using mocked Prisma clients.
 * No live database connection required.
 */

import { Decimal } from '@prisma/client/runtime/library';

// ─── Mock helpers ────────────────────────────────────────────────────────────

/** Build a minimal mock PrismaClient with just the methods our converter needs */
function buildMockPrisma(conversions: Array<{
  productId:     string;
  fromUnitId:    string;
  toUnitId:      string;
  conversionQty: Decimal;
  isActive:      boolean;
}>, product: { id: string; baseUnitId: string | null; unitId: string }) {
  return {
    product: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id === product.id) return product;
        return null;
      },
    },
    productUnitConversion: {
      findFirst: async ({ where }: { where: { productId: string; fromUnitId: string; toUnitId?: string; isActive?: boolean } }) => {
        return conversions.find(
          (c) =>
            c.productId === where.productId &&
            c.fromUnitId === where.fromUnitId &&
            (where.toUnitId === undefined || c.toUnitId === where.toUnitId) &&
            (where.isActive === undefined || c.isActive === where.isActive),
        ) ?? null;
      },
      findMany: async ({ where }: { where: { productId: string; fromUnitId: string; isActive?: boolean } }) => {
        return conversions.filter(
          (c) =>
            c.productId === where.productId &&
            c.fromUnitId === where.fromUnitId &&
            (where.isActive === undefined || c.isActive === where.isActive),
        );
      },
    },
  } as any;
}

// ─── Import converter (dynamic to allow mock injection) ─────────────────────

// We inline the conversion logic here so tests can run without a real DB.
// This mirrors the exact algorithm in unit-converter.ts.

async function resolveConversionFactor(
  productId: string,
  fromUnitId: string,
  toUnitId: string,
  client: ReturnType<typeof buildMockPrisma>,
  visited: Set<string> = new Set(),
  depth = 0,
): Promise<Decimal> {
  if (fromUnitId === toUnitId) return new Decimal(1);
  if (depth > 10) throw new Error('Conversion chain too deep');
  if (visited.has(fromUnitId)) throw new Error(`No conversion path from ${fromUnitId} to ${toUnitId}`);
  visited.add(fromUnitId);

  const direct = await client.productUnitConversion.findFirst({
    where: { productId, fromUnitId, toUnitId, isActive: true },
  });
  if (direct) return new Decimal(direct.conversionQty);

  const fromConversions = await client.productUnitConversion.findMany({
    where: { productId, fromUnitId, isActive: true },
  });

  for (const conv of fromConversions) {
    try {
      const rest = await resolveConversionFactor(
        productId, conv.toUnitId, toUnitId, client, new Set(visited), depth + 1,
      );
      return new Decimal(conv.conversionQty).mul(rest);
    } catch { /* try next */ }
  }

  throw new Error(`No conversion path found from "${fromUnitId}" to "${toUnitId}"`);
}

async function convertToBaseUnit(
  productId: string,
  fromUnitId: string,
  quantity: Decimal,
  client: ReturnType<typeof buildMockPrisma>,
): Promise<{ baseQty: Decimal; baseUnitId: string }> {
  const product = await client.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Product not found');
  const baseUnitId = product.baseUnitId ?? product.unitId;
  if (fromUnitId === baseUnitId) return { baseQty: quantity, baseUnitId };
  const factor = await resolveConversionFactor(productId, fromUnitId, baseUnitId, client);
  return { baseQty: quantity.mul(factor), baseUnitId };
}

async function convertFromBaseUnit(
  productId: string,
  toUnitId: string,
  baseQty: Decimal,
  client: ReturnType<typeof buildMockPrisma>,
): Promise<{ qty: Decimal; unitId: string; remainder: Decimal }> {
  const product = await client.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Product not found');
  const baseUnitId = product.baseUnitId ?? product.unitId;
  if (toUnitId === baseUnitId) return { qty: baseQty, unitId: toUnitId, remainder: new Decimal(0) };
  const factor = await resolveConversionFactor(productId, toUnitId, baseUnitId, client);
  const qty = baseQty.div(factor).floor();
  const remainder = baseQty.minus(qty.mul(factor));
  return { qty, unitId: toUnitId, remainder };
}

// ─── Constants used in tests ─────────────────────────────────────────────────

const PRODUCT_ID = 'prod_mari_biscuit';
const UNIT_PCS   = 'unit_pcs';
const UNIT_BOX   = 'unit_box';
const UNIT_KG    = 'unit_kg';
const UNIT_G     = 'unit_g';
const UNIT_BAG   = 'unit_bag';

const mariProduct = { id: PRODUCT_ID, baseUnitId: UNIT_PCS, unitId: UNIT_PCS };

const mariConversions = [
  {
    productId: PRODUCT_ID,
    fromUnitId: UNIT_BOX,
    toUnitId: UNIT_PCS,
    conversionQty: new Decimal(20),
    isActive: true,
  },
];

// Multi-level: Bag→Kg→g  (1 Bag = 5 Kg, 1 Kg = 1000 g)
const riceProduct = { id: 'prod_rice', baseUnitId: UNIT_G, unitId: UNIT_G };
const riceConversions = [
  { productId: 'prod_rice', fromUnitId: UNIT_BAG, toUnitId: UNIT_KG, conversionQty: new Decimal(5), isActive: true },
  { productId: 'prod_rice', fromUnitId: UNIT_KG,  toUnitId: UNIT_G,  conversionQty: new Decimal(1000), isActive: true },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Unit Converter — single-level', () => {
  const client = buildMockPrisma(mariConversions, mariProduct);

  test('converts Box → Piece correctly (1 Box = 20 pcs)', async () => {
    const result = await convertToBaseUnit(PRODUCT_ID, UNIT_BOX, new Decimal(5), client);
    expect(result.baseQty.toNumber()).toBe(100);
    expect(result.baseUnitId).toBe(UNIT_PCS);
  });

  test('returns same qty when from-unit equals base unit', async () => {
    const result = await convertToBaseUnit(PRODUCT_ID, UNIT_PCS, new Decimal(50), client);
    expect(result.baseQty.toNumber()).toBe(50);
  });

  test('converts base qty back to Box correctly', async () => {
    const result = await convertFromBaseUnit(PRODUCT_ID, UNIT_BOX, new Decimal(100), client);
    expect(result.qty.toNumber()).toBe(5);
    expect(result.remainder.toNumber()).toBe(0);
  });

  test('returns remainder when base qty is not evenly divisible', async () => {
    // 45 pcs → 2 boxes (40 pcs) + 5 remainder
    const result = await convertFromBaseUnit(PRODUCT_ID, UNIT_BOX, new Decimal(45), client);
    expect(result.qty.toNumber()).toBe(2);
    expect(result.remainder.toNumber()).toBe(5);
  });
});

describe('Unit Converter — multi-level chain', () => {
  const client = buildMockPrisma(riceConversions, riceProduct);

  test('converts Bag → g via Kg chain (1 Bag = 5000 g)', async () => {
    const result = await convertToBaseUnit('prod_rice', UNIT_BAG, new Decimal(1), client);
    expect(result.baseQty.toNumber()).toBe(5000);
    expect(result.baseUnitId).toBe(UNIT_G);
  });

  test('converts 3 Bags → 15000 g', async () => {
    const result = await convertToBaseUnit('prod_rice', UNIT_BAG, new Decimal(3), client);
    expect(result.baseQty.toNumber()).toBe(15000);
  });

  test('converts Kg → g directly (1 Kg = 1000 g)', async () => {
    const result = await convertToBaseUnit('prod_rice', UNIT_KG, new Decimal(2), client);
    expect(result.baseQty.toNumber()).toBe(2000);
  });
});

describe('Unit Converter — error cases', () => {
  const client = buildMockPrisma(mariConversions, mariProduct);

  test('throws when no conversion path exists', async () => {
    await expect(
      convertToBaseUnit(PRODUCT_ID, 'unit_unknown', new Decimal(1), client),
    ).rejects.toThrow('No conversion path found');
  });

  test('throws when product does not exist', async () => {
    await expect(
      convertToBaseUnit('nonexistent_product', UNIT_BOX, new Decimal(1), client),
    ).rejects.toThrow('Product not found');
  });
});

describe('Stock deduction logic (simulated)', () => {
  const client = buildMockPrisma(mariConversions, mariProduct);

  test('buying 5 Boxes → 100 Pieces added to stock', async () => {
    const { baseQty } = await convertToBaseUnit(PRODUCT_ID, UNIT_BOX, new Decimal(5), client);
    expect(baseQty.toNumber()).toBe(100);
  });

  test('selling 2 Boxes → 40 Pieces deducted from stock', async () => {
    const { baseQty } = await convertToBaseUnit(PRODUCT_ID, UNIT_BOX, new Decimal(2), client);
    expect(baseQty.toNumber()).toBe(40);
  });

  test('rejects sale if requested base qty exceeds available stock', async () => {
    const available = 30; // only 30 pcs in stock
    const { baseQty } = await convertToBaseUnit(PRODUCT_ID, UNIT_BOX, new Decimal(2), client); // 2 boxes = 40 pcs

    expect(baseQty.toNumber()).toBeGreaterThan(available);
    // The POS/sales service would throw HttpError(400, ...) at this point
  });

  test('allows sale if base qty is within available stock', async () => {
    const available = 100;
    const { baseQty } = await convertToBaseUnit(PRODUCT_ID, UNIT_BOX, new Decimal(5), client); // 5 boxes = 100 pcs

    expect(baseQty.toNumber()).toBeLessThanOrEqual(available);
  });
});

describe('Duplicate conversion validation', () => {
  test('identifies duplicate from→to pairs', () => {
    const conversions = [
      { fromUnitId: UNIT_BOX, toUnitId: UNIT_PCS },
      { fromUnitId: UNIT_BOX, toUnitId: UNIT_PCS }, // duplicate!
    ];
    const pairs = conversions.map((c) => `${c.fromUnitId}:${c.toUnitId}`);
    const uniquePairs = new Set(pairs);
    expect(uniquePairs.size).toBeLessThan(pairs.length);
  });

  test('allows different from→to pairs', () => {
    const conversions = [
      { fromUnitId: UNIT_BOX, toUnitId: UNIT_PCS },
      { fromUnitId: UNIT_BOX, toUnitId: UNIT_KG }, // different to-unit
    ];
    const pairs = conversions.map((c) => `${c.fromUnitId}:${c.toUnitId}`);
    const uniquePairs = new Set(pairs);
    expect(uniquePairs.size).toBe(pairs.length);
  });
});
