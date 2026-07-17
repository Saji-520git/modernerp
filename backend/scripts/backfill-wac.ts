/**
 * G1 backfill: align EXISTING data with the weighted-average cost model.
 *
 * New purchases (post-G1) already stamp batch cost + WAC in confirmPurchase.
 * This tool fixes historical rows created before G1:
 *   1. StockBatch.unitCostCents (0) → derived from the batch's originating
 *      purchase line (per-base cost), else the product's current costCents.
 *   2. Product.costCents           → recomputed as the qty-weighted average of
 *      its batches' costs; lastCostCents → the newest batch's cost.
 *
 * Idempotent + safe to re-run. Prints a BEFORE/AFTER inventory-valuation
 * reconciliation so any shift is visible.
 *
 * Passes:
 *   default : DRY-RUN — reports only, mutates nothing.
 *   --apply : writes the corrections (per-product transaction).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function rupees(cents: number): string {
  return `Rs.${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function totalValuation(): Promise<number> {
  // Valuation = Σ (on-hand base qty × product costCents) across all products.
  const products = await prisma.product.findMany({ select: { id: true, costCents: true } });
  let total = 0;
  for (const p of products) {
    const agg = await prisma.stock.aggregate({ where: { productId: p.id }, _sum: { qty: true } });
    total += Number(agg._sum.qty ?? 0) * p.costCents;
  }
  return Math.round(total);
}

async function main() {
  console.log(`\n=== G1 WAC backfill (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

  const before = await totalValuation();
  console.log(`Inventory valuation BEFORE: ${rupees(before)}`);

  // Products (id → current cost, for fallback + comparison)
  const products = await prisma.product.findMany({ select: { id: true, sku: true, name: true, costCents: true } });
  const prodCost = new Map(products.map((p) => [p.id, p.costCents]));

  // Purchase lines (id → cost/qty) for deriving batch cost.
  const allBatches = await (prisma as any).stockBatch.findMany({
    select: { id: true, productId: true, qty: true, unitCostCents: true, purchaseLineId: true, receivedAt: true },
  });
  const plIds = [...new Set(allBatches.map((b: any) => b.purchaseLineId).filter(Boolean))] as string[];
  const plRows = plIds.length
    ? await prisma.purchaseLine.findMany({
        where:  { id: { in: plIds } },
        select: { id: true, unitCostCents: true, qty: true, baseQty: true },
      })
    : [];
  const plMap = new Map(plRows.map((pl) => [pl.id, pl]));

  // Single source of truth for a batch's EFFECTIVE per-base cost (used by both
  // the backfill and the WAC recompute → dry-run and apply always agree).
  const effectiveBatchCost = (b: any): number => {
    if (b.unitCostCents > 0) return b.unitCostCents;
    const pl = b.purchaseLineId ? plMap.get(b.purchaseLineId) : undefined;
    if (pl) {
      const qty     = Number(pl.qty ?? 0);
      const baseQty = Number(pl.baseQty ?? qty);
      const factor  = baseQty > 0 && qty > 0 ? baseQty / qty : 1;
      return factor > 0 ? Math.round(pl.unitCostCents / factor) : pl.unitCostCents;
    }
    return prodCost.get(b.productId) ?? 0;
  };

  // ── 1. Backfill batch costs ──────────────────────────────────────────────
  let batchFixes = 0;
  for (const b of allBatches) {
    if (b.unitCostCents > 0) continue;
    const cost = effectiveBatchCost(b);
    if (cost > 0) {
      batchFixes++;
      if (APPLY) await (prisma as any).stockBatch.update({ where: { id: b.id }, data: { unitCostCents: cost } });
    }
  }
  console.log(`Batches with cost backfilled: ${batchFixes}${APPLY ? '' : ' (dry-run)'}`);

  // ── 2. Recompute product WAC from batches (using effective costs) ─────────
  const byProduct = new Map<string, any[]>();
  for (const b of allBatches) {
    const arr = byProduct.get(b.productId) ?? [];
    arr.push(b); byProduct.set(b.productId, arr);
  }
  let prodFixes = 0;
  for (const p of products) {
    const bs = (byProduct.get(p.id) ?? []).sort((a, b) => +new Date(b.receivedAt) - +new Date(a.receivedAt));
    if (bs.length === 0) continue;
    let qtySum = 0, valSum = 0;
    for (const b of bs) { const q = Number(b.qty); qtySum += q; valSum += q * effectiveBatchCost(b); }
    if (qtySum <= 0) continue;
    const wac      = Math.round(valSum / qtySum);
    const lastCost = effectiveBatchCost(bs[0]);
    if (wac !== p.costCents) {
      prodFixes++;
      if (!APPLY) console.log(`  ${p.sku} "${p.name}": costCents ${p.costCents} → ${wac} (last ${lastCost})`);
      if (APPLY) await prisma.product.update({ where: { id: p.id }, data: { costCents: wac, lastCostCents: lastCost } });
    }
  }
  console.log(`Products WAC-recomputed: ${prodFixes}${APPLY ? '' : ' (dry-run)'}`);

  const after = APPLY ? await totalValuation() : before;
  console.log(`\nInventory valuation AFTER:  ${rupees(after)}`);
  console.log(`Delta: ${rupees(after - before)}${APPLY ? '' : '  (dry-run — no change applied)'}\n`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
