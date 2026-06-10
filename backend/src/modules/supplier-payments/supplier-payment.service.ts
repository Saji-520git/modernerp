import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import type { PaymentMethod, PurchasePaymentStatus } from '@prisma/client';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateSPAYNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `SPAY-${year}-`;
  const count = await prisma.supplierPayment.count({
    where: { paymentNumber: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

// Option B — derive against the EFFECTIVE total owed (totalCents minus confirmed
// return credit), never the raw totalCents. This keeps paymentStatus correct when
// returns reduce what is owed (e.g. paid 22,500 against an effective 18,750 → PAID).
function derivePaymentStatus(
  paidCents: number,
  effectiveTotalCents: number,
): PurchasePaymentStatus {
  if (effectiveTotalCents <= 0) return 'PAID';   // nothing owed (all returned)
  if (paidCents <= 0) return 'UNPAID';
  if (paidCents >= effectiveTotalCents) return 'PAID';
  return 'PARTIAL';
}

// Sum of confirmed, active return credit for a purchase.
async function getReturnedCents(purchaseId: string): Promise<number> {
  const agg = await (prisma as any).purchaseReturn.aggregate({
    where: { purchaseId, status: 'CONFIRMED', isActive: true },
    _sum:  { totalCents: true },
  });
  return agg._sum.totalCents ?? 0;
}

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateSupplierPaymentInput {
  purchaseId:    string;
  amountCents:   number;
  paymentMethod: PaymentMethod;
  referenceNo?:  string;
  bankName?:     string;
  paymentDate:   string;   // ISO date string
  notes?:        string;
}

export interface ReceiveCreditInput {
  purchaseId:   string;
  supplierId:   string;
  amountCents:  number;
  method:       PaymentMethod;
  reference?:   string;
  date:         string;    // ISO date string
  notes?:       string;
  recordedById: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const supplierPaymentService = {

  // ── Create payment ──────────────────────────────────────────────────────────

  async createPayment(data: CreateSupplierPaymentInput, userId: string) {
    if (data.amountCents <= 0) {
      throw new HttpError(400, 'Payment amount must be greater than 0');
    }

    const purchase = await (prisma as any).purchase.findFirst({
      where: { id: data.purchaseId, deletedAt: null },
      select: {
        id: true, status: true, totalCents: true,
        paidCents: true, supplierId: true, number: true,
      },
    });
    if (!purchase) throw new HttpError(404, 'Purchase order not found');
    if (purchase.status !== 'CONFIRMED') {
      throw new HttpError(400, 'Payments can only be recorded on CONFIRMED purchase orders');
    }

    // Option B — totalCents is never mutated; subtract confirmed return credit to
    // get the true amount still owed before validating an overpayment.
    const returnsAgg = await (prisma as any).purchaseReturn.aggregate({
      where: { purchaseId: data.purchaseId, status: 'CONFIRMED', isActive: true },
      _sum: { totalCents: true },
    });
    const returnedCents = returnsAgg._sum.totalCents ?? 0;

    const effectiveOutstanding = Math.max(
      0,
      purchase.totalCents - purchase.paidCents - returnedCents,
    );
    if (data.amountCents > effectiveOutstanding) {
      throw new HttpError(
        400,
        `Payment of Rs.${(data.amountCents / 100).toFixed(2)} exceeds outstanding balance of Rs.${(effectiveOutstanding / 100).toFixed(2)}`,
      );
    }

    const paymentNumber = await generateSPAYNumber();
    const newPaidCents  = purchase.paidCents + data.amountCents;
    // Derive against effective total (totalCents minus confirmed return credit),
    // reusing returnedCents computed above for the overpayment guard.
    const effectiveTotalCents = Math.max(0, purchase.totalCents - returnedCents);
    const paymentStatus = derivePaymentStatus(newPaidCents, effectiveTotalCents);

    return prisma.$transaction(async (tx) => {
      const payment = await tx.supplierPayment.create({
        data: {
          paymentNumber,
          purchaseId:    data.purchaseId,
          supplierId:    purchase.supplierId,
          amountCents:   data.amountCents,
          paymentMethod: data.paymentMethod,
          referenceNo:   data.referenceNo ?? null,
          bankName:      data.bankName    ?? null,
          paymentDate:   new Date(data.paymentDate),
          notes:         data.notes       ?? null,
          createdById:   userId,
        },
        include: {
          supplier:     { select: { id: true, name: true } },
          createdByUser: { select: { id: true, fullName: true } },
        },
      });

      await (tx as any).purchase.update({
        where: { id: data.purchaseId },
        data: {
          paidCents:     newPaidCents,
          paymentStatus,
        },
      });

      return payment;
    });
  },

  // ── List payments for a purchase ────────────────────────────────────────────

  async listByPurchase(purchaseId: string) {
    const purchase = await (prisma as any).purchase.findFirst({
      where: { id: purchaseId, deletedAt: null },
      select: { id: true },
    });
    if (!purchase) throw new HttpError(404, 'Purchase order not found');

    return prisma.supplierPayment.findMany({
      where:   { purchaseId, isActive: true },
      orderBy: { createdAt: 'asc' },
      include: {
        supplier:      { select: { id: true, name: true } },
        createdByUser: { select: { id: true, fullName: true } },
      },
    });
  },

  // ── List payments for a supplier ───────────────────────────────────────────

  async listBySupplier(supplierId: string) {
    return prisma.supplierPayment.findMany({
      where:   { supplierId, isActive: true },
      orderBy: { paymentDate: 'desc' },
      include: {
        purchase:      { select: { id: true, number: true } },
        createdByUser: { select: { id: true, fullName: true } },
      },
    });
  },

  // ── Get full voucher data ────────────────────────────────────────────────────

  async getVoucherData(paymentId: string) {
    const payment = await prisma.supplierPayment.findUnique({
      where: { id: paymentId },
      include: {
        supplier:      true,
        purchase:      { select: { id: true, number: true, totalCents: true } },
        createdByUser: { select: { id: true, fullName: true } },
      },
    });
    if (!payment) throw new HttpError(404, 'Supplier payment not found');
    if (!payment.isActive) throw new HttpError(404, 'This payment has been voided');
    return payment;
  },

  // ── Void payment ────────────────────────────────────────────────────────────

  async voidPayment(paymentId: string, userId: string) {
    const payment = await prisma.supplierPayment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new HttpError(404, 'Supplier payment not found');
    if (!payment.isActive) throw new HttpError(409, 'Payment is already voided');

    return prisma.$transaction(async (tx) => {
      await tx.supplierPayment.update({
        where: { id: paymentId },
        data:  { isActive: false },
      });

      const purchase = await (tx as any).purchase.findUnique({
        where:  { id: payment.purchaseId },
        select: { paidCents: true, totalCents: true },
      });

      const newPaidCents  = Math.max(0, purchase.paidCents - payment.amountCents);
      // Re-derive against effective total (subtract confirmed return credit).
      const returnedCents       = await getReturnedCents(payment.purchaseId);
      const effectiveTotalCents = Math.max(0, purchase.totalCents - returnedCents);
      const paymentStatus       = derivePaymentStatus(newPaidCents, effectiveTotalCents);

      await (tx as any).purchase.update({
        where: { id: payment.purchaseId },
        data:  { paidCents: newPaidCents, paymentStatus },
      });

      return { success: true, voidedBy: userId };
    });
  },

  // ── Receive credit from supplier ─────────────────────────────────────────────
  // When confirmed returns reduce what is owed below what was already paid, the
  // supplier owes US money. "Receive Credit" records that cash coming back: it
  // stores a CREDIT_RECEIVED payment row and DECREASES Purchase.paidCents by the
  // received amount, which clears the credit and keeps paymentStatus correct.
  async receiveCreditFromSupplier(data: ReceiveCreditInput) {
    // 1. Load purchase with confirmed returns
    const purchase = await (prisma as any).purchase.findFirst({
      where: { id: data.purchaseId, deletedAt: null },
      select: {
        id: true, status: true, totalCents: true,
        paidCents: true, supplierId: true, number: true,
      },
    });
    if (!purchase) throw new HttpError(404, 'Purchase order not found');

    const returnsAgg = await (prisma as any).purchaseReturn.aggregate({
      where: { purchaseId: data.purchaseId, status: 'CONFIRMED', isActive: true },
      _sum: { totalCents: true },
    });
    const returnedCents = returnsAgg._sum.totalCents ?? 0;

    // 2. Calculate credit owed to us
    const effectiveTotalCents = Math.max(0, purchase.totalCents - returnedCents);
    const creditOwed          = Math.max(0, purchase.paidCents - effectiveTotalCents);

    // 3. Validate amount
    if (data.amountCents <= 0) {
      throw new HttpError(400, 'Amount must be greater than 0');
    }
    if (data.amountCents > creditOwed) {
      throw new HttpError(
        400,
        `Credit received cannot exceed available credit of Rs.${(creditOwed / 100).toFixed(2)}`,
      );
    }

    const paymentNumber = await generateSPAYNumber();
    const newPaidCents  = purchase.paidCents - data.amountCents;
    const paymentStatus = derivePaymentStatus(newPaidCents, effectiveTotalCents);

    // 4. Persist atomically
    return prisma.$transaction(async (tx) => {
      const payment = await (tx as any).supplierPayment.create({
        data: {
          paymentNumber,
          purchaseId:    data.purchaseId,
          supplierId:    data.supplierId,
          amountCents:   data.amountCents,
          paymentMethod: data.method,
          paymentType:   'CREDIT_RECEIVED',
          referenceNo:   data.reference ?? null,
          paymentDate:   new Date(data.date),
          notes:         data.notes ?? null,
          createdById:   data.recordedById,
        },
        include: {
          supplier:      { select: { id: true, name: true } },
          createdByUser: { select: { id: true, fullName: true } },
        },
      });

      await (tx as any).purchase.update({
        where: { id: data.purchaseId },
        data:  { paidCents: newPaidCents, paymentStatus },
      });

      // 5. Return the created record
      return payment;
    });
  },
};
