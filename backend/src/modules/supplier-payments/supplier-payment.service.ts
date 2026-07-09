import { randomUUID } from 'node:crypto';
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

export interface LumpSumSupplierPaymentInput {
  supplierId:    string;
  amountCents:   number;
  paymentMethod: PaymentMethod;
  referenceNo?:  string;
  bankName?:     string;
  paymentDate:   string;   // ISO date string
  notes?:        string;
  recordedById:  string;
}

export interface LumpSumSupplierAllocation {
  purchaseId:     string;
  purchaseNumber: string;
  paymentNumber:  string;
  appliedCents:   number;
}

export interface LumpSumSupplierPaymentResult {
  allocationGroupId: string;
  allocations:       LumpSumSupplierAllocation[];
  appliedCents:      number;
  creditAddedCents:  number;
}

export interface ApplyCreditSupplierInput {
  supplierId:   string;
  amountCents:  number;        // requested amount to draw from credit balance
  paymentDate:  string;        // ISO date string
  notes?:       string;
  recordedById: string;
}

export interface ApplyCreditSupplierResult {
  allocationGroupId:    string;
  allocations:          LumpSumSupplierAllocation[];
  appliedCents:         number;   // total credit actually consumed across POs
  creditRemainingCents: number;   // supplier's credit balance after this apply
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

  // ── Lump-sum payment ─────────────────────────────────────────────────────────
  // Mirror of the customer allocator. One payment auto-allocated across the
  // supplier's outstanding CONFIRMED purchase orders, OLDEST-FIRST. Each covered
  // PO gets its own SupplierPayment row (paymentType 'PAYMENT'), all sharing one
  // allocationGroupId. Leftover beyond all POs is parked as unallocated supplier
  // credit via a signed SupplierCreditLedger entry. Fully atomic.
  async recordLumpSumPayment(
    input: LumpSumSupplierPaymentInput,
  ): Promise<LumpSumSupplierPaymentResult> {
    const { supplierId, amountCents, paymentMethod, referenceNo, bankName,
            paymentDate, notes, recordedById } = input;

    if (amountCents <= 0) throw new HttpError(400, 'Payment amount must be greater than 0');

    const supplier = await (prisma as any).supplier.findUnique({
      where:  { id: supplierId },
      select: { id: true },
    });
    if (!supplier) throw new HttpError(404, 'Supplier not found');

    // Reserve a contiguous block of SPAY numbers up-front.
    const year   = new Date().getFullYear();
    const prefix = `SPAY-${year}-`;
    const count  = await prisma.supplierPayment.count({
      where: { paymentNumber: { startsWith: prefix } },
    });
    let seq = count;

    const allocationGroupId = randomUUID();
    const paidDate          = new Date(paymentDate);

    return prisma.$transaction(async (tx) => {
      const purchases = await (tx as any).purchase.findMany({
        where: {
          supplierId,
          deletedAt:     null,
          status:        'CONFIRMED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
        orderBy: [{ date: 'asc' }, { number: 'asc' }],
        select:  { id: true, number: true, totalCents: true, paidCents: true },
      });

      let remaining = amountCents;
      const allocations: LumpSumSupplierAllocation[] = [];

      for (const po of purchases) {
        if (remaining <= 0) break;

        const returnsAgg = await (tx as any).purchaseReturn.aggregate({
          where: { purchaseId: po.id, status: 'CONFIRMED', isActive: true },
          _sum:  { totalCents: true },
        });
        const returnedCents       = returnsAgg._sum.totalCents ?? 0;
        const effectiveTotalCents = Math.max(0, (po.totalCents as number) - returnedCents);
        const outstanding         = Math.max(0, effectiveTotalCents - (po.paidCents as number));
        if (outstanding <= 0) continue;

        const applied       = Math.min(remaining, outstanding);
        const newPaidCents  = (po.paidCents as number) + applied;
        const paymentStatus = derivePaymentStatus(newPaidCents, effectiveTotalCents);
        seq += 1;
        const paymentNumber = `${prefix}${String(seq).padStart(4, '0')}`;

        await (tx as any).supplierPayment.create({
          data: {
            paymentNumber,
            purchaseId:    po.id,
            supplierId,
            amountCents:   applied,
            paymentMethod,
            referenceNo:   referenceNo ?? null,
            bankName:      bankName    ?? null,
            paymentDate:   paidDate,
            notes:         notes       ?? null,
            createdById:   recordedById,
            allocationGroupId,
          },
        });
        await (tx as any).purchase.update({
          where: { id: po.id },
          data:  { paidCents: newPaidCents, paymentStatus },
        });

        allocations.push({ purchaseId: po.id, purchaseNumber: po.number, paymentNumber, appliedCents: applied });
        remaining -= applied;
      }

      let creditAddedCents = 0;
      if (remaining > 0) {
        creditAddedCents = remaining;
        await (tx as any).supplier.update({
          where: { id: supplierId },
          data:  { creditBalanceCents: { increment: remaining } },
        });
        await (tx as any).supplierCreditLedger.create({
          data: {
            supplierId,
            amountCents:       remaining,
            reason:            'LUMP_SUM_OVERFLOW',
            allocationGroupId,
            notes:             notes ?? null,
            createdBy:         recordedById,
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

  // ── Apply existing credit to outstanding purchase orders ──────────────────────
  // Mirror of the customer applyCreditToBills. Spends the supplier's unallocated
  // credit balance against outstanding CONFIRMED POs, OLDEST-FIRST. The funding
  // pool is the credit balance itself — no fresh cash out — so each covered PO
  // gets a SupplierPayment row tagged paymentType 'CREDIT_APPLIED', and
  // Purchase.paidCents is bumped exactly like a normal payment so payable math
  // stays consistent. One signed-negative SupplierCreditLedger row records the
  // consumption; creditBalanceCents is decremented by the same amount. Never
  // parks overflow, never overdraws (balance re-read inside the tx). Fully atomic.
  async applyCreditToPurchases(
    input: ApplyCreditSupplierInput,
  ): Promise<ApplyCreditSupplierResult> {
    const { supplierId, amountCents, paymentDate, notes, recordedById } = input;

    if (amountCents <= 0) throw new HttpError(400, 'Amount must be greater than 0');

    const supplier = await (prisma as any).supplier.findUnique({
      where:  { id: supplierId },
      select: { id: true, creditBalanceCents: true },
    });
    if (!supplier) throw new HttpError(404, 'Supplier not found');
    if ((supplier.creditBalanceCents as number) <= 0) {
      throw new HttpError(400, 'Supplier has no available credit balance');
    }

    // Reserve a contiguous block of SPAY numbers up-front.
    const year   = new Date().getFullYear();
    const prefix = `SPAY-${year}-`;
    const count  = await prisma.supplierPayment.count({
      where: { paymentNumber: { startsWith: prefix } },
    });
    let seq = count;

    const allocationGroupId = randomUUID();
    const paidDate          = new Date(paymentDate);

    return prisma.$transaction(async (tx) => {
      // Re-read the balance INSIDE the tx to prevent concurrent overdraw.
      const fresh = await (tx as any).supplier.findUnique({
        where:  { id: supplierId },
        select: { creditBalanceCents: true },
      });
      const available = fresh?.creditBalanceCents ?? 0;
      if (available <= 0) throw new HttpError(400, 'Supplier has no available credit balance');

      let remaining = Math.min(amountCents, available);

      const purchases = await (tx as any).purchase.findMany({
        where: {
          supplierId,
          deletedAt:     null,
          status:        'CONFIRMED',
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
        orderBy: [{ date: 'asc' }, { number: 'asc' }],
        select:  { id: true, number: true, totalCents: true, paidCents: true },
      });

      const allocations: LumpSumSupplierAllocation[] = [];

      for (const po of purchases) {
        if (remaining <= 0) break;

        const returnsAgg = await (tx as any).purchaseReturn.aggregate({
          where: { purchaseId: po.id, status: 'CONFIRMED', isActive: true },
          _sum:  { totalCents: true },
        });
        const returnedCents       = returnsAgg._sum.totalCents ?? 0;
        const effectiveTotalCents = Math.max(0, (po.totalCents as number) - returnedCents);
        const outstanding         = Math.max(0, effectiveTotalCents - (po.paidCents as number));
        if (outstanding <= 0) continue;

        const applied       = Math.min(remaining, outstanding);
        const newPaidCents  = (po.paidCents as number) + applied;
        const paymentStatus = derivePaymentStatus(newPaidCents, effectiveTotalCents);
        seq += 1;
        const paymentNumber = `${prefix}${String(seq).padStart(4, '0')}`;

        await (tx as any).supplierPayment.create({
          data: {
            paymentNumber,
            purchaseId:    po.id,
            supplierId,
            amountCents:   applied,
            paymentMethod: 'CREDIT',        // cosmetic; paymentType is the real signal
            paymentType:   'CREDIT_APPLIED',
            paymentDate:   paidDate,
            notes:         notes ?? null,
            createdById:   recordedById,
            allocationGroupId,
          },
        });
        await (tx as any).purchase.update({
          where: { id: po.id },
          data:  { paidCents: newPaidCents, paymentStatus },
        });

        allocations.push({ purchaseId: po.id, purchaseNumber: po.number, paymentNumber, appliedCents: applied });
        remaining -= applied;
      }

      const consumed = allocations.reduce((s, a) => s + a.appliedCents, 0);
      if (consumed <= 0) {
        throw new HttpError(400, 'No outstanding purchase orders to apply credit against');
      }
      if (consumed > available) throw new HttpError(400, 'Credit application exceeds available balance');

      await (tx as any).supplier.update({
        where: { id: supplierId },
        data:  { creditBalanceCents: { decrement: consumed } },
      });
      await (tx as any).supplierCreditLedger.create({
        data: {
          supplierId,
          amountCents:       -consumed,          // negative = credit consumed
          reason:            'APPLIED_TO_PURCHASE',
          allocationGroupId,
          refType:           'SupplierPayment',
          refId:             allocations[0]?.purchaseId ?? null,
          notes:             notes ?? null,
          createdBy:         recordedById,
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
  async listCreditLedger(supplierId: string) {
    return (prisma as any).supplierCreditLedger.findMany({
      where:   { supplierId },
      orderBy: { createdAt: 'desc' },
      include: { createdByUser: { select: { id: true, fullName: true } } },
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
