// Makes this file a MODULE rather than a script — see the same note in
// lump-sum-payment.test.ts. Both files declare `threeBills` at top level, and
// without this they share one global scope and collide (TS2451).
export {};

/**
 * Apply-Credit Allocation Tests
 *
 * These tests verify the credit-spend allocation algorithm in isolation — no
 * live DB. The pure function below mirrors, byte-for-byte in logic, the loop
 * inside customer-payment.service.ts `applyCreditToBills` and its supplier twin
 * supplier-payment.service.ts `applyCreditToPurchases`:
 *   • funding pool is capped at min(requestedAmount, availableCredit)
 *   • oldest-first (callers pass bills already ordered by date, then number)
 *   • returns-aware outstanding = max(0, total - returned) - paid
 *   • applied = min(remaining, outstanding); skip bills with outstanding <= 0
 *   • NO overflow: unlike lump-sum cash, leftover funding is NOT parked as new
 *     credit — it simply stays in the account (creditRemaining = available - consumed)
 *   • money is conserved: consumed + creditRemaining === available (never > available)
 *
 * Keeping the algorithm in one pure function lets us prove the money math
 * without a Postgres connection, exactly like lump-sum-payment.test.ts.
 */

// ─── Pure credit allocator (mirrors the service loop) ───────────────────────────

interface Bill {
  id:         string;
  number:     string;
  totalCents: number;
  paidCents:  number;
  returned:   number;   // Σ confirmed returns for this bill
}

interface Allocation {
  billId:       string;
  billNumber:   string;
  appliedCents: number;
  newPaid:      number;
  newStatus:    'UNPAID' | 'PARTIAL' | 'PAID';
}

interface ApplyCreditResult {
  allocations:          Allocation[];
  appliedCents:         number;   // === consumed credit
  creditRemainingCents: number;   // available - consumed (never negative)
}

function computePaymentStatus(totalCents: number, paidCents: number): 'UNPAID' | 'PARTIAL' | 'PAID' {
  if (paidCents <= 0)          return 'UNPAID';
  if (paidCents >= totalCents) return 'PAID';
  return 'PARTIAL';
}

/**
 * `bills` MUST already be oldest-first (the service does this in the DB query
 * via orderBy [{ date: 'asc' }, { number: 'asc' }]).
 *
 * `available` is the credit balance re-read INSIDE the $transaction; the caller
 * cannot spend more than this even if it requested more.
 */
function applyCredit(requestedCents: number, available: number, bills: Bill[]): ApplyCreditResult {
  if (requestedCents <= 0) throw new Error('Amount must be positive');
  if (available <= 0)      throw new Error('No credit available');

  // Funding pool capped at the on-hand balance — the core overdraw guard.
  let remaining = Math.min(requestedCents, available);
  const allocations: Allocation[] = [];

  for (const bill of bills) {
    if (remaining <= 0) break;

    const effectiveTotal = Math.max(0, bill.totalCents - bill.returned);
    const outstanding    = effectiveTotal - bill.paidCents;
    if (outstanding <= 0) continue;

    const applied   = Math.min(remaining, outstanding);
    const newPaid   = bill.paidCents + applied;
    const newStatus = computePaymentStatus(effectiveTotal, newPaid);

    allocations.push({
      billId:       bill.id,
      billNumber:   bill.number,
      appliedCents: applied,
      newPaid,
      newStatus,
    });
    remaining -= applied;
  }

  const consumed = allocations.reduce((s, a) => s + a.appliedCents, 0);
  return {
    allocations,
    appliedCents:         consumed,
    creditRemainingCents: available - consumed,
  };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────────

/** Three fresh unpaid bills, oldest-first: 1000, 2000, 3000 cents. */
const threeBills = (): Bill[] => [
  { id: 's1', number: 'INV-2026-0001', totalCents: 1000, paidCents: 0, returned: 0 },
  { id: 's2', number: 'INV-2026-0002', totalCents: 2000, paidCents: 0, returned: 0 },
  { id: 's3', number: 'INV-2026-0003', totalCents: 3000, paidCents: 0, returned: 0 },
];

// ─── Tests ───────────────────────────────────────────────────────────────────────

describe('Apply-credit — cap at available balance (overdraw guard)', () => {
  test('requesting more than available spends only what is on hand', () => {
    // credit on hand 2500, ask to apply 9999 → only 2500 usable
    const res = applyCredit(9999, 2500, threeBills());
    // 1000 (bill1) + 1500 (part of bill2) = 2500
    expect(res.appliedCents).toBe(2500);
    expect(res.creditRemainingCents).toBe(0);
    expect(res.allocations[0]).toMatchObject({ appliedCents: 1000, newStatus: 'PAID' });
    expect(res.allocations[1]).toMatchObject({ appliedCents: 1500, newStatus: 'PARTIAL' });
    expect(res.allocations).toHaveLength(2);
  });

  test('requesting less than available spends only the request, credit remains', () => {
    // credit on hand 5000, ask to apply 1500 → 1500 spent, 3500 stays
    const res = applyCredit(1500, 5000, threeBills());
    expect(res.appliedCents).toBe(1500);
    expect(res.creditRemainingCents).toBe(3500);
    expect(res.allocations[0]).toMatchObject({ appliedCents: 1000, newStatus: 'PAID' });
    expect(res.allocations[1]).toMatchObject({ appliedCents: 500, newStatus: 'PARTIAL' });
  });
});

describe('Apply-credit — oldest-first order', () => {
  test('fills bills in age order and stops when funding exhausted', () => {
    // available 3000, request 3000 → bill1 full (1000), bill2 full (2000), bill3 untouched
    const res = applyCredit(3000, 3000, threeBills());
    expect(res.allocations).toHaveLength(2);
    expect(res.allocations[0]).toMatchObject({ billNumber: 'INV-2026-0001', newStatus: 'PAID' });
    expect(res.allocations[1]).toMatchObject({ billNumber: 'INV-2026-0002', newStatus: 'PAID' });
    expect(res.appliedCents).toBe(3000);
    expect(res.creditRemainingCents).toBe(0);
  });
});

describe('Apply-credit — no outstanding bills → nothing consumed', () => {
  test('empty bill list consumes no credit, full balance remains', () => {
    const res = applyCredit(5000, 5000, []);
    expect(res.allocations).toHaveLength(0);
    expect(res.appliedCents).toBe(0);
    expect(res.creditRemainingCents).toBe(5000);
  });

  test('all bills already paid → skipped, no credit consumed', () => {
    const paid: Bill[] = [
      { id: 's1', number: 'INV-2026-0001', totalCents: 1000, paidCents: 1000, returned: 0 },
      { id: 's2', number: 'INV-2026-0002', totalCents: 2000, paidCents: 2000, returned: 0 },
    ];
    const res = applyCredit(3000, 4000, paid);
    expect(res.allocations).toHaveLength(0);
    expect(res.appliedCents).toBe(0);
    expect(res.creditRemainingCents).toBe(4000);
  });
});

describe('Apply-credit — returns-aware outstanding', () => {
  test('fully-returned bill is skipped', () => {
    const bills: Bill[] = [
      { id: 's1', number: 'INV-2026-0001', totalCents: 1000, paidCents: 0, returned: 1000 }, // net 0
      { id: 's2', number: 'INV-2026-0002', totalCents: 2000, paidCents: 0, returned: 0 },
    ];
    const res = applyCredit(5000, 5000, bills);
    expect(res.allocations).toHaveLength(1);
    expect(res.allocations[0]).toMatchObject({ billNumber: 'INV-2026-0002', appliedCents: 2000, newStatus: 'PAID' });
    expect(res.appliedCents).toBe(2000);
    expect(res.creditRemainingCents).toBe(3000);
  });

  test('partial return reduces the outstanding credit can cover', () => {
    // bill total 3000, returned 1000 → effective 2000 owed
    const bills: Bill[] = [
      { id: 's1', number: 'INV-2026-0001', totalCents: 3000, paidCents: 0, returned: 1000 },
    ];
    const res = applyCredit(5000, 5000, bills);
    expect(res.allocations).toHaveLength(1);
    expect(res.allocations[0]).toMatchObject({ appliedCents: 2000, newStatus: 'PAID' });
    expect(res.appliedCents).toBe(2000);
    expect(res.creditRemainingCents).toBe(3000);
  });

  test('over-returned bill never goes negative', () => {
    const bills: Bill[] = [
      { id: 's1', number: 'INV-2026-0001', totalCents: 1000, paidCents: 0, returned: 1500 },
    ];
    const res = applyCredit(1000, 1000, bills);
    expect(res.allocations).toHaveLength(0);
    expect(res.appliedCents).toBe(0);
    expect(res.creditRemainingCents).toBe(1000);
  });
});

describe('Apply-credit — supplier mirror (identical algorithm)', () => {
  test('supplier POs consume credit oldest-first', () => {
    const pos: Bill[] = [
      { id: 'p1', number: 'PO-2026-0001', totalCents: 5000, paidCents: 1000, returned: 0 }, // owes 4000
      { id: 'p2', number: 'PO-2026-0002', totalCents: 3000, paidCents: 0,    returned: 500 }, // owes 2500
    ];
    // available 5000, request 5000 → PO1 4000 full, PO2 1000 partial
    const res = applyCredit(5000, 5000, pos);
    expect(res.allocations).toHaveLength(2);
    expect(res.allocations[0]).toMatchObject({ billNumber: 'PO-2026-0001', appliedCents: 4000, newStatus: 'PAID' });
    expect(res.allocations[1]).toMatchObject({ billNumber: 'PO-2026-0002', appliedCents: 1000, newStatus: 'PARTIAL' });
    expect(res.appliedCents).toBe(5000);
    expect(res.creditRemainingCents).toBe(0);
  });
});

describe('Apply-credit — guards', () => {
  test('rejects zero request', () => {
    expect(() => applyCredit(0, 5000, threeBills())).toThrow('Amount must be positive');
  });

  test('rejects negative request', () => {
    expect(() => applyCredit(-500, 5000, threeBills())).toThrow('Amount must be positive');
  });

  test('rejects when no credit is available', () => {
    expect(() => applyCredit(1000, 0, threeBills())).toThrow('No credit available');
  });

  test('conserves money: consumed + remaining === available, never overspends', () => {
    for (const available of [1, 999, 1000, 4500, 6000, 6001, 99999]) {
      for (const request of [1, 500, 6000, 999999]) {
        const res = applyCredit(request, available, threeBills());
        // consumed can never exceed what was on hand
        expect(res.appliedCents).toBeLessThanOrEqual(available);
        // and can never exceed what was requested
        expect(res.appliedCents).toBeLessThanOrEqual(request);
        // money conservation against the available pool
        expect(res.appliedCents + res.creditRemainingCents).toBe(available);
        // remaining never negative
        expect(res.creditRemainingCents).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
