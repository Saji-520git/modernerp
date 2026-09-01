import { netOutstandingCents, netOutstandingFromInvoices, type OutstandingInput } from '../src/utils/outstanding';

const bal = (o: Partial<OutstandingInput> = {}): OutstandingInput => ({
  invoicedCents:       1_000_000,   // Rs.10,000 billed
  returnedCents:               0,
  paidCents:                   0,
  openingBalanceCents:         0,
  creditBalanceCents:          0,
  ...o,
});

describe('customer net outstanding', () => {
  it('owes the full invoice when nothing is paid', () => {
    expect(netOutstandingCents(bal())).toBe(1_000_000);
  });

  it('subtracts what has been paid', () => {
    expect(netOutstandingCents(bal({ paidCents: 400_000 }))).toBe(600_000);
  });

  it('subtracts returns — goods handed back are not money owed', () => {
    // The bug this closes: the till counted the full 10,000 and refused the
    // customer, while their own page showed 7,000.
    expect(netOutstandingCents(bal({ returnedCents: 300_000 }))).toBe(700_000);
  });

  it('subtracts credit held on the account', () => {
    // Rs.1,500 left over from a lump-sum payment offsets the debt.
    expect(netOutstandingCents(bal({ creditBalanceCents: 150_000 }))).toBe(850_000);
  });

  it('applies returns, payment and credit together', () => {
    expect(netOutstandingCents(bal({
      returnedCents:      300_000,
      paidCents:          400_000,
      creditBalanceCents: 100_000,
    }))).toBe(200_000);   // 10,000 − 3,000 − 4,000 − 1,000
  });

  it('adds opening balance AFTER clamping the invoice side', () => {
    // An overpaid invoice must not quietly erase unrelated legacy debt:
    // invoice side clamps to 0, so the opening balance survives intact.
    expect(netOutstandingCents(bal({
      invoicedCents:       100_000,
      paidCents:           500_000,     // overpaid by 4,000
      openingBalanceCents: 200_000,
    }))).toBe(200_000);
  });

  it('lets credit offset an opening balance too', () => {
    expect(netOutstandingCents(bal({
      invoicedCents:             0,
      openingBalanceCents: 200_000,
      creditBalanceCents:   50_000,
    }))).toBe(150_000);
  });

  it('never goes negative when credit exceeds the debt', () => {
    // The customer is in hand. That is a liability, not a negative receivable —
    // the credit balance itself is what reports it.
    expect(netOutstandingCents(bal({
      invoicedCents:       100_000,
      creditBalanceCents:  500_000,
    }))).toBe(0);
  });

  it('never goes negative when returns exceed what was invoiced', () => {
    expect(netOutstandingCents(bal({ returnedCents: 1_500_000 }))).toBe(0);
  });

  it('is zero for a settled customer', () => {
    expect(netOutstandingCents(bal({ paidCents: 1_000_000 }))).toBe(0);
  });

  it('a fully returned unpaid invoice leaves nothing owed', () => {
    // And no credit is issued for it either — see return-credit.ts.
    expect(netOutstandingCents(bal({ returnedCents: 1_000_000 }))).toBe(0);
  });

  // The property that proves netting cannot double-count: applying credit to an
  // invoice moves money from creditBalanceCents into paidCents, and the answer
  // must not move with it. If these two ever disagree, the customer is either
  // credited twice or charged twice.
  it('gives the same answer before and after credit is applied', () => {
    const beforeApplying = netOutstandingCents(bal({
      invoicedCents:       850_000,
      creditBalanceCents:  150_000,   // sitting unapplied
    }));
    const afterApplying = netOutstandingCents(bal({
      invoicedCents:       850_000,
      paidCents:           150_000,   // same money, now allocated
      creditBalanceCents:        0,
    }));
    expect(beforeApplying).toBe(700_000);
    expect(afterApplying).toBe(beforeApplying);
  });

  it('holds that property when returns are in play too', () => {
    const unapplied = netOutstandingCents(bal({
      invoicedCents: 1_000_000, returnedCents: 300_000, creditBalanceCents: 200_000,
    }));
    const applied = netOutstandingCents(bal({
      invoicedCents: 1_000_000, returnedCents: 300_000, paidCents: 200_000,
    }));
    expect(unapplied).toBe(500_000);
    expect(applied).toBe(unapplied);
  });
});

describe('net outstanding across invoices', () => {
  const inv = (totalCents: number, returnedCents: number, paidCents: number) =>
    ({ totalCents, returnedCents, paidCents });

  it('clamps EACH invoice, so an overpaid one cannot cancel another\'s debt', () => {
    // The live-data bug: C is overpaid by 9,000 after a return against an
    // already-settled bill. Clamping the sum would net it off B's 80,000 and
    // report 71,000 — then the credit (which is that same 9,000) subtracts it
    // a second time.
    const rows = [
      inv(40_000,      0, 40_000),   // A — settled
      inv(100_000, 20_000,      0),  // B — owes 80,000
      inv(36_000,   9_000, 36_000),  // C — overpaid by 9,000
      inv(8_500,        0,  8_500),  // D — settled
    ];
    expect(netOutstandingFromInvoices(rows, 0, 0)).toBe(80_000);
    // With the 9,000 held as credit, it comes off exactly once.
    expect(netOutstandingFromInvoices(rows, 0, 10_500)).toBe(69_500);
  });

  it('matches the naive sum when no invoice is overpaid', () => {
    const rows = [inv(50_000, 0, 20_000), inv(30_000, 5_000, 0)];
    expect(netOutstandingFromInvoices(rows, 0, 0)).toBe(55_000);
  });

  it('adds the opening balance and subtracts credit once', () => {
    const rows = [inv(50_000, 0, 20_000)];
    expect(netOutstandingFromInvoices(rows, 10_000, 5_000)).toBe(35_000);
  });

  it('never goes negative', () => {
    expect(netOutstandingFromInvoices([inv(10_000, 0, 10_000)], 0, 50_000)).toBe(0);
  });

  it('is zero for no invoices', () => {
    expect(netOutstandingFromInvoices([], 0, 0)).toBe(0);
  });
});
