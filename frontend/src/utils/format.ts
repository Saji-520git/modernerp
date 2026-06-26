/**
 * Frontend display helpers for stock quantities.
 * Extracted from POSPage in v1.0.72 chunk 8a so multiple pages
 * (POS, Inventory, Products) can share the same display logic.
 */

/** Display qty: whole numbers as integers, decimals to 3 places (e.g. 0.500 kg) */
export function fmtQty(qty: number): string {
  return Number.isInteger(qty) ? qty.toString() : qty.toFixed(3);
}

/**
 * Minimal product shape needed for formatStockDisplay.
 * Compatible with PosProduct, StockRow.product (chunk 7a), and
 * the Products page product shape (after chunk 8c enrichment).
 * Keyed on unit.id rather than a top-level unitId for cross-consumer
 * compatibility.
 */
interface StockDisplayProduct {
  baseUnitId: string | null;
  unit:     { id: string; shortCode: string } | null;
  baseUnit: { shortCode: string } | null;
  unitConversions: Array<{
    toUnitId: string;
    conversionQty: number;
    fromUnit: { shortCode: string } | null;
  }>;
}

/**
 * Format stock as "{qty} {baseUnit}" with optional pack breakdown
 * "({whole} {packLabel} + {rem})" when a larger pack unit exists.
 * Number is always the base-unit quantity; label is the base unit.
 * conversionQty is typed as number but serializes as JSON string at
 * runtime (Decimal(18,6)) — kept Number()-wrapped for safety.
 */
export function formatStockDisplay(
  product: StockDisplayProduct,
  baseQty: number,
): string {
  const baseUnit  = product.baseUnit ?? product.unit;
  const baseLabel = baseUnit?.shortCode ?? 'unit';

  const baseUnitId = product.baseUnitId ?? product.unit?.id;
  const packs = (product.unitConversions ?? [])
    .filter(c => c.toUnitId === baseUnitId)
    .map(c => ({
      label:  c.fromUnit?.shortCode ?? 'pack',
      factor: Number(c.conversionQty),
    }))
    .filter(p => p.factor > 1)
    .sort((a, b) => b.factor - a.factor);

  let display = `${fmtQty(baseQty)} ${baseLabel}`;

  if (packs.length > 0) {
    const pack  = packs[0];
    const whole = Math.floor(baseQty / pack.factor);
    const rem   = baseQty % pack.factor;
    if (whole > 0) {
      display += ` (${whole} ${pack.label}${rem > 0 ? ` + ${fmtQty(rem)}` : ''})`;
    }
  }

  return display;
}
