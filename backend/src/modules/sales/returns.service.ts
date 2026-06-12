import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import type { CreateReturnInput, ListReturnsInput } from './returns.schema.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateReturnNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CRN-${year}-`;
  const count = await prisma.saleReturn.count({
    where: { number: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const returnsService = {
  // ── List returns ───────────────────────────────────────────────────────────

  list: async (input: ListReturnsInput) => {
    const { search, saleId, customerId, from, to, page, pageSize } = input;

    const where = {
      ...(saleId     && { saleId }),
      ...(customerId && { sale: { customerId } }),
      ...(from || to ? {
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to + 'T23:59:59Z') } : {}),
        },
      } : {}),
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' as const } },
          { sale: { number: { contains: search, mode: 'insensitive' as const } } },
          { reason: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [total, data] = await prisma.$transaction([
      prisma.saleReturn.count({ where }),
      prisma.saleReturn.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          sale: { select: { id: true, number: true, customer: { select: { name: true } } } },
          warehouse: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
          _count: { select: { lines: true } },
        },
      }),
    ]);

    return { total, page, pageSize, data };
  },

  // ── Get single return with lines ───────────────────────────────────────────

  getOne: async (id: string) => {
    const ret = await prisma.saleReturn.findUnique({
      where: { id },
      include: {
        sale: { select: { id: true, number: true, customer: { select: { name: true } } } },
        warehouse: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, fullName: true } },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                unit: { select: { shortCode: true } },
              },
            },
          },
        },
      },
    });
    if (!ret) throw new HttpError(404, 'Return not found');
    return ret;
  },

  // ── Get original sale with lines (for the create-return form) ─────────────

  getSaleForReturn: async (saleId: string) => {
    const sale = await prisma.sale.findUnique({
      where: { id: saleId, status: 'CONFIRMED' },
      include: {
        customer: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                unit: { select: { shortCode: true } },
              },
            },
          },
        },
        // Include existing returns to calculate already-returned quantities
        returns: {
          include: { lines: { select: { productId: true, qty: true } } },
        },
      },
    });
    if (!sale) throw new HttpError(404, 'Confirmed invoice not found');

    // Calculate already-returned qty per product
    const returnedQty = new Map<string, number>();
    for (const ret of sale.returns) {
      for (const line of ret.lines) {
        const prev = returnedQty.get(line.productId) ?? 0;
        returnedQty.set(line.productId, prev + Number(line.qty));
      }
    }

    const linesWithAvailable = sale.lines.map((l) => ({
      ...l,
      qty: Number(l.qty),
      alreadyReturnedQty: returnedQty.get(l.productId) ?? 0,
      availableToReturn: Number(l.qty) - (returnedQty.get(l.productId) ?? 0),
    }));

    return {
      ...sale,
      lines: linesWithAvailable,
    };
  },

  // ── Create return → reverse stock ─────────────────────────────────────────

  create: async (input: CreateReturnInput, userId: string) => {
    // Validate original sale
    const sale = await prisma.sale.findUnique({
      where: { id: input.saleId, status: 'CONFIRMED' },
      include: {
        lines: true,
        returns: { include: { lines: { select: { productId: true, qty: true } } } },
      },
    });
    if (!sale) throw new HttpError(404, 'Confirmed invoice not found');

    // Calculate already-returned qty per product
    const returnedQty = new Map<string, number>();
    for (const ret of sale.returns) {
      for (const line of ret.lines) {
        const prev = returnedQty.get(line.productId) ?? 0;
        returnedQty.set(line.productId, prev + Number(line.qty));
      }
    }

    // Validate each return line
    for (const rLine of input.lines) {
      const saleLine = sale.lines.find((l) => l.productId === rLine.productId);
      if (!saleLine) {
        throw new HttpError(400, `Product ${rLine.productId} not on original invoice`);
      }
      const originalQty = Number(saleLine.qty);
      const alreadyReturned = returnedQty.get(rLine.productId) ?? 0;
      const available = originalQty - alreadyReturned;
      if (rLine.qty > available) {
        const product = await prisma.product.findUnique({
          where: { id: rLine.productId },
          select: { name: true },
        });
        throw new HttpError(
          400,
          `Cannot return ${rLine.qty} of "${product?.name}" — only ${available} available to return`,
        );
      }
    }

    const number = await generateReturnNumber();
    const totalCents = input.lines.reduce((s, l) => s + l.lineTotalCents, 0);

    return prisma.$transaction(async (tx) => {
      // 1. Create return record + lines
      const ret = await tx.saleReturn.create({
        data: {
          number,
          saleId: input.saleId,
          warehouseId: sale.warehouseId,
          reason: input.reason,
          totalCents,
          createdById: userId,
          lines: {
            create: input.lines.map((l) => ({
              productId: l.productId,
              qty: l.qty,
              unitPriceCents: l.unitPriceCents,
              lineTotalCents: l.lineTotalCents,
            })),
          },
        },
        include: {
          lines: true,
          sale: { select: { id: true, number: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
      });

      // 2. Add stock back (RETURN_IN) for each line
      for (const line of input.lines) {
        // Upsert stock
        await tx.stock.upsert({
          where: {
            productId_warehouseId: {
              productId: line.productId,
              warehouseId: sale.warehouseId,
            },
          },
          create: {
            productId: line.productId,
            warehouseId: sale.warehouseId,
            qty: line.qty,
          },
          update: { qty: { increment: line.qty } },
        });

        // Stock movement
        await tx.stockMovement.create({
          data: {
            productId: line.productId,
            warehouseId: sale.warehouseId,
            type: 'RETURN_IN',
            qty: line.qty,
            refType: 'SaleReturn',
            refId: ret.id,
            note: `Return ${ret.number} (from ${ret.sale.number})`,
          },
        });
      }

      return ret;
    });
  },
};
