import { Decimal } from '@prisma/client/runtime/library';
import type { Prisma } from '@prisma/client';

export interface FindOrCreateBatchInput {
  productId:         string;
  warehouseId:       string;
  purchaseLineId:    string | null;
  qty:               Decimal | number;
  unitCostCents:     number;
  sellingPriceCents: number;
  supplierId:        string | null;
  batchNumber?:      string | null;
  expiryDate?:       Date | null;
}

export interface FindOrCreateBatchResult {
  batchId: string;
  merged:  boolean;   // true = quantity was added to an existing batch, false = new batch created
}

// A new delivery merges into an existing open batch (qty > 0) for the same
// product+warehouse ONLY when cost, selling price, AND supplier all match
// exactly — otherwise it becomes its own batch. Matching intentionally does
// NOT consider expiryDate or batchNumber (not part of the spec); a merge into
// a batch with a different expiry keeps the EXISTING batch's expiry — the new
// delivery's expiry is not applied retroactively.
export async function findOrCreateBatch(
  tx: Prisma.TransactionClient,
  input: FindOrCreateBatchInput,
): Promise<FindOrCreateBatchResult> {
  const existing = await tx.stockBatch.findFirst({
    where: {
      productId:         input.productId,
      warehouseId:       input.warehouseId,
      qty:               { gt: 0 },
      unitCostCents:     input.unitCostCents,
      sellingPriceCents: input.sellingPriceCents,
      supplierId:        input.supplierId,
    },
    orderBy: { receivedAt: 'asc' },
  });

  if (existing) {
    await tx.stockBatch.update({
      where: { id: existing.id },
      data:  { qty: { increment: input.qty } },
    });
    return { batchId: existing.id, merged: true };
  }

  const created = await tx.stockBatch.create({
    data: {
      productId:         input.productId,
      warehouseId:       input.warehouseId,
      purchaseLineId:    input.purchaseLineId,
      qty:               input.qty,
      unitCostCents:     input.unitCostCents,
      sellingPriceCents: input.sellingPriceCents,
      supplierId:        input.supplierId,
      batchNumber:       input.batchNumber ?? null,
      expiryDate:        input.expiryDate ?? null,
    },
  });
  return { batchId: created.id, merged: false };
}
