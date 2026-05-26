/**
 * One-time data correction: set ELC-002 stock to the movement-sum
 * excluding WRITE_OFF entries (pre-write-off correct balance = 40).
 *
 * Background:
 *   - purchase-return backfill set stock = 43
 *   - user then ran 3 write-off operations (50+30+25 = 105 units) against
 *     inflated batch records, bringing stock.qty to -65
 *   - movement-sum without WRITE_OFF = 105 - 20 + 10 - 55 = 40
 *   - those write-offs were against already-zero real batches and should
 *     be considered invalid; correct stock = 40
 *
 * Run:
 *   npx tsx scripts/fix-elc002-stock.ts          (dry-run)
 *   npx tsx scripts/fix-elc002-stock.ts --apply   (apply)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY  = process.argv.includes('--apply');

async function main() {
  const product = await prisma.product.findFirst({
    where:  { sku: 'ELC-002' },
    select: { id: true, name: true },
  });
  if (!product) { console.error('ELC-002 not found'); process.exit(1); }

  // Compute movement-sum excluding WRITE_OFF
  const movements = await prisma.stockMovement.findMany({
    where: { productId: product.id },
  });

  const correctQty = movements
    .filter((m) => m.type !== 'WRITE_OFF')
    .reduce((sum, m) => {
      const q = Number(m.qty);
      if (['PURCHASE_IN', 'RETURN_IN', 'ADJUSTMENT_IN', 'TRANSFER_IN'].includes(m.type)) return sum + Math.abs(q);
      if (['SALE_OUT', 'TRANSFER_OUT'].includes(m.type))                                   return sum - Math.abs(q);
      if (m.type === 'RETURN_OUT')                                                         return sum - Math.abs(q);
      if (m.type === 'ADJUSTMENT')                                                         return sum + q;
      return sum + q;
    }, 0);

  const stockRow = await prisma.stock.findFirst({ where: { productId: product.id } });
  const current  = stockRow ? Number(stockRow.qty) : null;

  console.log(`Product : ${product.name} (${product.id})`);
  console.log(`Current : ${current ?? 'NO ROW'}`);
  console.log(`Correct : ${correctQty}`);

  if (!APPLY) {
    console.log('\nDry-run — pass --apply to write.');
    return;
  }

  if (!stockRow) {
    console.error('No stock row found — nothing to update.');
    return;
  }

  await prisma.stock.update({
    where: { id: stockRow.id },
    data:  { qty: correctQty },
  });
  console.log(`\n✓ stock.qty set to ${correctQty}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
