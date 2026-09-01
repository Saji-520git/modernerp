import { randomUUID } from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import { resolveOpenShiftId } from '../pos/resolve-shift.js';

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
  /** Hold any excess over the outstanding balance as credit on the customer's account. */
  keepChangeOnAccount?: boolean;
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

export interface ApplyCreditCustomerInput {
  customerId:  string;
  amountCents: number;         // requested amount to draw from credit balance
  paymentDate: string | Date;
  notes?:      string;
  createdBy:   string;
}

export interface ApplyCreditCustomerResult {
  allocationGroupId:   string;
  allocations:         LumpSumAllocation[];
  appliedCents:        number;   // total credit actually consumed across bills
  creditRemainingCents: number;  // customer's credit balance after this apply
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
            paymentDate, notes, createdBy, keepChangeOnAccount = false } = input;

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

    // Paying more than the bill is an ordinary counter event — "keep the change
    // on my account". It used to be refused outright, so the cashier hit a wall
    // on the obvious button and the only way through was the Lump-Sum screen,
    // whose name does not suggest it is the one that can do this.
    //
    // Still opt-in: a mistyped amount must not silently become a liability. The
    // caller says explicitly that the excess is meant to be kept, and the error
    // now names that option instead of being a dead end.
    const overpaidCents = Math.max(0, amountCents - Math.max(0, outstanding));
    if (overpaidCents > 0 && !keepChangeOnAccount) {
      throw new HttpError(
        400,
        `Payment of ${(amountCents / 100).toFixed(2)} exceeds outstanding balance of ${(outstanding / 100).toFixed(2)}. `
        + `Re-send with keepChangeOnAccount to hold the extra ${(overpaidCents / 100).toFixed(2)} as credit on the customer's account.`,
      );
    }
    if (overpaidCents > 0 && !sale.customerId) {
      throw new HttpError(400, 'A walk-in sale has no account to hold the excess on');
    }

    // Only what the bill can absorb is recorded against it; the rest is parked.
    const appliedCents = amountCents - overpaidCents;
    const newPaid  = (sale.paidCents as number) + appliedCents;
    const newStatus = computePaymentStatus(effectiveTotal, newPaid);
    const number    = await nextPaymentNumber();

    // Till this payment was taken at, if the user has one open. Settling a
    // credit bill in cash fills the drawer, so the shift close must add it —
    // previously that cash appeared from nowhere and read as a surplus.
    // Null for back-office settlements, which belong to no till.
    const shiftId = await resolveOpenShiftId(createdBy);

    const [payment] = await prisma.$transaction([
      (prisma as any).customerPayment.create({
        data: {
          paymentNumber: number,
          saleId,
          customerId:   sale.customerId ?? undefined,
          // The row records what settled THIS bill. The parked remainder is a
          // credit-ledger entry, not part of the invoice's payment history.
          amountCents:  appliedCents,
          paymentMethod,
          referenceNo:  referenceNo ?? null,
          bankName:     bankName    ?? null,
          paymentDate:  new Date(paymentDate),
          notes:        notes       ?? null,
          createdBy,
          shiftId,
        },
        include: { createdByUser: { select: { id: true, fullName: true } } },
      }),
      (prisma as any).sale.update({
        where: { id: saleId },
        data:  { paidCents: newPaid, paymentStatus: newStatus },
      }),
      // Park the excess. Same two writes the lump-sum path makes, so the
      // balance and the ledger stay the single story of the account.
      ...(overpaidCents > 0 ? [
        (prisma as any).customer.update({
          where: { id: sale.customerId },
          data:  { creditBalanceCents: { increment: overpaidCents } },
        }),
        (prisma as any).customerCreditLedger.create({
          data: {
            customerId:  sale.customerId,
            amountCents: overpaidCents,      // positive = credit added
            reason:      'OVERPAYMENT',
            refType:     'Sale',
            refId:       saleId,
            notes:       notes ?? null,
            createdBy,
          },
        }),
      ] : []),
    ]);

    return { ...payment, creditAddedCents: overpaidCents };
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

    // Till this settlement was taken at. Resolved before the transaction so the
    // lookup does not hold it open. Recorded whenever a shift is open; the
    // shift close counts only CASH and ignores CREDIT_APPLIED, which is store
    // credit being consumed rather than money crossing the counter.
    const shiftId = await resolveOpenShiftId(createdBy);

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
            shiftId,
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

  // ── Apply existing credit to outstanding bills ────────────────────────────────
  // Spends the customer's unallocated credit balance against outstanding CONFIRMED
  // bills, OLDEST-FIRST (mirrors recordLumpSumPayment). The funding pool is the
  // credit balance itself — no fresh cash — so each covered bill gets a
  // CustomerPayment row tagged paymentType 'CREDIT_APPLIED' (distinguishes it from
  // tendered cash in reports), and Sale.paidCents is bumped exactly like a normal
  // payment so outstanding-balance math stays consistent. One signed-negative
  // CustomerCreditLedger row records the consumption; creditBalanceCents is
  // decremented by the same amount. Never parks overflow (leftover stays credit),
  // never overdraws (balance re-read inside the tx). Fully atomic.
  async applyCreditToBills(
    input: ApplyCreditCustomerInput,
  ): Promise<ApplyCreditCustomerResult> {
    const { customerId, amountCents, paymentDate, notes, createdBy } = input;

    if (amountCents <= 0) throw new HttpError(400, 'Amount must be positive');

    const customer = await (prisma as any).customer.findUnique({
      where:  { id: customerId },
      select: { id: true, creditBalanceCents: true },
    });
    if (!customer) throw new HttpError(404, 'Customer not found');
    if ((customer.creditBalanceCents as number) <= 0) {
      throw new HttpError(400, 'Customer has no available credit balance');
    }

    // Reserve a contiguous block of CPAY numbers up-front (mirrors lump-sum).
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

    // Till this settlement was taken at. Resolved before the transaction so the
    // lookup does not hold it open. Recorded whenever a shift is open; the
    // shift close counts only CASH and ignores CREDIT_APPLIED, which is store
    // credit being consumed rather than money crossing the counter.
    const shiftId = await resolveOpenShiftId(createdBy);

    return prisma.$transaction(async (tx) => {
      // Re-read the balance INSIDE the tx to prevent concurrent overdraw.
      const fresh = await (tx as any).customer.findUnique({
        where:  { id: customerId },
        select: { creditBalanceCents: true },
      });
      const available = fresh?.creditBalanceCents ?? 0;
      if (available <= 0) throw new HttpError(400, 'Customer has no available credit balance');

      // Funding pool = min(requested, available credit). Capped again by real
      // outstanding as we walk bills — leftover simply stays as credit.
      let remaining = Math.min(amountCents, available);

      const sales = await (tx as any).sale.findMany({
        where: {
          customerId,
          status:        'CONFIRMED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
        orderBy: [{ date: 'asc' }, { number: 'asc' }],
        select:  { id: true, number: true, totalCents: true, paidCents: true, customerId: true },
      });

      const allocations: LumpSumAllocation[] = [];

      for (const sale of sales) {
        if (remaining <= 0) break;

        // Returns-aware outstanding — identical to createPayment / lump-sum.
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
            paymentMethod: 'CREDIT',       // cosmetic; paymentType is the real signal
            paymentType:  'CREDIT_APPLIED',
            paymentDate:  paidDate,
            notes:        notes ?? null,
            createdBy,
            shiftId,
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

      const consumed = allocations.reduce((s, a) => s + a.appliedCents, 0);
      if (consumed <= 0) {
        throw new HttpError(400, 'No outstanding bills to apply credit against');
      }
      // Defensive: never overdraw (consumed is bounded by `available` above).
      if (consumed > available) throw new HttpError(400, 'Credit application exceeds available balance');

      await (tx as any).customer.update({
        where: { id: customerId },
        data:  { creditBalanceCents: { decrement: consumed } },
      });
      await (tx as any).customerCreditLedger.create({
        data: {
          customerId,
          amountCents:       -consumed,            // negative = credit consumed
          reason:            'APPLIED_TO_SALE',
          allocationGroupId,
          refType:           'CustomerPayment',
          refId:             allocations[0]?.saleId ?? null,
          notes:             notes ?? null,
          createdBy,
        },
      });

      return {
        allocationGroupId,
        allocations,
        appliedCents:         consumed,
        creditRemainingCents: available - consumed,
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
