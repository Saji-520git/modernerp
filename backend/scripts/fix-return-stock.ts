/**
 * Diagnostic + fix script for purchase returns confirmed before the
 * stock.upsert patch (commit 27156ea).
 *
 * Detection method:
 *   OLD code stored StockMovement.qty as NEGATIVE (-returnQty).
 *   NEW code stores it as POSITIVE (+returnQty).
 *   → Any RETURN_OUT movement with qty < 0 is pre-fix.
 *   → For each pre-fix movement, the stock.updateMany silently skipped
 *     if the row didn't exist, so we compute the correct balance
 *     from ALL movements and compare to actual stock.
 *
 * Run in two passes:
 *   Pass 1 (default): diagnostic — prints findings, applies nothing.
 *   Pass 2 (--fix):   applies the corrections reported in pass 1.
 */

import { PrismaClient } from '@prisma/client';

const prisma  = new PrismaClient();
const APPLY   = process.argv.includes('--fix');

async function main() {
  console.log(APPLY ? '\n=== APPLY MODE ===\n' : '\n=== DIAGNOSTIC MODE (dry run) ===\n');

  // ── 1. Find all confirmed purchase returns ──────────────────────────────────
  const returns = await (prisma as any).purchaseReturn.findMany({
    where:   { status: 'CONFIRMED', isActive: true },
    include: { lines: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Confirmed purchase returns: ${returns.length}\n`);

  // ── 2. For each return-line, check if movement is pre-fix ───────────────────
  const toFix: Array<{
    returnNumber: string;
    productSku:   string;
    productId:    string;
    warehouseId:  string;
    returnQty:    number;
    movementQty:  number;
    actualStock:  number | null;
    correctStock: number | null;
  }> = [];

  for (const ret of returns) {
    for (const line of ret.lines) {
      const movement = await prisma.stockMovement.findFirst({
        where: { refType: 'PurchaseReturn', refId: ret.id, productId: line.productId },
      });

      if (!movement) {
        console.log(`${ret.number}  ⚠ NO movement found — skipping`);
        continue;
      }

      const movQty    = Number(movement.qty);
      const returnQty = Number(line.qty);
      const product   = await prisma.product.findUnique({
        where:  { id: line.productId },
        select: { name: true, sku: true },
      });

      const isPreFix = movQty < 0; // old code stored negative qty

      // Compute expected stock from all movements (ground truth)
      const movements = await prisma.stockMovement.findMany({
        where: { productId: line.productId, warehouseId: ret.warehouseId },
      });
      const movementSum = movements.reduce((s, m) => {
        const q = Number(m.qty);
        // PURCHASE_IN / RETURN_IN → positive; SALE_OUT / RETURN_OUT / WRITE_OFF → negative
        // But old RETURN_OUT stored negative qty, so we need to interpret by type+sign:
        if (['PURCHASE_IN', 'RETURN_IN', 'ADJUSTMENT_IN', 'TRANSFER_IN'].includes(m.type)) {
          return s + Math.abs(q);
        }
        if (['SALE_OUT', 'WRITE_OFF', 'TRANSFER_OUT'].includes(m.type)) {
          return s - Math.abs(q);
        }
        if (m.type === 'RETURN_OUT') {
          // Post-fix: stored as positive qty → means outgoing → subtract
          // Pre-fix:  stored as negative qty → means outgoing → also subtract
          return s - Math.abs(q);
        }
        if (m.type === 'ADJUSTMENT') {
          return s + q; // signed
        }
        return s + q;
      }, 0);

      const stockRow   = await prisma.stock.findUnique({
        where: { productId_warehouseId: { productId: line.productId, warehouseId: ret.warehouseId } },
      });
      const actualStock = stockRow ? Number(stockRow.qty) : null;
      const delta       = actualStock !== null ? actualStock - movementSum : null;

      console.log(
        `${ret.number}  ${product?.sku ?? line.productId}` +
        `  returnQty=${returnQty}  movQty=${movQty}  preFix=${isPreFix}` +
        `  actual=${actualStock ?? 'NO ROW'}  movementSum=${movementSum.toFixed(4)}` +
        `  drift=${delta !== null ? delta.toFixed(4) : 'N/A'}`,
      );

      // Flag if pre-fix AND stock is higher than movement sum would predict
      // (i.e. the decrement was NOT applied — stock was over-counted)
      if (isPreFix && delta !== null && Math.abs(delta) > 0.0001) {
        toFix.push({
          returnNumber: ret.number,
          productSku:   product?.sku ?? '?',
          productId:    line.productId,
          warehouseId:  ret.warehouseId,
          returnQty,
          movementQty:  movQty,
          actualStock,
          correctStock: movementSum,
        });
      }
    }
  }

  // ── 3. Report ───────────────────────────────────────────────────────────────
  console.log('\n─── Stock corrections needed ─────────────────────────────────');
  if (toFix.length === 0) {
    console.log('None — all stock rows match their movement history. ✓');
  } else {
    toFix.forEach((b) => {
      console.log(
        `  ${b.returnNumber}  ${b.productSku}` +
        `  actual=${b.actualStock}  correct=${b.correctStock!.toFixed(4)}` +
        `  diff=${(b.actualStock! - b.correctStock!).toFixed(4)}`,
      );
    });
  }

  // ── 4. Apply fix if --fix flag is set ───────────────────────────────────────
  if (APPLY && toFix.length > 0) {
    console.log('\nApplying corrections…');
    for (const b of toFix) {
      await prisma.stock.update({
        where: {
          productId_warehouseId: {
            productId:   b.productId,
            warehouseId: b.warehouseId,
          },
        },
        data: { qty: b.correctStock! },
      });
      console.log(`  ✓ ${b.returnNumber} ${b.productSku}: set stock = ${b.correctStock!.toFixed(4)}`);
    }
    console.log('\nAll corrections applied.');
  } else if (APPLY) {
    console.log('\nNothing to fix.');
  } else if (toFix.length > 0) {
    console.log('\nRun with --fix to apply these corrections:');
    console.log('  npm run fix:return-stock -- --fix');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
