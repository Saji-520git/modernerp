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
  isDamaged?:        boolean;
  batchNumber?:      string | null;
  expiryDate?:       Date | null;
}

export interface FindOrCreateBatchResult {
  batchId: string;
  merged:  boolean;   // true = quantity was added to an existing batch, false = new batch created
}

// A new delivery merges into an existing open batch (qty > 0) for the same
// product+warehouse ONLY when cost, selling price, supplier AND damaged status
// all match exactly — otherwise it becomes its own batch. Matching intentionally
// does NOT consider expiryDate or batchNumber (not part of the spec); a merge
// into a batch with a different expiry keeps the EXISTING batch's expiry — the
// new delivery's expiry is not applied retroactively.
//
// isDamaged is part of the key so accepted-damaged stock can never merge into a
// batch of good stock, even in the rare case where cost, price and supplier all
// coincide — the two are not interchangeable on the shelf.
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
      isDamaged:         input.isDamaged ?? false,
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
      isDamaged:         input.isDamaged ?? false,
      batchNumber:       input.batchNumber ?? null,
      expiryDate:        input.expiryDate ?? null,
    },
  });
  return { batchId: created.id, merged: false };
}
