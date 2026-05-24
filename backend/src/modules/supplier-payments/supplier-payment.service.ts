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

function derivePaymentStatus(paidCents: number, totalCents: number): PurchasePaymentStatus {
  if (paidCents <= 0) return 'UNPAID';
  if (paidCents >= totalCents) return 'PAID';
  return 'PARTIAL';
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

    const outstanding = purchase.totalCents - purchase.paidCents;
    if (data.amountCents > outstanding) {
      throw new HttpError(
        400,
        `Payment of ${(data.amountCents / 100).toFixed(2)} exceeds outstanding balance of ${(outstanding / 100).toFixed(2)}`,
      );
    }

    const paymentNumber = await generateSPAYNumber();
    const newPaidCents  = purchase.paidCents + data.amountCents;
    const paymentStatus = derivePaymentStatus(newPaidCents, purchase.totalCents);

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
      const paymentStatus = derivePaymentStatus(newPaidCents, purchase.totalCents);

      await (tx as any).purchase.update({
        where: { id: payment.purchaseId },
        data:  { paidCents: newPaidCents, paymentStatus },
      });

      return { success: true, voidedBy: userId };
    });
  },
};
