import { randomUUID } from 'node:crypto';
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

export interface LumpSumCustomerPaymentInput {
  customerId:    string;
  amountCents:   number;
  paymentMethod: string;
  referenceNo?:  string;
  bankName?:     string;
  paymentDate:   string | Date;
  notes?:        string;
  createdBy:     string;
}

export interface LumpSumAllocation {
  saleId:        string;
  saleNumber:    string;
  paymentNumber: string;
  appliedCents:  number;
}

export interface LumpSumCustomerPaymentResult {
  allocationGroupId: string;
  allocations:       LumpSumAllocation[];
  appliedCents:      number;   // total applied across bills
  creditAddedCents:  number;   // leftover parked as unallocated credit
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
                status: true },
    });
    if (!sale)           throw new HttpError(404, 'Sale not found');
    if (sale.status !== 'CONFIRMED') throw new HttpError(400, 'Sale must be CONFIRMED to record payment');

    // Net the invoice total against any returns before computing what is owed
    // SaleReturn has no soft-delete. If voiding is added: add isActive:true filter here.
    const returnsAgg = await (prisma as any).saleReturn.aggregate({
      where: { saleId },
      _sum: { totalCents: true },
    });
    const returnedCents  = returnsAgg._sum.totalCents ?? 0;
    const effectiveTotal = Math.max(0, (sale.totalCents as number) - returnedCents);

    const outstanding = effectiveTotal - (sale.paidCents as number);
    if (amountCents > outstanding) {
      throw new HttpError(
        400,
        `Payment of ${(amountCents / 100).toFixed(2)} exceeds outstanding balance of ${(outstanding / 100).toFixed(2)}`,
      );
    }

    const newPaid  = (sale.paidCents as number) + amountCents;
    const newStatus = computePaymentStatus(effectiveTotal, newPaid);
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

  // ── Lump-sum payment ─────────────────────────────────────────────────────────
  // One payment auto-allocated across the customer's outstanding CONFIRMED bills,
  // OLDEST-FIRST. Each covered bill gets its own CustomerPayment row (preserving
  // the non-null saleId FK), all sharing one allocationGroupId. Any leftover that
  // exceeds every bill is parked as unallocated credit (never refunded, never
  // rejected) with a signed CustomerCreditLedger entry. Fully atomic.
  async recordLumpSumPayment(
    input: LumpSumCustomerPaymentInput,
  ): Promise<LumpSumCustomerPaymentResult> {
    const { customerId, amountCents, paymentMethod, referenceNo, bankName,
            paymentDate, notes, createdBy } = input;

    if (amountCents <= 0) throw new HttpError(400, 'Amount must be positive');

    const customer = await (prisma as any).customer.findUnique({
      where:  { id: customerId },
      select: { id: true },
    });
    if (!customer) throw new HttpError(404, 'Customer not found');

    // Reserve a contiguous block of CPAY numbers up-front (single-user offline
    // ERP; mirrors the existing nextPaymentNumber race characteristics).
    const year   = new Date().getFullYear();
    const prefix = `CPAY-${year}-`;
    const last   = await (prisma as any).customerPayment.findFirst({
      where:   { paymentNumber: { startsWith: prefix } },
      orderBy: { paymentNumber: 'desc' },
      select:  { paymentNumber: true },
    });
    let seq = last ? parseInt(last.paymentNumber.slice(prefix.length), 10) : 0;

    const allocationGroupId = randomUUID();
    const paidDate          = new Date(paymentDate);

    return prisma.$transaction(async (tx) => {
      // Oldest-first: by invoice date, then sequential number as tie-break.
      const sales = await (tx as any).sale.findMany({
        where: {
          customerId,
          status:        'CONFIRMED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
        orderBy: [{ date: 'asc' }, { number: 'asc' }],
        select:  { id: true, number: true, totalCents: true, paidCents: true, customerId: true },
      });

      let remaining = amountCents;
      const allocations: LumpSumAllocation[] = [];

      for (const sale of sales) {
        if (remaining <= 0) break;

        // Returns-aware outstanding — matches single-bill createPayment.
        const returnsAgg = await (tx as any).saleReturn.aggregate({
          where: { saleId: sale.id },
          _sum:  { totalCents: true },
        });
        const returnedCents  = returnsAgg._sum.totalCents ?? 0;
        const effectiveTotal = Math.max(0, (sale.totalCents as number) - returnedCents);
        const outstanding    = effectiveTotal - (sale.paidCents as number);
        if (outstanding <= 0) continue;

        const applied   = Math.min(remaining, outstanding);
        const newPaid   = (sale.paidCents as number) + applied;
        const newStatus = computePaymentStatus(effectiveTotal, newPaid);
        seq += 1;
        const paymentNumber = `${prefix}${String(seq).padStart(4, '0')}`;

        await (tx as any).customerPayment.create({
          data: {
            paymentNumber,
            saleId:       sale.id,
            customerId:   sale.customerId ?? customerId,
            amountCents:  applied,
            paymentMethod,
            referenceNo:  referenceNo ?? null,
            bankName:     bankName    ?? null,
            paymentDate:  paidDate,
            notes:        notes       ?? null,
            createdBy,
            allocationGroupId,
          },
        });
        await (tx as any).sale.update({
          where: { id: sale.id },
          data:  { paidCents: newPaid, paymentStatus: newStatus },
        });

        allocations.push({ saleId: sale.id, saleNumber: sale.number, paymentNumber, appliedCents: applied });
        remaining -= applied;
      }

      // Park any leftover as unallocated credit.
      let creditAddedCents = 0;
      if (remaining > 0) {
        creditAddedCents = remaining;
        await (tx as any).customer.update({
          where: { id: customerId },
          data:  { creditBalanceCents: { increment: remaining } },
        });
        await (tx as any).customerCreditLedger.create({
          data: {
            customerId,
            amountCents:       remaining,           // positive = credit added
            reason:            'LUMP_SUM_OVERFLOW',
            allocationGroupId,
            notes:             notes ?? null,
            createdBy,
          },
        });
      }

      return {
        allocationGroupId,
        allocations,
        appliedCents:     amountCents - remaining,
        creditAddedCents,
      };
    });
  },

  // ── Credit ledger (read) ──────────────────────────────────────────────────────
  async listCreditLedger(customerId: string) {
    return (prisma as any).customerCreditLedger.findMany({
      where:   { customerId },
      orderBy: { createdAt: 'desc' },
      include: { createdByUser: { select: { id: true, fullName: true } } },
    });
  },

  async listBySale(saleId: string) {
    return (prisma as any).customerPayment.findMany({
      where:   { saleId, isActive: true },
      orderBy: { paymentDate: 'asc' },
      include: { createdByUser: { select: { id: true, fullName: true } } },
    });
  },

  async listByCustomer(customerId: string) {
    return (prisma as any).customerPayment.findMany({
      where:   { customerId, isActive: true },
      orderBy: { paymentDate: 'desc' },
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
