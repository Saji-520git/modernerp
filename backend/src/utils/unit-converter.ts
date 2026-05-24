import { Decimal } from '@prisma/client/runtime/library';
import type { PrismaClient } from '@prisma/client';

type TxClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Recursively resolves how many toUnits are in one fromUnit via the conversion chain.
 * Throws if no path exists within 10 hops (prevents infinite loops).
 */
async function resolveConversionFactor(
  productId: string,
  fromUnitId: string,
  toUnitId: string,
  client: TxClient,
  visited: Set<string> = new Set(),
  depth = 0,
): Promise<Decimal> {
  if (fromUnitId === toUnitId) return new Decimal(1);
  if (depth > 10) throw new Error('Conversion chain too deep — possible cycle');
  if (visited.has(fromUnitId)) throw new Error(`No conversion path from ${fromUnitId} to ${toUnitId}`);
  visited.add(fromUnitId);

  // Direct conversion: fromUnit → toUnit
  const direct = await client.productUnitConversion.findFirst({
    where: { productId, fromUnitId, toUnitId, isActive: true },
  });
  if (direct) return direct.conversionQty;

  // Indirect: fromUnit → X → toUnit
  const fromConversions = await client.productUnitConversion.findMany({
    where: { productId, fromUnitId, isActive: true },
  });

  for (const conv of fromConversions) {
    try {
      const rest = await resolveConversionFactor(
        productId,
        conv.toUnitId,
        toUnitId,
        client,
        new Set(visited),
        depth + 1,
      );
      return conv.conversionQty.mul(rest);
    } catch {
      // try next branch
    }
  }

  throw new Error(`No conversion path found from unit "${fromUnitId}" to unit "${toUnitId}" for product "${productId}"`);
}

/**
 * Convert qty from any unit to the product's base unit.
 * Example: 5 Boxes → 100 Pieces (if 1 Box = 20 Pieces and base unit is Piece)
 */
export async function convertToBaseUnit(
  productId: string,
  fromUnitId: string,
  quantity: Decimal,
  client: TxClient,
): Promise<{ baseQty: Decimal; baseUnitId: string }> {
  const product = await client.product.findUnique({
    where: { id: productId },
    select: { baseUnitId: true, unitId: true },
  });
  if (!product) throw new Error(`Product ${productId} not found`);

  // Use baseUnitId if set, otherwise fall back to legacy unitId
  const baseUnitId = product.baseUnitId ?? product.unitId;

  if (fromUnitId === baseUnitId) {
    return { baseQty: quantity, baseUnitId };
  }

  const factor = await resolveConversionFactor(productId, fromUnitId, baseUnitId, client);
  return { baseQty: quantity.mul(factor), baseUnitId };
}

/**
 * Convert base-unit qty back to a display unit.
 * Returns whole units and any remainder in base units.
 * Example: 100 Pieces → 5 Boxes (remainder 0) if 1 Box = 20 Pieces
 */
export async function convertFromBaseUnit(
  productId: string,
  toUnitId: string,
  baseQty: Decimal,
  client: TxClient,
): Promise<{ qty: Decimal; unitId: string; remainder: Decimal }> {
  const product = await client.product.findUnique({
    where: { id: productId },
    select: { baseUnitId: true, unitId: true },
  });
  if (!product) throw new Error(`Product ${productId} not found`);

  const baseUnitId = product.baseUnitId ?? product.unitId;

  if (toUnitId === baseUnitId) {
    return { qty: baseQty, unitId: toUnitId, remainder: new Decimal(0) };
  }

  // factor = how many base units per 1 display unit
  const factor = await resolveConversionFactor(productId, toUnitId, baseUnitId, client);
  const qty = baseQty.div(factor).floor();
  const remainder = baseQty.minus(qty.mul(factor));
  return { qty, unitId: toUnitId, remainder };
}

/**
 * Get the selling price in cents for a given unit.
 * Uses unit-specific override if present, otherwise scales base price.
 * Example: base price 10 pcs → box price = 10 * 20 = 200 (if 1 box = 20 pcs)
 */
export async function getUnitPrice(
  productId: string,
  unitId: string,
  basePriceCents: number,
  client: TxClient,
): Promise<number> {
  const product = await client.product.findUnique({
    where: { id: productId },
    select: { baseUnitId: true, unitId: true },
  });
  if (!product) throw new Error(`Product ${productId} not found`);

  const baseUnitId = product.baseUnitId ?? product.unitId;
  if (unitId === baseUnitId) return basePriceCents;

  // Check for explicit price override on the conversion
  const conv = await client.productUnitConversion.findFirst({
    where: { productId, fromUnitId: unitId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  if (conv?.priceCents != null) return conv.priceCents;

  // Scale: unit price = base price * conversion factor (units per package)
  const factor = await resolveConversionFactor(productId, unitId, baseUnitId, client);
  return Math.round(basePriceCents * factor.toNumber());
}
