// ─── The demo database ────────────────────────────────────────────────────────
//
// A plain object held in memory and mirrored into localStorage, so a visitor's
// own sales, edits and payments survive a page reload but never leave their
// browser. Seeded fresh on first load, and re-seeded by the "Reset demo data"
// button.
//
// Dates: built with `new Date(y, m, d, hh, mm)` — LOCAL constructors — and only
// then serialised with toISOString(). This is deliberate. Per CLAUDE.md issues
// 19-22, a date-only string like `new Date('2026-09-03')` parses as UTC
// midnight, which in Colombo reads back as 05:30 the next morning. Every
// timestamp below is a real instant on the shop's own clock.

import {
  UNITS, CATEGORIES, BRANDS, WAREHOUSES, PRODUCTS, SUPPLIERS, CUSTOMERS,
  EXPENSE_CATEGORIES, type CatProduct,
} from './catalogue';
import { DEMO_ACCOUNTS, DEMO_DB_KEY, DEMO_DB_VERSION } from './config';
import { toLocalYMD } from '../utils/local-date';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DemoUser {
  id: string; email: string; password: string; fullName: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER' | 'STAFF';
  permissions: string[] | null; isActive: boolean; createdAt: string; lastLoginAt: string | null;
}

export interface DemoStock { productId: string; warehouseId: string; qty: number; shortfallQty: number }

export interface DemoBatch {
  id: string; productId: string; warehouseId: string; qty: number;
  unitCostCents: number; batchNumber: string | null; expiryDate: string | null; receivedAt: string;
}

export interface DemoSaleLine {
  id: string; productId: string; qty: number; unitPriceCents: number;
  taxPercent: number; discountCents: number; lineTotalCents: number; unitId: string | null;
}

export interface DemoSale {
  id: string; number: string; isPos: boolean;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  date: string; customerId: string | null; warehouseId: string;
  subtotalCents: number; taxCents: number; discountCents: number; totalCents: number;
  paidCents: number; paymentMethod: string; note: string | null;
  createdById: string; lines: DemoSaleLine[]; createdAt: string;
}

export interface DemoPurchaseLine {
  id: string; productId: string; qty: number; receivedQty: number;
  unitCostCents: number; taxPercent: number; lineTotalCents: number; unitId: string | null;
}

export interface DemoPurchase {
  id: string; number: string; supplierId: string; warehouseId: string;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  deliveryStatus: 'PENDING' | 'PARTIAL' | 'COMPLETE';
  date: string; expectedDate: string | null; note: string | null;
  subtotalCents: number; taxCents: number; totalCents: number; paidCents: number;
  createdById: string; lines: DemoPurchaseLine[]; createdAt: string;
}

export interface DemoMovement {
  id: string; productId: string; warehouseId: string; type: string;
  qty: number; refType: string | null; refId: string | null; note: string | null; createdAt: string;
}

export interface DemoExpense {
  id: string; categoryId: string; amountCents: number; date: string;
  description: string; reference: string | null; paymentMethod: string; createdById: string; createdAt: string;
}

export interface DemoShift {
  id: string; userId: string; warehouseId: string;
  openedAt: string; closedAt: string | null;
  openingCashCents: number; closingCashCents: number | null;
  expectedCashCents: number | null; varianceCents: number | null;
  cashPayoutsCents: number; status: 'OPEN' | 'CLOSED'; note: string | null;
}

export interface DemoPurchaseReturn {
  id: string; number: string; purchaseId: string; supplierId: string; warehouseId: string;
  status: string; reason: string | null; totalCents: number; isActive: boolean;
  createdAt: string; updatedAt: string;
  purchase: { id: string; number: string };
  supplier: { id: string; name: string; phone: string | null };
  warehouse: { id: string; name: string; code: string };
  createdBy: { id: string; fullName: string };
  lines: Array<{
    id: string; purchaseLineId: string; productId: string; qty: number;
    unitCostCents: number; lineTotalCents: number;
    product: { id: string; name: string; sku: string };
    purchaseLine: { id: string; qty: number; receivedQty: number; returnedQty: number };
  }>;
}

export interface DemoPayment {
  id: string; saleId: string | null; purchaseId: string | null;
  amountCents: number; method: string; date: string; note: string | null; createdById: string; createdAt: string;
}

export interface DemoDb {
  version: number;
  seededAt: string;
  settings: Record<string, unknown>;
  users: DemoUser[];
  units: typeof UNITS;
  categories: { id: string; name: string; parentId: string | null }[];
  brands: typeof BRANDS;
  warehouses: { id: string; name: string; code: string; city: string | null; type: string; isDefault: boolean; isActive: boolean }[];
  products: CatProduct[];
  stock: DemoStock[];
  batches: DemoBatch[];
  suppliers: { id: string; name: string; phone: string; email: string; address: string; isActive: boolean; openingBalanceCents: number }[];
  customers: { id: string; name: string; phone: string; email: string | null; address: string | null; isActive: boolean; creditEnabled: boolean; creditLimitCents: number; creditAlertPct: number; creditSettleDays: number; openingBalanceCents: number }[];
  sales: DemoSale[];
  purchases: DemoPurchase[];
  movements: DemoMovement[];
  expenseCategories: typeof EXPENSE_CATEGORIES;
  expenses: DemoExpense[];
  shifts: DemoShift[];
  payments: DemoPayment[];
  posDrafts: unknown[];
  saleReturns: unknown[];
  purchaseReturns: DemoPurchaseReturn[];
  alertsRead: string[];
  alertsDismissed: string[];
}

// ─── Deterministic pseudo-random ─────────────────────────────────────────────
// A fixed seed means every visitor sees the same shop before they touch it, so
// a screenshot taken today matches what the client sees tomorrow.

function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Seed builder ────────────────────────────────────────────────────────────

const HISTORY_DAYS = 75;

export function buildSeed(): DemoDb {
  const rnd = mulberry32(20260904);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const between = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  const now = new Date();
  const year = now.getFullYear();

  /** A local instant `daysAgo` days back, at hh:mm on the shop's own clock. */
  const at = (daysAgo: number, hh: number, mm = 0): Date => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hh, mm, 0, 0);
    return d;
  };

  const users: DemoUser[] = DEMO_ACCOUNTS.map((a) => ({
    id: a.id, email: a.email, password: a.password, fullName: a.fullName,
    role: a.role, permissions: null, isActive: true,
    createdAt: at(HISTORY_DAYS + 10, 9).toISOString(), lastLoginAt: at(0, 8, 12).toISOString(),
  }));
  // A third account that exists only to make User Management look real.
  users.push({
    id: 'usr_demo_store', email: 'store@akeel-hardware.lk', password: 'Store@2026',
    fullName: 'Sunil Rathnayake', role: 'STAFF', permissions: null, isActive: true,
    createdAt: at(HISTORY_DAYS, 9).toISOString(), lastLoginAt: at(3, 16, 40).toISOString(),
  });

  const admin = users[0];
  const cashier = users[1];

  // ── Stock ──
  const stock: DemoStock[] = [];
  for (const p of PRODUCTS) {
    for (const wh of WAREHOUSES) {
      stock.push({ productId: p.id, warehouseId: wh.id, qty: p.stock[wh.id] ?? 0, shortfallQty: 0 });
    }
  }

  // ── Batches for batch-tracked products ──
  const batches: DemoBatch[] = [];
  let batchSeq = 1;
  for (const p of PRODUCTS) {
    if (!p.isBatchTracked) continue;
    for (const wh of WAREHOUSES) {
      const total = p.stock[wh.id] ?? 0;
      if (total <= 0) continue;
      // Two lots so the batch picker and FEFO have something to show.
      const firstQty = Math.max(1, Math.round(total * 0.4));
      const lots = [
        { qty: firstQty, months: (p.expiryMonths ?? 12) - 3, received: between(40, 70) },
        { qty: total - firstQty, months: p.expiryMonths ?? 12, received: between(5, 35) },
      ];
      for (const lot of lots) {
        if (lot.qty <= 0) continue;
        const exp = new Date(now.getFullYear(), now.getMonth() + lot.months, now.getDate(), 0, 0, 0, 0);
        batches.push({
          id: `bat_${batchSeq}`, productId: p.id, warehouseId: wh.id, qty: lot.qty,
          unitCostCents: p.costCents,
          batchNumber: `B${String(year).slice(2)}${String(batchSeq).padStart(4, '0')}`,
          expiryDate: exp.toISOString(),
          receivedAt: at(lot.received, 10, 30).toISOString(),
        });
        batchSeq++;
      }
    }
  }

  // ── Trading history ──
  const sales: DemoSale[] = [];
  const movements: DemoMovement[] = [];
  const payments: DemoPayment[] = [];
  let invSeq = 0;
  let movSeq = 0;
  let paySeq = 0;

  // Fast movers get picked far more often, so the top-products report is not flat.
  const weighted: string[] = [];
  for (const p of PRODUCTS) {
    const w = ['p_cem_opc', 'p_cem_mas', 'p_pnt_em4', 'p_plb_elb', 'p_ele_led', 'p_tls_nal', 'p_rof_asb'].includes(p.id)
      ? 6 : ['p_sand_rv', 'p_agg_met', 'p_ele_w25', 'p_tls_pdl'].includes(p.id) ? 1 : 3;
    for (let i = 0; i < w; i++) weighted.push(p.id);
  }
  const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
  const payMethods = ['CASH', 'CASH', 'CASH', 'CARD', 'BANK_TRANSFER', 'QR_PAY'];

  for (let d = HISTORY_DAYS; d >= 0; d--) {
    const dow = at(d, 12).getDay();
    if (dow === 0) continue;                       // closed Sundays
    const isToday = d === 0;
    // Saturdays are the busy day in a hardware shop.
    const base = dow === 6 ? between(11, 17) : between(6, 12);
    const count = isToday ? Math.max(3, Math.round(base * 0.6)) : base;

    for (let i = 0; i < count; i++) {
      // Today's sales have to fit between opening and the clock, or a demo
      // opened at 09:15 would carry an afternoon it has not had yet.
      //
      // Before opening time the window would be empty, and the dashboard would
      // greet a visitor with "Rs. 0, -100% on yesterday" — technically correct
      // (the shop is shut at 01:00) but it reads as a broken demo. So in the
      // small hours the window becomes the couple of hours behind now instead.
      let hour: number;
      let minute: number;
      if (isToday) {
        const h = now.getHours();
        const openFrom = h >= 9 ? 8 : Math.max(0, h - 2);
        hour = between(openFrom, Math.max(openFrom, h));
        minute = hour === h ? between(0, Math.max(0, now.getMinutes())) : between(0, 59);
      } else {
        hour = between(8, 17);
        minute = between(0, 59);
      }
      const when = at(d, hour, minute);
      if (isToday && when.getTime() > now.getTime()) continue;   // never from the future

      const lineCount = between(1, 4);
      const lines: DemoSaleLine[] = [];
      const used = new Set<string>();
      for (let l = 0; l < lineCount; l++) {
        const pid = pick(weighted);
        if (used.has(pid)) continue;
        used.add(pid);
        const p = byId.get(pid)!;
        const bulky = ['p_sand_rv', 'p_agg_met', 'p_ele_w25', 'p_ele_w15'].includes(pid);
        const qty = bulky ? between(1, 2) : p.priceCents > 300000 ? between(1, 6) : between(1, 24);
        const lineTotal = qty * p.priceCents;
        lines.push({
          id: `sl_${invSeq}_${l}`, productId: pid, qty, unitPriceCents: p.priceCents,
          taxPercent: 0, discountCents: 0, lineTotalCents: lineTotal, unitId: p.unitId,
        });
      }
      if (!lines.length) continue;

      const subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
      // Occasional round-number discount, the way a counter actually gives one.
      const discount = rnd() < 0.18 ? Math.min(subtotal, between(1, 8) * 10000) : 0;
      const total = subtotal - discount;

      const isPos = rnd() < 0.72;
      const hasCustomer = !isPos || rnd() < 0.45;
      const customer = hasCustomer ? pick(CUSTOMERS) : null;
      const creditOk = !!customer?.creditEnabled;
      // Credit only where the customer is set up for it.
      const onCredit = creditOk && rnd() < 0.3;
      const method = onCredit ? 'CREDIT' : pick(payMethods);
      // Some credit invoices are part-paid — that is what makes ageing interesting.
      const paid = onCredit ? (rnd() < 0.4 ? Math.round(total * (0.2 + rnd() * 0.5) / 10000) * 10000 : 0) : total;

      invSeq++;
      const id = `sal_${invSeq}`;
      const saleDate = when.toISOString();
      sales.push({
        id,
        number: `INV-${year}-${String(invSeq).padStart(4, '0')}`,
        isPos, status: 'CONFIRMED', date: saleDate,
        customerId: customer?.id ?? null,
        warehouseId: 'wh_main',
        subtotalCents: subtotal, taxCents: 0, discountCents: discount, totalCents: total,
        paidCents: paid, paymentMethod: method, note: null,
        createdById: isPos ? cashier.id : admin.id,
        lines, createdAt: saleDate,
      });

      for (const l of lines) {
        movSeq++;
        movements.push({
          id: `mov_${movSeq}`, productId: l.productId, warehouseId: 'wh_main',
          type: 'SALE_OUT', qty: -l.qty, refType: 'SALE', refId: id,
          note: null, createdAt: saleDate,
        });
      }
      if (paid > 0) {
        paySeq++;
        payments.push({
          id: `pay_${paySeq}`, saleId: id, purchaseId: null, amountCents: paid,
          method, date: saleDate, note: null, createdById: isPos ? cashier.id : admin.id, createdAt: saleDate,
        });
      }
    }
  }

  // ── Purchase orders ──
  const purchases: DemoPurchase[] = [];
  let poSeq = 0;
  const poDays = [68, 61, 54, 47, 40, 33, 26, 19, 12, 6, 2];
  for (const d of poDays) {
    poSeq++;
    const supplier = SUPPLIERS[(poSeq - 1) % SUPPLIERS.length];
    const supplierProducts = PRODUCTS.filter((p) =>
      (supplier.id === 'sup_lanka'  && (p.categoryId === 'cat_cement' || p.categoryId === 'cat_roofing')) ||
      (supplier.id === 'sup_nova'   && p.categoryId === 'cat_paint') ||
      (supplier.id === 'sup_hilt'   && p.categoryId === 'cat_plumbing') ||
      (supplier.id === 'sup_kandy'  && (p.categoryId === 'cat_electric' || p.categoryId === 'cat_tools')) ||
      (supplier.id === 'sup_upcty'));
    const chosen = (supplierProducts.length ? supplierProducts : PRODUCTS).slice(0, between(2, 5));
    // The two most recent stay open, so the Purchases page has live work on it.
    const isOpen = d <= 6;
    const lines: DemoPurchaseLine[] = chosen.map((p, idx) => {
      const qty = Math.max(4, Math.round(p.reorderQty * (0.4 + rnd() * 0.6)));
      return {
        id: `pl_${poSeq}_${idx}`, productId: p.id, qty,
        // An open order has received NOTHING yet. Seeding receivedQty = qty on
        // a PENDING order left it with nothing outstanding, so its Receive
        // Stock panel had no quantity to take in — the order looked delivered
        // and un-receivable at the same time.
        receivedQty: isOpen ? 0 : qty,
        unitCostCents: p.costCents, taxPercent: 0, lineTotalCents: qty * p.costCents, unitId: p.unitId,
      };
    });
    const subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
    const when = at(d, between(9, 15), between(0, 59));
    const iso = when.toISOString();
    const id = `pur_${poSeq}`;
    purchases.push({
      id, number: `PO-${year}-${String(poSeq).padStart(4, '0')}`,
      supplierId: supplier.id, warehouseId: d % 2 === 0 ? 'wh_main' : 'wh_yard',
      status: isOpen ? 'DRAFT' : 'CONFIRMED',
      deliveryStatus: isOpen ? 'PENDING' : 'COMPLETE',
      date: iso, expectedDate: at(d - 7, 9).toISOString(), note: null,
      subtotalCents: subtotal, taxCents: 0, totalCents: subtotal,
      paidCents: isOpen ? 0 : rnd() < 0.75 ? subtotal : Math.round(subtotal * 0.5 / 10000) * 10000,
      createdById: admin.id, lines, createdAt: iso,
    });
    if (!isOpen) {
      for (const l of lines) {
        movSeq++;
        movements.push({
          id: `mov_${movSeq}`, productId: l.productId, warehouseId: purchases[purchases.length - 1].warehouseId,
          type: 'PURCHASE_IN', qty: l.qty, refType: 'PURCHASE', refId: id, note: null, createdAt: iso,
        });
      }
    }
  }

  // ── Expenses ──
  const expenses: DemoExpense[] = [];
  let expSeq = 0;
  const addExpense = (daysAgo: number, categoryId: string, amountCents: number, description: string) => {
    expSeq++;
    const iso = at(daysAgo, 10, 15).toISOString();
    expenses.push({
      id: `exp_${expSeq}`, categoryId, amountCents, date: iso, description,
      reference: null, paymentMethod: 'CASH', createdById: admin.id, createdAt: iso,
    });
  };
  for (let m = 0; m < 3; m++) {
    const d = m * 30 + 3;
    addExpense(d, 'exc_rent',  6500000, 'Monthly shop rent');
    addExpense(d + 1, 'exc_wages', 12800000, 'Staff wages');
    addExpense(d + 2, 'exc_util',  2340000, 'Electricity bill');
  }
  addExpense(2,  'exc_trans', 850000,  'Lorry hire — cement delivery');
  addExpense(6,  'exc_trans', 620000,  'Fuel — three-wheeler deliveries');
  addExpense(11, 'exc_misc',  185000,  'Stationery and bill books');
  addExpense(17, 'exc_trans', 940000,  'Lorry hire — roofing sheets');
  addExpense(23, 'exc_misc',  420000,  'Shop maintenance — shelving');

  // ── Shifts ──
  const shifts: DemoShift[] = [];
  for (let d = 6; d >= 1; d--) {
    const opened = at(d, 8, 15);
    const closed = at(d, 18, 30);
    const opening = 2000000;
    const takings = between(18, 55) * 100000;
    shifts.push({
      id: `shf_${d}`, userId: cashier.id, warehouseId: 'wh_main',
      openedAt: opened.toISOString(), closedAt: closed.toISOString(),
      openingCashCents: opening, closingCashCents: opening + takings,
      expectedCashCents: opening + takings, varianceCents: 0,
      cashPayoutsCents: 0, status: 'CLOSED', note: null,
    });
  }
  // Today's shift is left OPEN so the POS opens straight into a live till.
  shifts.push({
    id: 'shf_open', userId: cashier.id, warehouseId: 'wh_main',
    openedAt: at(0, 8, 5).toISOString(), closedAt: null,
    openingCashCents: 2000000, closingCashCents: null,
    expectedCashCents: null, varianceCents: null,
    cashPayoutsCents: 0, status: 'OPEN', note: null,
  });

  return {
    version: DEMO_DB_VERSION,
    seededAt: new Date().toISOString(),
    settings: buildSettings(),
    users,
    units: UNITS,
    categories: CATEGORIES.map((c) => ({ ...c, parentId: null })),
    brands: BRANDS,
    warehouses: WAREHOUSES.map((w) => ({ ...w, isActive: true })),
    products: PRODUCTS,
    stock,
    batches,
    suppliers: SUPPLIERS.map((s) => ({ ...s, isActive: true, openingBalanceCents: 0 })),
    customers: CUSTOMERS.map((c) => ({
      ...c, email: null, address: null, isActive: true,
      creditAlertPct: 80, creditSettleDays: 30, openingBalanceCents: 0,
    })),
    sales, purchases, movements,
    expenseCategories: EXPENSE_CATEGORIES,
    expenses, shifts, payments,
    posDrafts: [], saleReturns: [], purchaseReturns: [],
    alertsRead: [], alertsDismissed: [],
  };
}

function buildSettings(): Record<string, unknown> {
  return {
    id: 'singleton',
    businessName: 'Akeel Hardware & Building Supplies',
    businessRegNo: 'DEMO/PV/00000',
    businessAddress: 'No. 42, Kandy Road, Gampola',
    businessPhone: '081 234 5678',
    businessEmail: 'hello@akeel-hardware.lk',
    logoUrl: null,
    currencySymbol: 'Rs.', currencyCode: 'LKR', currencyPosition: 'before',
    dateFormat: 'dd/MM/yyyy', timezone: 'Asia/Colombo',
    defaultTaxPercent: 0, taxLabel: 'VAT', taxNumber: null, taxEnabled: false, taxInclusive: false,
    posRequireShift: false, posAllowDiscount: true, posApplyDefaultDiscount: false,
    posMaxDiscountPct: 20, posPrintReceipt: true,
    posReceiptFooter: 'Thank you for your custom — goods once sold are not returnable without a bill.',
    posDefaultWarehouseId: 'wh_main',
    invoicePrefix: 'INV', invoiceStartNo: 1, invoiceDueDays: 30, purchasePrefix: 'PO',
    invoiceFooter: null, invoiceShowLogo: true, documentTheme: 'light',
    sessionTimeoutMin: 480,
    alertLowStockEnabled: true, alertExpiryEnabled: true, alertExpiryDays: 60,
    alertLowStockEmail: null, alertShowInDashboard: true, alertBellEnabled: true,
    blockExpiredSales: true, expiredStockPolicy: 'WARN', allowNegativeStock: false,
    staffSalesEnabled: false,
    receiptLanguage: 'en', receiptTagline: 'Building supplies since 1998',
    receiptShowLogo: true, receiptShowTax: false, receiptShowSku: true,
    receiptPaperWidth: '80mm', receiptShowBarcode: false, receiptShowCashier: true,
    receiptQrEnabled: false, receiptHeaderLine1: null, receiptHeaderLine2: null,
    returnPolicy: 'Returns accepted within 7 days with the original bill.',
    whatsappEnabled: false, whatsappPhone: null,
    waReceiptTemplate: null, waOutstandingTemplate: null, waPayableTemplate: null, waOfferTemplate: null,
    whatsappOpenMode: 'browser',
    // Optional modules the demo deliberately does NOT carry. Turning them off
    // hides their nav entries rather than leaving dead links in a client demo.
    moduleFlags: {
      promotions: false, stockTake: false, loyalty: false, quotations: false,
      userManagement: true, whatsapp: false, dataManagement: false,
      auditLog: false, productExport: false,
    },
  };
}

// ─── Persistence ─────────────────────────────────────────────────────────────

let db: DemoDb | null = null;

/**
 * Load from localStorage, or seed fresh.
 *
 * Re-seeds on two conditions:
 *
 *  - the stored shape predates the current DEMO_DB_VERSION, and
 *  - the stored copy was seeded on an earlier LOCAL calendar day.
 *
 * The second is what keeps the demo alive. All history is generated relative to
 * the day it was seeded, so a copy left in a browser overnight has no sales
 * "today" — a prospective client opening the link a week later would land on a
 * dashboard reading Rs. 0 and -100%. Re-seeding on a new day costs that visitor
 * the changes they made yesterday, which is a fair trade for never showing a
 * dead shop. Mid-session nothing is touched: the check is by day, not by age.
 */
export function getDb(): DemoDb {
  if (db) return db;
  try {
    const raw = localStorage.getItem(DEMO_DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoDb;
      const sameDay = parsed?.seededAt && toLocalYMD(new Date(parsed.seededAt)) === toLocalYMD(new Date());
      if (parsed?.version === DEMO_DB_VERSION && sameDay) {
        db = parsed;
        return db;
      }
    }
  } catch {
    // Corrupt or unavailable storage falls through to a fresh seed.
  }
  db = buildSeed();
  persist();
  return db;
}

/** Write the current state back to localStorage. Safe to call on every mutation. */
export function persist(): void {
  if (!db) return;
  try {
    localStorage.setItem(DEMO_DB_KEY, JSON.stringify(db));
  } catch {
    // Private-mode or quota errors must not break the demo; state stays in memory.
  }
}

/** Throw the visitor's changes away and rebuild the shop as it ships. */
export function resetDb(): void {
  db = buildSeed();
  persist();
}

export function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/**
 * Next document number, derived from max+1 over existing numbers — never a row
 * count. Mirrors utils/doc-number.ts on the backend (CLAUDE.md sprint 21), so a
 * deleted document cannot cause the demo to reissue a number.
 */
export function nextDocNumber(prefix: string, existing: string[]): string {
  const year = new Date().getFullYear();
  const head = `${prefix}-${year}-`;
  const max = existing
    .filter((n) => n.startsWith(head))
    .reduce((m, n) => Math.max(m, parseInt(n.slice(head.length), 10) || 0), 0);
  return `${head}${String(max + 1).padStart(4, '0')}`;
}

/** Today's local calendar day, for the demo's own day filters. */
export function todayYMD(): string {
  return toLocalYMD(new Date());
}
