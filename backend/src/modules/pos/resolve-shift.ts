import { prisma } from '../../config/prisma.js';

/**
 * The open till this user is working, if any.
 *
 * Cash movements that are not sales — refunds, credit settlements — have to
 * record which drawer they passed through, or a shift cannot be reconciled.
 * Returns null for back-office work with no shift open, which is a normal
 * outcome and not an error: those rows simply do not belong to a till.
 *
 * Newest first, deterministically: a user may hold an open shift in more than
 * one warehouse, so an unordered lookup could name either one.
 */
export async function resolveOpenShiftId(
  userId: string,
  warehouseId?: string,
): Promise<string | null> {
  const shift = await prisma.posShift.findFirst({
    where:   { userId, status: 'OPEN', ...(warehouseId ? { warehouseId } : {}) },
    orderBy: { openedAt: 'desc' },
    select:  { id: true },
  });
  return shift?.id ?? null;
}
