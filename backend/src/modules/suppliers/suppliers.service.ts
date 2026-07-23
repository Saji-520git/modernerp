import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import type { SupplierBodyInput, ListSuppliersInput } from './suppliers.schema.js';

// Normalize a name/phone for duplicate comparison (trim + lower-case).
const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();

// Three-tier duplicate-name guard — enforced here so EVERY create/update entry
// point is covered (Suppliers list page, Purchases quick-add supplier, etc.).
// No DB uniqueness constraint; this is an advisory 409 with a clear message.
//   no name match             → allow
//   name match, no phone      → 409, require a phone to distinguish
//   name + phone both match   → 409, likely duplicate
//   name match, phone differs → allow (genuinely different supplier)
async function assertNoDuplicateSupplier(
  name: string,
  phone: string | null | undefined,
  excludeId?: string,
): Promise<void> {
  const candidates = await prisma.supplier.findMany({
    where: { name: { contains: name.trim(), mode: 'insensitive' as const }, isActive: true },
    select: { id: true, name: true, phone: true },
  });
  const nameMatches = candidates.filter((c) => norm(c.name) === norm(name) && c.id !== excludeId);
  if (nameMatches.length === 0) return;
  const p = (phone ?? '').trim();
  if (!p) {
    throw new HttpError(
      409,
      `A supplier named '${name.trim()}' already exists. Please enter a phone number to distinguish this supplier.`,
    );
  }
  if (nameMatches.some((c) => norm(c.phone) === norm(p))) {
    throw new HttpError(
      409,
      `A supplier named '${name.trim()}' with this phone number already exists. This may be a duplicate — please check the existing supplier list.`,
    );
  }
}

export const suppliersService = {
  list: async (input: ListSuppliersInput) => {
    const { search, page, pageSize } = input;
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [total, data] = await prisma.$transaction([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { purchases: true } } },
      }),
    ]);

    return { total, page, pageSize, data };
  },

  getOne: async (id: string) => {
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: { _count: { select: { purchases: true } } },
    });
    if (!supplier) throw new HttpError(404, 'Supplier not found');

    const purchasesAgg = await (prisma as any).purchase.aggregate({
      where: { supplierId: id, status: 'CONFIRMED', deletedAt: null },
      // Amount owed follows the delivered value (payable), not the ordered total.
      _sum: { receivedValueCents: true, paidCents: true },
      _max: { date: true },
    });

    const totalPurchaseAmount = purchasesAgg._sum.receivedValueCents ?? 0;
    const totalPaid           = purchasesAgg._sum.paidCents  ?? 0;
    const lastOrderDate       = purchasesAgg._max.date ?? null;

    const returnsAgg = await (prisma as any).purchaseReturn.aggregate({
      where: { supplierId: id, isActive: true },
      _count: { id: true },
    });
    const totalReturns = returnsAgg._count.id ?? 0;

    // Option B — totals are never mutated; subtract CONFIRMED return value here.
    const confirmedReturnsAgg = await (prisma as any).purchaseReturn.aggregate({
      where: { supplierId: id, status: 'CONFIRMED', isActive: true },
      _sum: { totalCents: true },
    });
    const totalReturnedCents = confirmedReturnsAgg._sum.totalCents ?? 0;

    const outstandingBalance = Math.max(
      0,
      totalPurchaseAmount - totalPaid - totalReturnedCents,
    );

    return {
      ...supplier,
      totalPurchaseAmount,
      totalPaid,
      outstandingBalance,
      lastOrderDate,
      totalReturns,
    };
  },

  create: async (input: SupplierBodyInput) => {
    await assertNoDuplicateSupplier(input.name, input.phone);
    return prisma.supplier.create({
      data: {
        name: input.name,
        phone: input.phone || null,
        email: input.email || null,
        address: input.address || null,
      },
    });
  },

  update: async (id: string, input: SupplierBodyInput) => {
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Supplier not found');
    // Only enforce the dup-guard when the identifying values actually change,
    // so editing an unrelated field (address/email) on a record that already
    // shares a name with another never gets retroactively blocked.
    if (norm(existing.name) !== norm(input.name) || norm(existing.phone) !== norm(input.phone)) {
      await assertNoDuplicateSupplier(input.name, input.phone, id);
    }
    return prisma.supplier.update({
      where: { id },
      data: {
        name: input.name,
        phone: input.phone || null,
        email: input.email || null,
        address: input.address || null,
      },
    });
  },

  toggleActive: async (id: string) => {
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Supplier not found');
    return prisma.supplier.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });
  },

  // ─── Smart delete ─────────────────────────────────────────────────────────
  // Client-facing "Delete" always succeeds; behaviour is decided here:
  //   • Supplier with ANY purchase history → soft delete (isActive:false) so
  //     the record (and its purchases) stays intact.
  //   • Supplier with NO history → permanently removed from the DB.
  // A product may reference this supplier as its default supplier
  // (Product.defaultSupplierId, nullable) without any purchase existing, so we
  // clear that link first before the delete to avoid a FK constraint.
  // SupplierPayment and PurchaseReturn both require a purchaseId, so none can
  // exist when purchaseCount === 0 — nothing else needs clearing.
  smartDelete: async (id: string): Promise<void> => {
    const existing = await prisma.supplier.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new HttpError(404, 'Supplier not found');

    const purchaseCount = await prisma.purchase.count({ where: { supplierId: id } });

    if (purchaseCount > 0) {
      // History exists — keep the record, just mark it inactive.
      await prisma.supplier.update({ where: { id }, data: { isActive: false } });
      return;
    }

    // No history — safe to remove permanently. Clear default-supplier links first.
    await prisma.$transaction([
      prisma.product.updateMany({ where: { defaultSupplierId: id }, data: { defaultSupplierId: null } }),
      prisma.supplier.delete({ where: { id } }),
    ]);
  },
};
