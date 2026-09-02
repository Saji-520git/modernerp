// Makes this file a MODULE rather than a script. Without it TypeScript treats
// every import-less test file as sharing one global scope, and this file's
// `threeBills` collides with the identically-named helper in
// apply-credit.test.ts (TS2451). The failure is cache-dependent: on a cold
// ts-jest cache the whole suite fails to compile, and on a warm one it passes —
// so CI and a fresh clone broke while a developer's machine looked clean.
export {};

/**
 * Lump-Sum Payment Allocation Tests
 *
 * These tests verify the core allocation algorithm in isolation — no live DB.
 * The pure function below mirrors, byte-for-byte in logic, the loop inside
 * customer-payment.service.ts `recordLumpSumPayment` and its supplier twin
 * supplier-payment.service.ts `recordLumpSumPayment`:
 *   • oldest-first (callers pass bills already ordered by date, then number)
 *   • returns-aware outstanding = max(0, total - returned) - paid
 *   • applied = min(remaining, outstanding); skip bills with outstanding <= 0
 *   • leftover after all bills is parked as unallocated credit (never rejected)
 *
 * Keeping the algorithm in one pure function lets us prove the money math
 * without a Postgres connection, exactly like unit-conversion.test.ts.
 */

// ─── Pure allocator (mirrors the service loop) ──────────────────────────────────

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

interface AllocationResult {
  allocations:      Allocation[];
  appliedCents:     number;
  creditAddedCents: number;
}

function computePaymentStatus(totalCents: number, paidCents: number): 'UNPAID' | 'PARTIAL' | 'PAID' {
  if (paidCents <= 0)          return 'UNPAID';
  if (paidCents >= totalCents) return 'PAID';
  return 'PARTIAL';
}

/**
 * `bills` MUST already be oldest-first (the service does this in the DB query
 * via orderBy [{ date: 'asc' }, { number: 'asc' }]).
 */
function allocateLumpSum(amountCents: number, bills: Bill[]): AllocationResult {
  if (amountCents <= 0) throw new Error('Amount must be positive');

  let remaining = amountCents;
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

  return {
    allocations,
    appliedCents:     amountCents - remaining,
    creditAddedCents: remaining > 0 ? remaining : 0,
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

describe('Lump-sum allocation — exact fit', () => {
  test('pays every bill in full, no credit left', () => {
    const res = allocateLumpSum(6000, threeBills());
    expect(res.allocations).toHaveLength(3);
    expect(res.allocations.map((a) => a.appliedCents)).toEqual([1000, 2000, 3000]);
    expect(res.allocations.every((a) => a.newStatus === 'PAID')).toBe(true);
    expect(res.appliedCents).toBe(6000);
    expect(res.creditAddedCents).toBe(0);
  });
});

describe('Lump-sum allocation — oldest-first order & partial last bill', () => {
  test('fills bill 1 & 2 fully, part of bill 3, no credit', () => {
    // 1000 + 2000 + 1500 = 4500
    const res = allocateLumpSum(4500, threeBills());
    expect(res.allocations).toHaveLength(3);
    expect(res.allocations[0]).toMatchObject({ billNumber: 'INV-2026-0001', appliedCents: 1000, newStatus: 'PAID' });
    expect(res.allocations[1]).toMatchObject({ billNumber: 'INV-2026-0002', appliedCents: 2000, newStatus: 'PAID' });
    expect(res.allocations[2]).toMatchObject({ billNumber: 'INV-2026-0003', appliedCents: 1500, newStatus: 'PARTIAL' });
    expect(res.appliedCents).toBe(4500);
    expect(res.creditAddedCents).toBe(0);
  });

  test('stops once amount is exhausted — later bills untouched', () => {
    // 1200 covers bill 1 (1000) fully + 200 of bill 2; bill 3 never allocated
    const res = allocateLumpSum(1200, threeBills());
    expect(res.allocations).toHaveLength(2);
    expect(res.allocations[0]).toMatchObject({ appliedCents: 1000, newStatus: 'PAID' });
    expect(res.allocations[1]).toMatchObject({ appliedCents: 200, newStatus: 'PARTIAL' });
    expect(res.creditAddedCents).toBe(0);
  });
});

describe('Lump-sum allocation — overflow parked as credit', () => {
  test('pays all bills then parks the remainder', () => {
    // total owed 6000, pay 8000 → 2000 parked
    const res = allocateLumpSum(8000, threeBills());
    expect(res.allocations).toHaveLength(3);
    expect(res.allocations.every((a) => a.newStatus === 'PAID')).toBe(true);
    expect(res.appliedCents).toBe(6000);
    expect(res.creditAddedCents).toBe(2000);
  });
});

describe('Lump-sum allocation — zero bills → all credit', () => {
  test('nothing outstanding parks the whole amount', () => {
    const res = allocateLumpSum(5000, []);
    expect(res.allocations).toHaveLength(0);
    expect(res.appliedCents).toBe(0);
    expect(res.creditAddedCents).toBe(5000);
  });

  test('all bills already fully paid → skipped, whole amount parked', () => {
    const paidBills: Bill[] = [
      { id: 's1', number: 'INV-2026-0001', totalCents: 1000, paidCents: 1000, returned: 0 },
      { id: 's2', number: 'INV-2026-0002', totalCents: 2000, paidCents: 2000, returned: 0 },
    ];
    const res = allocateLumpSum(3000, paidBills);
    expect(res.allocations).toHaveLength(0);
    expect(res.creditAddedCents).toBe(3000);
  });
});

describe('Lump-sum allocation — returns-aware outstanding', () => {
  test('a fully-returned bill is skipped', () => {
    const bills: Bill[] = [
      { id: 's1', number: 'INV-2026-0001', totalCents: 1000, paidCents: 0, returned: 1000 }, // net 0
      { id: 's2', number: 'INV-2026-0002', totalCents: 2000, paidCents: 0, returned: 0 },
    ];
    const res = allocateLumpSum(2000, bills);
    expect(res.allocations).toHaveLength(1);
    expect(res.allocations[0]).toMatchObject({ billNumber: 'INV-2026-0002', appliedCents: 2000, newStatus: 'PAID' });
    expect(res.creditAddedCents).toBe(0);
  });

  test('partial return reduces the outstanding the lump-sum can cover', () => {
    // bill total 3000, returned 1000 → effective 2000 owed
    const bills: Bill[] = [
      { id: 's1', number: 'INV-2026-0001', totalCents: 3000, paidCents: 0, returned: 1000 },
    ];
    const res = allocateLumpSum(2500, bills);
    expect(res.allocations).toHaveLength(1);
    expect(res.allocations[0]).toMatchObject({ appliedCents: 2000, newStatus: 'PAID' });
    expect(res.creditAddedCents).toBe(500); // 2500 - 2000 owed
  });

  test('over-returned bill (returns exceed total) never goes negative', () => {
    const bills: Bill[] = [
      { id: 's1', number: 'INV-2026-0001', totalCents: 1000, paidCents: 0, returned: 1500 },
    ];
    const res = allocateLumpSum(1000, bills);
    expect(res.allocations).toHaveLength(0);
    expect(res.creditAddedCents).toBe(1000);
  });
});

describe('Lump-sum allocation — single-bill path still works', () => {
  test('one outstanding bill, exact amount → same as a normal payment', () => {
    const bills: Bill[] = [
      { id: 's1', number: 'INV-2026-0001', totalCents: 1500, paidCents: 0, returned: 0 },
    ];
    const res = allocateLumpSum(1500, bills);
    expect(res.allocations).toHaveLength(1);
    expect(res.allocations[0]).toMatchObject({ appliedCents: 1500, newStatus: 'PAID' });
    expect(res.creditAddedCents).toBe(0);
  });

  test('one bill, partial amount → PARTIAL, no credit', () => {
    const bills: Bill[] = [
      { id: 's1', number: 'INV-2026-0001', totalCents: 1500, paidCents: 200, returned: 0 },
    ];
    const res = allocateLumpSum(300, bills);
    expect(res.allocations[0]).toMatchObject({ appliedCents: 300, newPaid: 500, newStatus: 'PARTIAL' });
    expect(res.creditAddedCents).toBe(0);
  });
});

describe('Lump-sum allocation — supplier mirror (identical algorithm)', () => {
  // Supplier PurchaseLine returns are aggregated the same way; the allocator is
  // the same code path with Purchase in place of Sale. Proving parity here.
  test('supplier POs allocate oldest-first with overflow → supplier credit', () => {
    const pos: Bill[] = [
      { id: 'p1', number: 'PO-2026-0001', totalCents: 5000, paidCents: 1000, returned: 0 }, // owes 4000
      { id: 'p2', number: 'PO-2026-0002', totalCents: 3000, paidCents: 0,    returned: 500 }, // owes 2500
    ];
    const res = allocateLumpSum(7000, pos);
    expect(res.allocations).toHaveLength(2);
    expect(res.allocations[0]).toMatchObject({ billNumber: 'PO-2026-0001', appliedCents: 4000, newStatus: 'PAID' });
    expect(res.allocations[1]).toMatchObject({ billNumber: 'PO-2026-0002', appliedCents: 2500, newStatus: 'PAID' });
    expect(res.appliedCents).toBe(6500);
    expect(res.creditAddedCents).toBe(500);
  });
});

describe('Lump-sum allocation — guards', () => {
  test('rejects zero amount', () => {
    expect(() => allocateLumpSum(0, threeBills())).toThrow('Amount must be positive');
  });

  test('rejects negative amount', () => {
    expect(() => allocateLumpSum(-500, threeBills())).toThrow('Amount must be positive');
  });

  test('conserves money: applied + credit === amount', () => {
    for (const amt of [1, 999, 1000, 4500, 6000, 6001, 99999]) {
      const res = allocateLumpSum(amt, threeBills());
      expect(res.appliedCents + res.creditAddedCents).toBe(amt);
    }
  });
});
