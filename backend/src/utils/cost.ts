// ─── Costing utilities (G1) ─────────────────────────────────────────────────────
// Weighted-average cost (WAC) — the professional inventory-valuation method.
// Every stock receipt blends its cost into the product's running average, so the
// average tracks real cost as supplier prices drift over time. All values are
// integer cents, per BASE unit (stock is always held in base units).

/**
 * Blend a new receipt into the existing weighted average.
 *
 *   newAvg = (existingQty·existingAvg + recvQty·recvCost) / (existingQty + recvQty)
 *
 * Guards:
 *  - nothing on hand after this receipt (total ≤ 0)  → keep existing average
 *  - zero/negative received qty (not a real receipt) → keep existing average
 *  - first stock for the product (existing ≤ 0)      → the received cost becomes the average
 *
 * @param existingQty        current on-hand qty (base units) BEFORE this receipt
 * @param existingAvgCents   current weighted-average cost (cents / base unit)
 * @param recvQty            qty being received now (base units)
 * @param recvUnitCostCents  cost of the received goods (cents / base unit)
 * @returns the new weighted-average cost, rounded to whole cents
 */
export function computeWAC(
  existingQty: number,
  existingAvgCents: number,
  recvQty: number,
  recvUnitCostCents: number,
): number {
  const totalQty = existingQty + recvQty;
  if (totalQty <= 0) return Math.round(existingAvgCents);
  if (recvQty <= 0) return Math.round(existingAvgCents);
  if (existingQty <= 0) return Math.round(recvUnitCostCents);

  const blendedValue = existingQty * existingAvgCents + recvQty * recvUnitCostCents;
  return Math.round(blendedValue / totalQty);
}
