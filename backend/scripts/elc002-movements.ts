import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const product = await prisma.product.findFirst({
    where: { sku: 'ELC-002' },
    select: { id: true, name: true },
  });
  if (!product) { console.log('ELC-002 not found'); return; }
  console.log('Product:', product.name, product.id);

  const moves = await prisma.stockMovement.findMany({
    where: { productId: product.id },
    orderBy: { createdAt: 'asc' },
    select: { type: true, qty: true, refType: true, note: true, createdAt: true },
  });

  let running = 0;
  const byType: Record<string, number> = {};
  console.log('\nDate        Type            Qty       Running  Note');
  for (const m of moves) {
    const q = Number(m.qty);
    byType[m.type] = (byType[m.type] ?? 0) + q;
    running += q;
    const qs = (q >= 0 ? '+' : '') + q.toFixed(0);
    console.log(
      m.createdAt.toISOString().slice(0, 10),
      m.type.padEnd(16),
      qs.padStart(6),
      '  ',
      running.toFixed(0).padStart(6),
      ' ',
      (m.note ?? '').slice(0, 40),
    );
  }

  console.log('\nSummary by type:');
  for (const [t, q] of Object.entries(byType)) {
    console.log(' ', t.padEnd(16), q.toFixed(0).padStart(8));
  }

  console.log('\nMovement sum:', running.toFixed(4));

  const stock = await prisma.stock.findFirst({
    where: { productId: product.id },
    select: { qty: true, warehouseId: true },
  });
  console.log('Actual stock.qty:', Number(stock?.qty));

  // Movement sum excluding WRITE_OFF
  const sumNoWriteOff = Object.entries(byType)
    .filter(([t]) => t !== 'WRITE_OFF')
    .reduce((s, [, q]) => s + q, 0);
  console.log('Sum without write-offs:', sumNoWriteOff.toFixed(4), '(correct qty if write-offs are invalid)');

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
