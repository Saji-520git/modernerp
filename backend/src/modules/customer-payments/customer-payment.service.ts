import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateCustomerPaymentInput {
  saleId:        string;
  amountCents:   number;
  paymentMethod: string;
  referenceNo?:  string;
  bankName?:     string;
  paymentDate:   string | Date;
  notes?:        string;
  createdBy:     string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function nextPaymentNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `CPAY-${year}-`;
  const last = await (prisma as any).customerPayment.findFirst({
    where:   { paymentNumber: { startsWith: prefix } },
    orderBy: { paymentNumber: 'desc' },
    select:  { paymentNumber: true },
  });
  const seq = last
    ? parseInt(last.paymentNumber.slice(prefix.length), 10) + 1
    : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

function computePaymentStatus(totalCents: number, paidCents: number): string {
  if (paidCents <= 0)               return 'UNPAID';
  if (paidCents >= totalCents)      return 'PAID';
  return 'PARTIAL';
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const customerPaymentService = {

  async createPayment(input: CreateCustomerPaymentInput) {
    const { saleId, amountCents, paymentMethod, referenceNo, bankName,
            paymentDate, notes, createdBy } = input;

    if (amountCents <= 0) throw new HttpError(400, 'Amount must be positive');

    const sale = await (prisma as any).sale.findUnique({
      where:  { id: saleId },
      select: { id: true, customerId: true, totalCents: true, paidCents: true,
                status: true, isActive: true },
    });
    if (!sale)           throw new HttpError(404, 'Sale not found');
    if (sale.status !== 'CONFIRMED') throw new HttpError(400, 'Sale must be CONFIRMED to record payment');

    const outstanding = (sale.totalCents as number) - (sale.paidCents as number);
    if (amountCents > outstanding) {
      throw new HttpError(
        400,
        `Payment of ${(amountCents / 100).toFixed(2)} exceeds outstanding balance of ${(outstanding / 100).toFixed(2)}`,
      );
    }

    const newPaid  = (sale.paidCents as number) + amountCents;
    const newStatus = computePaymentStatus(sale.totalCents as number, newPaid);
    const number    = await nextPaymentNumber();

    const [payment] = await prisma.$transaction([
      (prisma as any).customerPayment.create({
        data: {
          paymentNumber: number,
          saleId,
          customerId:   sale.customerId ?? undefined,
          amountCents,
          paymentMethod,
          referenceNo:  referenceNo ?? null,
          bankName:     bankName    ?? null,
          paymentDate:  new Date(paymentDate),
          notes:        notes       ?? null,
          createdBy,
        },
        include: { createdByUser: { select: { id: true, fullName: true } } },
      }),
      (prisma as any).sale.update({
        where: { id: saleId },
        data:  { paidCents: newPaid, paymentStatus: newStatus },
      }),
    ]);

    return payment;
  },

  async listBySale(saleId: string) {
    return (prisma as any).customerPayment.findMany({
      where:   { saleId, isActive: true },
      orderBy: { paymentDate: 'asc' },
      include: { createdByUser: { select: { id: true, fullName: true } } },
    });
  },

  async voidPayment(id: string) {
    const cp = await (prisma as any).customerPayment.findUnique({
      where:  { id },
      select: { id: true, saleId: true, amountCents: true, isActive: true },
    });
    if (!cp)          throw new HttpError(404, 'Payment not found');
    if (!cp.isActive) throw new HttpError(400, 'Payment already voided');

    const sale = await (prisma as any).sale.findUnique({
      where:  { id: cp.saleId },
      select: { totalCents: true, paidCents: true },
    });

    const newPaid   = Math.max(0, (sale.paidCents as number) - (cp.amountCents as number));
    const newStatus = computePaymentStatus(sale.totalCents as number, newPaid);

    const [voided] = await prisma.$transaction([
      (prisma as any).customerPayment.update({
        where: { id },
        data:  { isActive: false },
        include: { createdByUser: { select: { id: true, fullName: true } } },
      }),
      (prisma as any).sale.update({
        where: { id: cp.saleId },
        data:  { paidCents: newPaid, paymentStatus: newStatus },
      }),
    ]);

    return voided;
  },
};
