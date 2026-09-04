// ─── Demo layer regression tests ─────────────────────────────────────────────
//
// These run in vitest's default Node environment — there is no jsdom here and
// no `localStorage`. That is fine and deliberate: every storage access in the
// demo layer is wrapped in try/catch, so under Node it simply behaves as a
// fresh in-memory seed. It also means these tests exercise the handlers
// directly, without the axios adapter, which is where the logic actually lives.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildSeed, resetDb, getDb, nextDocNumber } from './db';
import { PRODUCTS, CUSTOMERS, SUPPLIERS } from './catalogue';
import { DEMO_ACCOUNTS } from './config';
import { ROLE_PERMISSIONS } from './permissions';
import { toLocalYMD } from '../utils/local-date';
import {
  posCheckout, customerCredit, createSale, updateSale, deleteSale, confirmSale,
  cancelSale, recordSalePayment, saleForReturn, createReturn,
  createCustomerPayment, deleteCustomerPayment,
} from './handlers/selling';
import { confirmPurchase, receivePurchase, createPurchaseReturn, confirmPurchaseReturn } from './handlers/buying';
import { listStock } from './handlers/catalog';
import { dashboardSummary, profitLoss } from './handlers/analytics';
import { login } from './handlers/core';
import { DemoHttpError } from './http';

const ctx = (over: Partial<Parameters<typeof posCheckout>[0]> = {}) => ({
  params: {}, query: {}, body: {}, method: 'GET', path: '/', ...over,
});

beforeEach(() => {
  // Each test starts from the same shop.
  resetDb();
});

describe('seed data', () => {
  it('carries no real customer or supplier data', () => {
    const seed = buildSeed();
    // Every name is one of the invented ones. If someone ever pastes a real
    // customer list in here, this fails.
    const known = new Set(CUSTOMERS.map((c) => c.name));
    for (const c of seed.customers) expect(known.has(c.name)).toBe(true);
    const knownSup = new Set(SUPPLIERS.map((s) => s.name));
    for (const s of seed.suppliers) expect(knownSup.has(s.name)).toBe(true);
  });

  it('never uses the production seed credentials', () => {
    // backend/src/prisma/seed.ts defaults. These must not reach a public URL.
    const emails = DEMO_ACCOUNTS.map((a) => a.email.toLowerCase());
    const passwords = DEMO_ACCOUNTS.map((a) => a.password);
    expect(emails).not.toContain('modernerp@gmail.com');
    expect(passwords).not.toContain('superadmin123');
  });

  it('grants no demo account SUPER_ADMIN', () => {
    // SUPER_ADMIN bypasses every module and role gate in AppShell.isVisible.
    for (const a of DEMO_ACCOUNTS) expect(a.role).not.toBe('SUPER_ADMIN');
    expect(Object.keys(ROLE_PERMISSIONS)).not.toContain('SUPER_ADMIN');
  });

  it('withholds the two super-admin-only permissions from ADMIN', () => {
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('manage_modules');
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('clear_data');
  });

  it('holds money as integer cents only', () => {
    const seed = buildSeed();
    for (const p of seed.products) {
      expect(Number.isInteger(p.priceCents)).toBe(true);
      expect(Number.isInteger(p.costCents)).toBe(true);
    }
    for (const s of seed.sales) {
      expect(Number.isInteger(s.totalCents)).toBe(true);
      expect(Number.isInteger(s.paidCents)).toBe(true);
    }
  });

  it('never stores a sale at UTC midnight', () => {
    // CLAUDE.md issues 19-22: a date-only string parses as UTC midnight, which
    // reads back as 05:30 local in Colombo. Real trading instants never land
    // exactly on 00:00:00.000Z.
    const seed = buildSeed();
    for (const s of seed.sales) {
      const d = new Date(s.date);
      const utcMidnight =
        d.getUTCHours() === 0 && d.getUTCMinutes() === 0 &&
        d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
      expect(utcMidnight).toBe(false);
    }
  });

  it('places no sale in the future', () => {
    const seed = buildSeed();
    const now = Date.now();
    for (const s of seed.sales) expect(Date.parse(s.date)).toBeLessThanOrEqual(now);
  });

  it('gives today some trading, whatever hour it is seeded at', () => {
    // Otherwise a link opened before the shop "opens" shows Rs. 0 and -100%.
    const seed = buildSeed();
    const today = toLocalYMD(new Date());
    const todays = seed.sales.filter((s) => toLocalYMD(new Date(s.date)) === today);
    expect(todays.length).toBeGreaterThan(0);
  });

  it('never seeds negative stock', () => {
    const seed = buildSeed();
    for (const s of seed.stock) expect(s.qty).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic — two visitors see the same shop', () => {
    const a = buildSeed();
    const b = buildSeed();
    expect(a.sales.length).toBe(b.sales.length);
    expect(a.sales.reduce((n, s) => n + s.totalCents, 0))
      .toBe(b.sales.reduce((n, s) => n + s.totalCents, 0));
  });
});

describe('document numbering', () => {
  it('derives from max+1, not a row count', () => {
    // CLAUDE.md sprint 21 / issue 6: counting rows skips and collides after a
    // delete. Two rows whose highest number is 0009 must yield 0010.
    const year = new Date().getFullYear();
    const existing = [`INV-${year}-0009`, `INV-${year}-0002`];
    expect(nextDocNumber('INV', existing)).toBe(`INV-${year}-0010`);
  });

  it('ignores other years and other prefixes', () => {
    const year = new Date().getFullYear();
    const existing = [`INV-${year - 1}-0500`, `PO-${year}-0400`, `INV-${year}-0003`];
    expect(nextDocNumber('INV', existing)).toBe(`INV-${year}-0004`);
  });
});

describe('auth', () => {
  it('accepts a demo account', () => {
    const a = DEMO_ACCOUNTS[0];
    const out = login(ctx({ body: { email: a.email, password: a.password } })) as any;
    expect(out.user.role).toBe(a.role);
    expect(out.access).toBeTruthy();
  });

  it('rejects a wrong password with 401', () => {
    const a = DEMO_ACCOUNTS[0];
    try {
      login(ctx({ body: { email: a.email, password: 'nope' } }));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(DemoHttpError);
      expect((e as DemoHttpError).status).toBe(401);
    }
  });

  it('does not reveal whether the address exists', () => {
    const a = DEMO_ACCOUNTS[0];
    const wrongPass = (() => { try { login(ctx({ body: { email: a.email, password: 'x' } })); } catch (e) { return (e as Error).message; } })();
    const noUser = (() => { try { login(ctx({ body: { email: 'nobody@example.com', password: 'x' } })); } catch (e) { return (e as Error).message; } })();
    expect(wrongPass).toBe(noUser);
  });
});

describe('POS checkout', () => {
  const product = PRODUCTS.find((p) => !p.isBatchTracked && p.stock.wh_main > 20)!;

  it('deducts stock and records a SALE_OUT movement', () => {
    const before = getDb().stock.find((s) => s.productId === product.id && s.warehouseId === 'wh_main')!.qty;
    const out = posCheckout(ctx({
      body: { warehouseId: 'wh_main', paymentMethod: 'CASH', items: [{ productId: product.id, qty: 3 }] },
    })) as any;

    const after = getDb().stock.find((s) => s.productId === product.id && s.warehouseId === 'wh_main')!.qty;
    expect(after).toBe(before - 3);
    expect(out.receipt.totalCents).toBe(product.priceCents * 3);

    const moves = getDb().movements.filter((m) => m.refId === out.receipt.id);
    expect(moves).toHaveLength(1);
    expect(moves[0].type).toBe('SALE_OUT');
    expect(moves[0].qty).toBe(-3);
  });

  it('issues the next invoice number without reusing one', () => {
    const first = posCheckout(ctx({ body: { warehouseId: 'wh_main', paymentMethod: 'CASH', items: [{ productId: product.id, qty: 1 }] } })) as any;
    const second = posCheckout(ctx({ body: { warehouseId: 'wh_main', paymentMethod: 'CASH', items: [{ productId: product.id, qty: 1 }] } })) as any;
    expect(second.receipt.number).not.toBe(first.receipt.number);
    const numbers = getDb().sales.map((s) => s.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('refuses to oversell when negative stock is off', () => {
    const onHand = getDb().stock.find((s) => s.productId === product.id && s.warehouseId === 'wh_main')!.qty;
    expect(() =>
      posCheckout(ctx({ body: { warehouseId: 'wh_main', paymentMethod: 'CASH', items: [{ productId: product.id, qty: onHand + 1 }] } })),
    ).toThrow(DemoHttpError);
  });

  it('rejects an empty cart', () => {
    expect(() => posCheckout(ctx({ body: { warehouseId: 'wh_main', paymentMethod: 'CASH', items: [] } }))).toThrow(DemoHttpError);
  });

  it('converts a box to base units before deducting', () => {
    const boxed = PRODUCTS.find((p) => p.boxOf && p.stock.wh_main > 100)!;
    const before = getDb().stock.find((s) => s.productId === boxed.id && s.warehouseId === 'wh_main')!.qty;
    posCheckout(ctx({
      body: { warehouseId: 'wh_main', paymentMethod: 'CASH', items: [{ productId: boxed.id, qty: 1, unitId: 'unit_box' }] },
    }));
    const after = getDb().stock.find((s) => s.productId === boxed.id && s.warehouseId === 'wh_main')!.qty;
    expect(after).toBe(before - boxed.boxOf!);
  });

  it('blocks a credit sale to a customer not set up for credit', () => {
    const noCredit = CUSTOMERS.find((c) => !c.creditEnabled)!;
    expect(() =>
      posCheckout(ctx({
        body: { warehouseId: 'wh_main', paymentMethod: 'CREDIT', customerId: noCredit.id, items: [{ productId: product.id, qty: 1 }] },
      })),
    ).toThrow(/not set up for credit/i);
  });

  it('blocks a credit sale that would breach the limit', () => {
    const c = CUSTOMERS.find((x) => x.creditEnabled)!;
    const expensive = PRODUCTS.find((p) => p.priceCents > 1_000_000)!;
    // Enough units to clear any limit in the seed.
    const qty = Math.ceil(c.creditLimitCents / expensive.priceCents) + 5;
    const row = getDb().stock.find((s) => s.productId === expensive.id && s.warehouseId === 'wh_main')!;
    row.qty = qty + 10;   // take stock out of the equation
    expect(() =>
      posCheckout(ctx({
        body: { warehouseId: 'wh_main', paymentMethod: 'CREDIT', customerId: c.id, items: [{ productId: expensive.id, qty }] },
      })),
    ).toThrow(/credit limit/i);
  });

  it('reports a credit balance that matches the unpaid invoices', () => {
    const c = CUSTOMERS.find((x) => x.creditEnabled)!;
    const info = customerCredit(ctx({ params: { id: c.id } })) as any;
    const expected = getDb().sales
      .filter((s) => s.customerId === c.id && s.status === 'CONFIRMED')
      .reduce((n, s) => n + Math.max(0, s.totalCents - s.paidCents), 0);
    expect(info.balance).toBe(expected);
  });
});

// ─── Billing ─────────────────────────────────────────────────────────────────
//
// The flow the client cares about most, and the one that was broken: the app
// calls confirm / cancel / pay with PATCH and the demo had registered them as
// POST, so every one of them 404'd. Loading the page never noticed, because a
// page load only issues GETs.

describe('the billing chain', () => {
  const product = PRODUCTS.find((p) => !p.isBatchTracked && p.stock.wh_main > 40)!;
  const creditCustomer = CUSTOMERS.find((c) => c.creditEnabled)!;

  const newDraft = (qty = 4) =>
    createSale(ctx({
      body: {
        warehouseId: 'wh_main',
        customerId: creditCustomer.id,
        lines: [{ productId: product.id, qty, unitPriceCents: product.priceCents }],
      },
    })) as any;

  it('creates a draft that has moved no stock yet', () => {
    const before = getDb().stock.find((s) => s.productId === product.id && s.warehouseId === 'wh_main')!.qty;
    const sale = newDraft();
    const after = getDb().stock.find((s) => s.productId === product.id && s.warehouseId === 'wh_main')!.qty;
    expect(sale.status).toBe('DRAFT');
    expect(sale.totalCents).toBe(product.priceCents * 4);
    expect(after).toBe(before);
  });

  it('edits a draft, and refuses to edit a confirmed invoice', () => {
    const sale = newDraft();
    const edited = updateSale(ctx({
      params: { id: sale.id },
      body: { lines: [{ productId: product.id, qty: 7, unitPriceCents: product.priceCents }] },
    })) as any;
    expect(edited.totalCents).toBe(product.priceCents * 7);

    confirmSale(ctx({ params: { id: sale.id } }));
    expect(() => updateSale(ctx({ params: { id: sale.id }, body: { note: 'nope' } }))).toThrow(/draft/i);
  });

  it('deletes a draft but never a confirmed invoice', () => {
    const draft = newDraft();
    expect((deleteSale(ctx({ params: { id: draft.id } })) as any).success).toBe(true);

    const confirmed = newDraft();
    confirmSale(ctx({ params: { id: confirmed.id } }));
    // Deleting it would take a number out of the sequence — cancel is the path.
    expect(() => deleteSale(ctx({ params: { id: confirmed.id } }))).toThrow(/cannot be deleted/i);
  });

  it('confirming deducts stock and records the movement', () => {
    const sale = newDraft(6);
    const before = getDb().stock.find((s) => s.productId === product.id && s.warehouseId === 'wh_main')!.qty;
    confirmSale(ctx({ params: { id: sale.id } }));
    const after = getDb().stock.find((s) => s.productId === product.id && s.warehouseId === 'wh_main')!.qty;

    expect(after).toBe(before - 6);
    const moves = getDb().movements.filter((m) => m.refId === sale.id);
    expect(moves.map((m) => m.type)).toContain('SALE_OUT');
  });

  it('cancelling a confirmed invoice puts the stock back', () => {
    const sale = newDraft(5);
    confirmSale(ctx({ params: { id: sale.id } }));
    const afterConfirm = getDb().stock.find((s) => s.productId === product.id && s.warehouseId === 'wh_main')!.qty;
    cancelSale(ctx({ params: { id: sale.id } }));
    const afterCancel = getDb().stock.find((s) => s.productId === product.id && s.warehouseId === 'wh_main')!.qty;
    expect(afterCancel).toBe(afterConfirm + 5);
  });

  it('takes a part payment and leaves the balance outstanding', () => {
    const sale = newDraft(4);
    confirmSale(ctx({ params: { id: sale.id } }));
    const total = product.priceCents * 4;
    const part = Math.round(total / 4);

    recordSalePayment(ctx({ params: { id: sale.id }, body: { amountCents: part, method: 'CASH' } }));
    const after = getDb().sales.find((s) => s.id === sale.id)!;
    expect(after.paidCents).toBe(part);
    expect(after.totalCents - after.paidCents).toBe(total - part);
    expect(getDb().payments.filter((p) => p.saleId === sale.id)).toHaveLength(1);
  });

  it('refuses a payment larger than the balance', () => {
    const sale = newDraft(2);
    confirmSale(ctx({ params: { id: sale.id } }));
    const total = product.priceCents * 2;
    expect(() =>
      recordSalePayment(ctx({ params: { id: sale.id }, body: { amountCents: total + 100, method: 'CASH' } })),
    ).toThrow(/outstanding/i);
  });

  it('reversing a payment restores the receivable', () => {
    const sale = newDraft(3);
    confirmSale(ctx({ params: { id: sale.id } }));
    const pay = createCustomerPayment(ctx({
      body: { saleId: sale.id, amountCents: 5000, paymentMethod: 'CASH', paymentDate: new Date().toISOString() },
    })) as any;
    expect(getDb().sales.find((s) => s.id === sale.id)!.paidCents).toBe(5000);

    deleteCustomerPayment(ctx({ params: { id: pay.id } }));
    expect(getDb().sales.find((s) => s.id === sale.id)!.paidCents).toBe(0);
  });

  it('prepares a return with a per-line cap, and the return restores stock', () => {
    const sale = newDraft(8);
    confirmSale(ctx({ params: { id: sale.id } }));

    // `/sales/returns/for-sale/:id` returns the SALE with per-line return info,
    // not a list of credit notes. Handing back an array left every line
    // uncapped, because the page reads lines[].availableToReturn.
    const prep = saleForReturn(ctx({ params: { id: sale.id } })) as any;
    expect(Array.isArray(prep.lines)).toBe(true);
    expect(prep.lines[0].availableToReturn).toBe(8);
    expect(prep.lines[0].alreadyReturnedQty).toBe(0);

    const before = getDb().stock.find((s) => s.productId === product.id && s.warehouseId === 'wh_main')!.qty;
    createReturn(ctx({ body: { saleId: sale.id, lines: [{ productId: product.id, qty: 3 }] } }));
    const after = getDb().stock.find((s) => s.productId === product.id && s.warehouseId === 'wh_main')!.qty;
    expect(after).toBe(before + 3);

    // A second attempt may only take what is left.
    const prep2 = saleForReturn(ctx({ params: { id: sale.id } })) as any;
    expect(prep2.lines[0].alreadyReturnedQty).toBe(3);
    expect(prep2.lines[0].availableToReturn).toBe(5);
  });

  it('refuses to return more than was sold', () => {
    const sale = newDraft(2);
    confirmSale(ctx({ params: { id: sale.id } }));
    expect(() =>
      createReturn(ctx({ body: { saleId: sale.id, lines: [{ productId: product.id, qty: 5 }] } })),
    ).toThrow(/only 2/i);
  });
});

describe('purchasing', () => {
  it('confirming a purchase order brings stock in', () => {
    const po = getDb().purchases.find((p) => p.status === 'DRAFT')!;
    const line = po.lines[0];
    const before = getDb().stock.find((s) => s.productId === line.productId && s.warehouseId === po.warehouseId)!.qty;

    confirmPurchase(ctx({ params: { id: po.id } }));
    const after = getDb().stock.find((s) => s.productId === line.productId && s.warehouseId === po.warehouseId)!.qty;

    expect(getDb().purchases.find((p) => p.id === po.id)!.status).toBe('CONFIRMED');
    expect(after).toBe(before + line.qty);
  });

  it('receives a partial delivery and leaves the order PARTIAL', () => {
    const po = getDb().purchases.find((p) => p.status === 'DRAFT')!;
    const line = po.lines[0];
    const half = Math.max(1, Math.floor(line.qty / 2));

    receivePurchase(ctx({ params: { id: po.id }, body: { lines: [{ purchaseLineId: line.id, qty: half }] } }));
    const after = getDb().purchases.find((p) => p.id === po.id)!;
    expect(after.deliveryStatus).toBe(half >= line.qty ? 'COMPLETE' : 'PARTIAL');
    expect(after.lines[0].receivedQty).toBe(half);
  });

  it('a confirmed debit note sends stock back to the supplier', () => {
    const po = getDb().purchases.find((p) => p.status === 'DRAFT')!;
    confirmPurchase(ctx({ params: { id: po.id } }));
    const line = getDb().purchases.find((p) => p.id === po.id)!.lines[0];

    const ret = createPurchaseReturn(ctx({
      body: { purchaseId: po.id, lines: [{ purchaseLineId: line.id, qty: 2 }] },
    })) as any;
    expect(ret.status).toBe('DRAFT');

    const before = getDb().stock.find((s) => s.productId === line.productId && s.warehouseId === po.warehouseId)!.qty;
    confirmPurchaseReturn(ctx({ params: { id: ret.id } }));
    const after = getDb().stock.find((s) => s.productId === line.productId && s.warehouseId === po.warehouseId)!.qty;
    expect(after).toBe(before - 2);
  });
});

describe('reads reflect writes', () => {
  it('moves the dashboard when a sale is rung up', () => {
    const product = PRODUCTS.find((p) => !p.isBatchTracked && p.stock.wh_main > 20)!;
    const before = dashboardSummary(ctx()) as any;
    posCheckout(ctx({ body: { warehouseId: 'wh_main', paymentMethod: 'CASH', items: [{ productId: product.id, qty: 2 }] } }));
    const after = dashboardSummary(ctx()) as any;

    expect(after.kpis.todayOrders).toBe(before.kpis.todayOrders + 1);
    expect(after.kpis.todayRevenueCents).toBe(before.kpis.todayRevenueCents + product.priceCents * 2);
  });

  it('honours lowStockOnly rather than returning every row', () => {
    // The parameter is `lowStockOnly`; reading `lowStock` silently returned all
    // 64 stock rows and the dashboard claimed "64 low" for 32 products.
    const all = listStock(ctx()) as any;
    const low = listStock(ctx({ query: { lowStockOnly: 'true' } })) as any;
    expect(low.total).toBeLessThan(all.total);
    expect(low.data.every((r: any) => r.isLowStock)).toBe(true);
  });

  it('produces a P&L whose parts add up', () => {
    const year = new Date().getFullYear();
    const pnl = profitLoss(ctx({ query: { from: `${year}-01-01`, to: toLocalYMD(new Date()) } })) as any;
    const s = pnl.summary;
    expect(s.grossProfitCents).toBe(s.revenueCents - s.cogsCents);
    expect(s.netProfitCents).toBe(s.grossProfitCents - s.totalExpensesCents);
    expect(s.revenueCents).toBeGreaterThan(0);
  });
});
