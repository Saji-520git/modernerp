import {
  useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingCart, Search, Trash2, X, Clock,
  CheckCircle, LogOut, Printer, Save, Mail,
  User, CreditCard, Banknote, Building2, Layers,
  ChevronRight, FolderOpen, UserPlus, ChevronDown, QrCode,
  RotateCcw, Tag, Lock,
} from 'lucide-react';
import {
  posApi, formatCents, daysUntilExpiry,
  type PosProduct, type Receipt, type AllPaymentMethods, type ProductBatch,
} from '../../services/pos';
import DiscountInput, { type DiscountInputHandle } from '../../components/pos/DiscountInput';
import BatchPickerModal from '../../components/common/BatchPickerModal';
import { categoriesApi, brandsApi, type Category, type Brand } from '../../services/masterData';
import NewReturnModal from '../../components/returns/NewReturnModal';
import { shiftsApi } from '../../services/shifts';
import { useAppSettings } from '../../context/SettingsContext';
import {
  fillTemplate, openWhatsApp, buildItemsList,
  DEFAULT_RECEIPT_TEMPLATE,
} from '../../utils/whatsapp';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { usePosStore } from '../../store/posStore';
import { useModule } from '../../hooks/useModule';
import { loyaltyApi } from '../../services/loyalty';
import { isManagerOrAbove } from '../../utils/roles';
import OpenShiftModal from '../../components/pos/OpenShiftModal';
import CloseShiftModal from '../../components/pos/CloseShiftModal';
import ThermalReceipt from '../../components/pos/ThermalReceipt';
import QuickAddModal from '../../components/pos/QuickAddModal';
import { productsApi, type Product } from '../../services/products';
import axios from 'axios';
import { generateReceiptHtml } from '../../utils/generateReceiptHtml';
import { fmtQty, formatStockDisplay } from '../../utils/format';

// ─── Audio engine ─────────────────────────────────────────────────────────────
import { sound } from '../../lib/sound';

// ─── Shortcut map ─────────────────────────────────────────────────────────────

const POS_SHORTCUTS = [
  { group: 'SALES',      key: 'F2',           action: 'Focus barcode / scanner' },
  { group: 'SALES',      key: 'F4',           action: 'Hold current cart' },
  { group: 'SALES',      key: 'F5',           action: 'Cancel current sale' },
  { group: 'SALES',      key: 'F8',           action: 'Pay now' },
  { group: 'SALES',      key: 'Esc',          action: 'Close any open modal' },
  { group: 'CART',       key: '+',            action: 'Add 1 to last item qty' },
  { group: 'CART',       key: '-',            action: 'Remove 1 from last item qty' },
  { group: 'CART',       key: 'Del',          action: 'Remove last item from cart' },
  { group: 'DRAFTS',     key: 'L',            action: 'Open drafts list' },
  { group: 'SHIFT',      key: 'Ctrl+Shift+O', action: 'Open shift (if none active)' },
  { group: 'SHIFT',      key: 'Ctrl+Shift+X', action: 'Close shift' },
  { group: 'HELP',       key: 'F1',           action: 'Toggle shortcuts panel' },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

// Cart line model and the rules that decide what is charged live in
// ./cartLines — pure functions, unit-tested next to that file.
import { type CartItem, lineKeyOf, syncServiceCharges, serviceChargePerUnitFor } from './cartLines';

interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
  creditEnabled?: boolean;
}

interface HoldBill {
  id:                 string;
  label:              string;
  cart:               CartItem[];
  cartDiscountType:   'percent' | 'amount';
  cartDiscountValue:  number;
  customer:           CustomerOption | null;
  savedAt:            string;  // ISO
}

type PayTab = 'CASH' | 'CARD' | 'BANK' | 'QR_PAY' | 'SPLIT' | 'CREDIT';

// ─── Utilities ────────────────────────────────────────────────────────────────

function cls(...a: (string | false | null | undefined)[]) { return a.filter(Boolean).join(' '); }

function useLiveClock(): string {
  const fmt = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const [t, setT] = useState(fmt);
  useEffect(() => { const id = setInterval(() => setT(fmt()), 1_000); return () => clearInterval(id); }, []);
  return t;
}

function totalStock(p: PosProduct): number {
  return p.stock.reduce((s, r) => s + Number(r.qty), 0);
}

/**
 * Build the list of sellable unit options for a product: the base unit plus
 * any conversion whose toUnit IS the base unit (directly sellable to base).
 * Price = explicit conversion override if set, else basePrice × conversion factor.
 * If the product has no conversions, only the base unit option is returned.
 */
interface UnitOption {
  unitId:        string;
  label:         string;
  priceCents:    number;
  isBase:        boolean;
  discountType:  string | null;
  discountValue: number | null;
}
function getUnitOptions(product: PosProduct): UnitOption[] {
  const baseUnitId = product.baseUnitId ?? product.unitId;
  const baseUnit   = product.baseUnit ?? product.unit;
  const basePrice  = product.priceCents;

  const options: UnitOption[] = [{
    unitId:        baseUnitId,
    label:         baseUnit?.shortCode ?? baseUnit?.name ?? 'unit',
    priceCents:    basePrice,
    isBase:        true,
    discountType:  null,   // base unit has no conversion row → product default applies
    discountValue: null,
  }];

  for (const conv of (product.unitConversions ?? [])) {
    // Only units that convert directly TO the base unit are sellable
    if (conv.toUnitId !== baseUnitId) continue;

    const factor = Number(conv.conversionQty);
    const unitPrice = conv.priceCents != null
      ? conv.priceCents
      : Math.round(basePrice * factor);

    options.push({
      unitId:        conv.fromUnitId,
      label:         conv.fromUnit?.shortCode ?? conv.fromUnit?.name ?? 'unit',
      priceCents:    unitPrice,
      isBase:        false,
      discountType:  conv.discountType ?? null,
      discountValue: conv.discountValue ?? null,
    });
  }

  return options;
}

/**
 * Seed a cart line's discount from a unit option: per-unit override if the unit
 * defines one, else fall back to the product-level defaultDiscountCents (amount,
 * in cents). Single source of truth for both add and changeCartUnit.
 * Value-unit asymmetry: unit amount is stored in CENTS (÷100 → rupees);
 * unit percent is 0–100 (use as-is). itemDiscountValue convention: rupees for
 * amount, 0–100 for percent.
 */
function discountSeedFromOption(
  opt: UnitOption,
  product: PosProduct,
  applyDefaults: boolean,
): { itemDiscountType: 'amount' | 'percent'; itemDiscountValue: number } {
  // Global "apply preset/default discounts" off → seed every line at zero;
  // the cashier can still key a manual discount when posAllowDiscount is on.
  if (!applyDefaults) return { itemDiscountType: 'amount', itemDiscountValue: 0 };
  if (opt.discountType && opt.discountValue != null && opt.discountValue > 0) {
    const type  = opt.discountType as 'amount' | 'percent';
    const value = type === 'amount' ? opt.discountValue / 100 : opt.discountValue;
    return { itemDiscountType: type, itemDiscountValue: value };
  }
  const defCents = Math.min(product.defaultDiscountCents ?? 0, product.priceCents);
  return { itemDiscountType: 'amount', itemDiscountValue: defCents > 0 ? defCents / 100 : 0 };
}

/**
 * v1.0.61 — How many BASE units one of `unitId` represents for this product.
 * Base unit (or undefined unitId) → 1. A selected sales unit returns the
 * conversionQty of the conversion that maps it directly to the base unit.
 * Mirrors getUnitOptions' "toUnitId === baseUnitId" sellable-unit rule.
 */
function getBaseFactor(product: PosProduct, unitId: string | undefined): number {
  const baseUnitId = product.baseUnitId ?? product.unitId;
  if (!unitId || unitId === baseUnitId) return 1;
  const conv = (product.unitConversions ?? []).find(
    c => c.fromUnitId === unitId && c.toUnitId === baseUnitId,
  );
  return conv ? Number(conv.conversionQty) : 1;
}

/** v1.0.61 — Base-unit quantity a cart line consumes from stock. */
function lineBaseQty(item: CartItem): number {
  return item.qty * getBaseFactor(item.product, item.unitId);
}

/**
 * Does the line's SELECTED unit allow decimal quantities? Resolves allowDecimal
 * for whichever unit `unitId` points to — base unit (or undefined → base) reads
 * the base unit object; a conversion unit (e.g. Box) reads its fromUnit. COUNT
 * units (Piece, Box) are false → whole numbers only. Mirrors getBaseFactor's
 * base-vs-conversion lookup. Defaults to false (safer: whole numbers) if the
 * unit object is missing.
 */
function getUnitAllowDecimal(product: PosProduct, unitId: string | undefined): boolean {
  const baseUnitId = product.baseUnitId ?? product.unitId;
  if (!unitId || unitId === baseUnitId) {
    const baseUnit = product.baseUnit ?? product.unit;
    return baseUnit?.allowDecimal ?? false;
  }
  const conv = (product.unitConversions ?? []).find(
    c => c.fromUnitId === unitId && c.toUnitId === baseUnitId,
  );
  return conv?.fromUnit?.allowDecimal ?? false;
}

const HOLDS_KEY = 'pos_holds_v2';

// v1.0.72 — pointer to the last COMPLETED sale, persisted so the cashier can
// re-open/reprint it even after a page reload (missing-receipt escape hatch).
const LAST_RECEIPT_KEY = 'pos_last_receipt_v1';
interface LastSaleInfo { id: string; number: string; changeCents: number }
function loadLastSaleInfo(): LastSaleInfo | null {
  try {
    const raw = localStorage.getItem(LAST_RECEIPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastSaleInfo;
    return parsed && typeof parsed.id === 'string' ? parsed : null;
  } catch { return null; }
}
// v1.0.71 — context-independent ID. crypto.randomUUID is undefined in the
// packaged Electron build (file:// is a non-secure context), so it must not
// be used here. This helper works in any context.
const newHoldId = () => `hold_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
function loadHolds(): HoldBill[] {
  try { return JSON.parse(localStorage.getItem(HOLDS_KEY) ?? '[]') as HoldBill[]; }
  catch { return []; }
}
function saveHoldsToStorage(holds: HoldBill[]) {
  try { localStorage.setItem(HOLDS_KEY, JSON.stringify(holds)); } catch { /* ignore */ }
}

// ─── ProductCard ──────────────────────────────────────────────────────────────

function ProductCard({ product, onAdd, isSelected = false }: { product: PosProduct; onAdd: () => void; isSelected?: boolean }) {
  const { settings } = useAppSettings();
  const policy = (settings?.expiredStockPolicy ?? 'BLOCK') as 'BLOCK' | 'WARN' | 'ALLOW';

  const bs = product.batchSummary;

  // Use batch sellableQty if available, otherwise total stock
  const totalQty    = totalStock(product);
  const sellableQty = bs ? bs.sellableQty : totalQty;
  const expiredQty  = bs ? bs.expiredQty  : 0;
  const status      = bs ? bs.expiryStatus : 'none';

  // Whether ALL available stock is expired (and there is some)
  const allExpired  = status !== 'none' && sellableQty <= 0 && expiredQty > 0;

  // Effective display qty:
  //   BLOCK / no expired: show sellableQty (normal)
  //   WARN / ALLOW + allExpired: show totalQty so cashier sees stock exists
  const displayQty  = allExpired && policy !== 'BLOCK' ? totalQty : sellableQty;

  // Card disabled: only when BLOCK and out-of-sellable or genuinely zero stock
  const trueOut     = policy === 'BLOCK' ? (sellableQty <= 0) : (totalQty <= 0);
  const isLow       = !trueOut && displayQty < 10;
  const isDisabled  = trueOut;

  // Badge colour
  const badgeBg    = trueOut     ? '#FCEBEB'
                   : allExpired  ? '#FEF3C7'   // amber for WARN/ALLOW expired
                   : isLow       ? '#FAEEDA'
                   :               '#EAF3DE';
  const badgeColor = trueOut     ? '#A32D2D'
                   : allExpired  ? '#92400E'
                   : isLow       ? '#854F0B'
                   :               '#3B6D11';

  // Expiring-soon: nearest expiry for top-right badge
  const nearestExpiry  = bs?.nearestExpiry ? new Date(bs.nearestExpiry) : null;
  const expDaysNearest = nearestExpiry
    ? Math.ceil((nearestExpiry.getTime() - Date.now()) / 86_400_000)
    : null;

  // WARN mode confirmation state
  const [showConfirm, setShowConfirm] = useState(false);

  function handleClick() {
    if (isDisabled) return;
    if (allExpired && policy === 'WARN') {
      setShowConfirm(true);
      return;
    }
    sound.beep();
    onAdd();
  }

  return (
    <>
      <button
        type="button"
        disabled={isDisabled}
        onClick={handleClick}
        className={cls(
          'relative flex flex-col rounded-xl border text-left transition-all active:scale-95 bg-white hover:border-indigo-400 hover:shadow-md',
          isSelected
            ? 'border-indigo-500 ring-2 ring-indigo-400 shadow-md'
            : 'border-slate-200',
        )}
        style={{
          padding: '16px 16px 12px',
          minHeight: 120,
          opacity: isDisabled ? 0.4 : 1,
          cursor:  isDisabled ? 'not-allowed' : 'pointer',
        }}
      >
        {/* Top-right badge: all-expired (BLOCK shows EXP, WARN/ALLOW show orange Exp) */}
        {allExpired && policy === 'BLOCK' && (
          <span style={{ position: 'absolute', top: 5, right: 5, fontSize: 9, fontWeight: 700,
            background: '#FCEBEB', color: '#A32D2D', padding: '1px 5px', borderRadius: 3 }}>
            EXP
          </span>
        )}
        {allExpired && policy !== 'BLOCK' && (
          <span style={{ position: 'absolute', top: 5, right: 5, fontSize: 9, fontWeight: 700,
            background: '#FEF3C7', color: '#92400E', padding: '1px 5px', borderRadius: 3 }}>
            Expired
          </span>
        )}
        {!allExpired && status === 'expiring' && expDaysNearest !== null && expDaysNearest > 0 && (
          <span style={{ position: 'absolute', top: 5, right: 5, fontSize: 8, fontWeight: 700,
            background: '#fbbf24', color: '#fff', padding: '1px 5px', borderRadius: 10 }}>
            {expDaysNearest}d
          </span>
        )}

        {/* Row 1: avatar */}
        <div className="w-full bg-gradient-to-br from-indigo-50 to-indigo-100 flex items-center justify-center mb-1.5 overflow-hidden"
          style={{ height: 48, borderRadius: 6 }}>
          {product.imageUrl
            ? <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
            : <span className="text-lg font-bold text-indigo-300 select-none">{product.name.charAt(0)}</span>}
        </div>

        {/* Row 2: product name */}
        <p style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          color: '#1e293b', marginBottom: 3 }}>
          {product.name}
        </p>

        {/* Row 3: price + stock badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#2563eb' }}>
            {formatCents(product.priceCents)}
          </span>
          <span style={{ fontSize: 9, fontWeight: 500, padding: '2px 6px', borderRadius: 4,
            background: badgeBg, color: badgeColor, flexShrink: 0, whiteSpace: 'nowrap' }}>
            {trueOut ? 'OUT' : formatStockDisplay(product, displayQty)}
          </span>
        </div>

        {/* Row 4: expired batch warning when some sellable + some expired */}
        {status === 'has_expired_batch' && expiredQty > 0 && sellableQty > 0 && (
          <div style={{ fontSize: 9, color: '#A32D2D', fontWeight: 600, marginTop: 2 }}>
            ⚠ {expiredQty} expired
          </div>
        )}
      </button>

      {/* WARN confirmation dialog */}
      {showConfirm && (
        <div
          className="fixed inset-0 bg-black/40 z-[200] flex items-center justify-center p-4"
          onClick={() => setShowConfirm(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="font-bold text-slate-800 text-sm">Expired Product</p>
                <p className="text-xs text-slate-500 mt-1">
                  <strong>{product.name}</strong> has expired batches. Sell anyway?
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="flex-1 px-3 py-2 rounded-lg bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600"
                onClick={() => { setShowConfirm(false); sound.beep(); onAdd(); }}
              >
                Sell Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── CartLine ─────────────────────────────────────────────────────────────────

interface CartLineHandle {
  focusQty:      () => void;
  focusDiscount: () => void;
}

// Shared column template for the cart table — applied to BOTH the sticky header
// row and every CartLine so columns align.
// Product | Unit | Unit Price | Qty | Disc Type | Disc Total | Total | trash
// Columns are gap-less: vertical dividers are drawn per-cell (borderRight) so the
// header and every row share continuous column rules.
const CART_GRID       = 'minmax(0,1fr) 66px 80px 64px 128px 74px 90px 30px';
const CART_COL_BORDER = '1px solid #eef2f7';                 // divider between body columns
const CART_HDR_BORDER = '1px solid rgba(148,163,184,0.22)';  // divider on the dark header

const CartLine = forwardRef<CartLineHandle, {
  item: CartItem;
  onChange: (qty: number) => void;
  onRemove: () => void;
  onBatchCap?: (msg: string) => void;
  onUpdateDiscount: (type: 'percent' | 'amount', value: number) => void;
  onNavigateToBarcode: () => void;
  onChangeUnit: (unitId: string) => void;
}>(function CartLine({
  item, onChange, onRemove, onBatchCap, onUpdateDiscount, onNavigateToBarcode, onChangeUnit,
}, cartLineRef) {
  const { settings: cartSettings } = useAppSettings();
  const cartPolicy = (cartSettings?.expiredStockPolicy ?? 'BLOCK') as 'BLOCK' | 'WARN' | 'ALLOW';
  // Manual discounts off → the per-line discount cell is read-only (presets still show).
  const discountLocked = cartSettings?.posAllowDiscount === false;

  const [editing, setEditing]       = useState(false);
  const [draft, setDraft]           = useState('');
  const [cappedAt, setCappedAt]     = useState<number | null>(null);
  // Show discount row only when there's an active discount or it's being edited
  const [showDiscount, setShowDiscount] = useState(() => item.itemDiscountCents > 0);
  const inputRef                    = useRef<HTMLInputElement>(null);
  const discountRef                 = useRef<DiscountInputHandle>(null);
  const stock                   = totalStock(item.product);
  const lineSubtotal            = item.qty * item.unitPriceCents;
  const lineAfterDisc           = lineSubtotal - item.itemDiscountCents;
  const lineTotal               = lineAfterDisc;
  // Sellable unit options — dropdown only shows when more than one exists
  const unitOpts                = item.isServiceCharge ? [] : getUnitOptions(item.product);
  // Does the line's SELECTED unit allow decimal qty? COUNT units → whole only.
  const unitAllowDecimal        = getUnitAllowDecimal(item.product, item.unitId);
  // Base units per one of the line's selected unit — batch stock is held in base
  // units, the typed qty is in the selected unit, so caps convert through this.
  const baseFactorForLine       = getBaseFactor(item.product, item.unitId);

  useImperativeHandle(cartLineRef, () => ({
    focusQty:      () => startEdit(),
    // 150ms delay: must fire after refocusBarcode's 100ms timeout
    focusDiscount: () => {
      if (item.isServiceCharge) return; // service charge items have no discount
      setShowDiscount(true);
      setTimeout(() => { discountRef.current?.focus(); discountRef.current?.select(); }, 150);
    },
  }));

  const startEdit = () => {
    setCappedAt(null);
    setDraft(String(item.qty));
    setEditing(true);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
  };

  const commitEdit = () => {
    const raw = parseFloat(draft);
    let qty   = isNaN(raw) || raw <= 0 ? 1 : raw;

    // Whole-number enforcement: COUNT units (allowDecimal=false) cannot be sold
    // in fractions. Round to nearest whole, min 1. Done BEFORE caps so the
    // rounded value is what gets capped against stock.
    if (!unitAllowDecimal) {
      qty = Math.max(1, Math.round(qty));
    }

    // A line bound to one batch is limited by that batch, not by the product's
    // total stock — typing 3 against a 1-unit batch must be refused here, at the
    // keyboard, not later when payment is rejected.
    const lineBatchQty = item.batchId && item.batchQty !== undefined ? item.batchQty : null;
    if (lineBatchQty !== null) {
      const maxFromBatch = Math.floor(lineBatchQty / baseFactorForLine);
      if (qty > maxFromBatch) {
        qty = maxFromBatch;
        onBatchCap?.(
          maxFromBatch > 0
            ? `Only ${maxFromBatch} left in this batch — add the rest from another batch`
            : 'This batch is finished — pick another batch',
        );
      }
      setCappedAt(null);
      if (qty <= 0) { setEditing(false); return; }
      onChange(qty);
      setEditing(false);
      return;
    }

    // Batch-aware cap: respect expiredStockPolicy
    const bs = item.product.batchSummary;
    if (bs && bs.expiryStatus !== 'none') {
      // Effective cap: for BLOCK → sellableQty; for WARN/ALLOW → totalStock (includes expired)
      const effectiveCap = cartPolicy === 'BLOCK' ? bs.sellableQty : stock;
      if (qty > effectiveCap) {
        qty = effectiveCap;
        onBatchCap?.(
          effectiveCap === 0
            ? 'No stock available'
            : `Only ${effectiveCap} available`,
        );
        setCappedAt(null);
      } else {
        setCappedAt(null);
      }
    } else if (stock > 0 && qty > stock) {
      // Fallback: cap at total physical stock for non-batch products
      qty = stock;
      setCappedAt(stock);
    } else {
      setCappedAt(null);
    }

    onChange(qty);
    setEditing(false);
  };

  const qtyBoxStyle: React.CSSProperties = {
    background: '#f8fafc', border: '1px solid #e2e8f0',
    borderRadius: 7, padding: '3px 4px',
    fontSize: 13, fontWeight: 700,
    width: '100%', textAlign: 'center', color: '#1e1b4b',
    boxSizing: 'border-box',
  };

  return (
    <div className="group" style={{ background: '#fff', borderBottom: CART_COL_BORDER }}>
      {/* Single flush table row with per-cell vertical dividers — columns match the
          dark CART_GRID header: Product | Unit | Price | Qty | Disc | Disc Tot | Total | trash */}
      <div
        className="transition-colors group-hover:bg-slate-50/70"
        style={{
          display: 'grid',
          gridTemplateColumns: CART_GRID,
          columnGap: 0,
          alignItems: 'stretch',
        }}
      >
        {/* 1 — Product name (service charge gets amber styling) */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 10px', borderRight: CART_COL_BORDER, minWidth: 0 }}>
          <span className={`text-sm font-semibold truncate ${item.isServiceCharge ? 'text-amber-700' : 'text-slate-800'}`}>
            {item.isServiceCharge && <span style={{ fontSize: 9, marginRight: 4, background: '#fef3c7', color: '#b45309', padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>SVC</span>}
            {item.product.name}
          </span>
        </div>

        {/* 2 — Unit: selector when >1 sellable unit, else static short code (never blank) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 6px', borderRight: CART_COL_BORDER, minWidth: 0 }}>
          {unitOpts.length > 1 ? (
            <select
              value={item.unitId}
              onChange={e => onChangeUnit(e.target.value)}
              className="text-xs border rounded px-1 py-0.5 bg-white"
              style={{ color: '#475569', borderColor: '#cbd5e1', width: '100%', boxSizing: 'border-box' }}
            >
              {unitOpts.map(opt => (
                <option key={opt.unitId} value={opt.unitId}>{opt.label}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', background: '#f1f5f9', borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {unitOpts[0]?.label ?? ''}
            </span>
          )}
        </div>

        {/* 3 — Unit price */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '4px 10px', borderRight: CART_COL_BORDER }}>
          <span style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {formatCents(item.unitPriceCents)}
          </span>
        </div>

        {/* 4 — Editable qty box (service charge shows fixed non-editable qty) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px', borderRight: CART_COL_BORDER }}>
          {item.isServiceCharge ? (
            <span style={{ ...qtyBoxStyle, cursor: 'default', opacity: 0.6 }}>1</span>
          ) : editing ? (
            <input
              ref={inputRef}
              type="number"
              min={unitAllowDecimal ? '0.001' : '1'}
              step={unitAllowDecimal ? '0.001' : '1'}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => {
                if ((e.key === 'd' || e.key === 'D') && !item.isServiceCharge) {
                  e.preventDefault();
                  commitEdit();
                  // Delay past refocusBarcode's 100ms timeout so discount focus wins
                  setShowDiscount(true);
                  setTimeout(() => {
                    discountRef.current?.focus();
                    discountRef.current?.select();
                  }, 150);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  commitEdit();
                  onNavigateToBarcode();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                  onNavigateToBarcode();
                }
              }}
              style={{ ...qtyBoxStyle, outline: 'none', cursor: 'text', background: '#fff', borderColor: '#818cf8', boxShadow: '0 0 0 2px rgba(129,140,248,0.2)' }}
            />
          ) : (
            <button type="button" onClick={startEdit} style={{ ...qtyBoxStyle, cursor: 'pointer' }}>
              {fmtQty(item.qty)}
            </button>
          )}
        </div>

        {/* 5 — Disc Type: %/₨ toggle + value input when active/editing; else compact "+" to reveal.
              Preserves the existing showDiscount reveal — relocated into a cell, not a second row. */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 6px', borderRight: CART_COL_BORDER, minWidth: 0 }}>
          {item.isServiceCharge ? (
            <span />
          ) : discountLocked ? (
            // Manual discount disabled in Settings — show the preset read-only, or a lock.
            <span
              title="Manual discounts are turned off in Settings → POS"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, fontWeight: 600, color: item.itemDiscountCents > 0 ? '#64748b' : '#cbd5e1' }}
            >
              <Lock size={11} />
              {item.itemDiscountCents > 0 && (
                item.itemDiscountType === 'percent' ? `${item.itemDiscountValue}%` : `₨${item.itemDiscountValue}`
              )}
            </span>
          ) : (showDiscount || editing) ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
              <button
                type="button"
                onClick={() => onUpdateDiscount('percent', 0)}
                style={{
                  padding: '1px 4px', fontSize: 10, borderRadius: 3, cursor: 'pointer', fontWeight: 600, flexShrink: 0,
                  background: item.itemDiscountType === 'percent' ? '#e0e7ff' : '#f1f5f9',
                  color:      item.itemDiscountType === 'percent' ? '#4338ca' : '#94a3b8',
                  border: item.itemDiscountType === 'percent' ? '1px solid #a5b4fc' : '1px solid #e2e8f0',
                }}
              >%</button>
              <button
                type="button"
                onClick={() => onUpdateDiscount('amount', 0)}
                style={{
                  padding: '1px 4px', fontSize: 10, borderRadius: 3, cursor: 'pointer', fontWeight: 600, flexShrink: 0,
                  background: item.itemDiscountType === 'amount' ? '#e0e7ff' : '#f1f5f9',
                  color:      item.itemDiscountType === 'amount' ? '#4338ca' : '#94a3b8',
                  border: item.itemDiscountType === 'amount' ? '1px solid #a5b4fc' : '1px solid #e2e8f0',
                }}
              >₨</button>
              <DiscountInput
                ref={discountRef}
                mode={item.itemDiscountType}
                value={item.itemDiscountValue}
                maxAmount={item.unitPriceCents}
                onChange={(v) => { onUpdateDiscount(item.itemDiscountType, v); }}
                onEnter={onNavigateToBarcode}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowDiscount(true)}
              style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', cursor: 'pointer', background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 6, padding: '3px 0', width: '100%', letterSpacing: 0.2 }}
              title="Add item discount"
            >
              + disc
            </button>
          )}
        </div>

        {/* 6 — Disc Total (computed discount for the line) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '4px 10px', borderRight: CART_COL_BORDER }}>
          <span style={{
            fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
            color: item.itemDiscountCents > 0 ? '#16a34a' : '#cbd5e1',
          }}>
            {item.itemDiscountCents > 0 ? `-${formatCents(item.itemDiscountCents)}` : '–'}
          </span>
        </div>

        {/* 7 — Total (post-discount line total — B1 fix: was showing pre-discount subtotal) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '4px 10px', borderRight: CART_COL_BORDER }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: '#0f172a', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {formatCents(lineTotal)}
          </span>
        </div>

        {/* 8 — Trash (hidden for auto service-charge lines, removed with their parent) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 2px' }}>
          {!item.isServiceCharge ? (
            <button type="button" onClick={() => { sound.beep(); onRemove(); }}
              className="text-slate-300 hover:text-red-600 transition shrink-0">
              <Trash2 size={14} />
            </button>
          ) : (
            <span />
          )}
        </div>
      </div>

      {/* Amber warning when qty was capped to max stock */}
      {cappedAt !== null && (
        <p style={{ fontSize: 11, color: '#854F0B', padding: '1px 14px 4px' }}>
          Only {cappedAt} in stock
        </p>
      )}
    </div>
  );
});

// ─── CustomerPicker ───────────────────────────────────────────────────────────

function CustomerPicker({
  selected, onSelect, onClose,
}: {
  selected: CustomerOption | null;
  onSelect: (c: CustomerOption | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/customers', { params: { search: query, pageSize: 8, isActive: 'true' } });
        setResults((data.data ?? []) as CustomerOption[]);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
          <User size={16} className="text-indigo-500 shrink-0" />
          <span className="font-semibold text-slate-800 text-sm">Select Customer</span>
          <button type="button" onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
        <div className="p-3">
          <div className="relative mb-2">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or phone…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <button type="button" onClick={() => { onSelect(null); onClose(); }}
            className={cls('w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-slate-50 transition mb-1',
              !selected ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600')}>
            <User size={14} /> Walk-in Customer
          </button>
          {loading && <p className="text-xs text-slate-400 text-center py-3">Searching…</p>}
          {results.map(c => (
            <button key={c.id} type="button" onClick={() => { onSelect(c); onClose(); }}
              className={cls('w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm hover:bg-slate-50 transition',
                selected?.id === c.id ? 'bg-indigo-50' : '')}>
              <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-indigo-600">{c.name.charAt(0)}</span>
              </div>
              <div className="min-w-0">
                <p className="font-medium text-slate-800 truncate">{c.name}</p>
                {c.phone && <p className="text-[11px] text-slate-400">{c.phone}</p>}
              </div>
              {selected?.id === c.id && <CheckCircle size={13} className="ml-auto text-indigo-600 shrink-0" />}
            </button>
          ))}
          {!loading && results.length === 0 && query.trim() && (
            <p className="text-xs text-slate-400 text-center py-3">No customers found</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── HoldsPanel ───────────────────────────────────────────────────────────────

function HoldsPanel({
  holds, onResume, onDelete, onClose,
}: {
  holds: HoldBill[];
  onResume: (h: HoldBill) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <FolderOpen size={16} className="text-indigo-500" />
          <span className="font-bold text-slate-800">Saved Bills ({holds.length})</span>
          <button type="button" onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
        {holds.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 gap-2 py-10">
            <FolderOpen size={36} />
            <p className="text-sm">No saved bills</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {holds.map(h => {
              const cartSub = h.cart.reduce((s, i) => s + i.qty * i.unitPriceCents - (i.itemDiscountCents ?? 0), 0);
              const cartDisc = h.cartDiscountType === 'percent'
                ? Math.floor(cartSub * (h.cartDiscountValue ?? 0) / 100)
                : Math.min(Math.round((h.cartDiscountValue ?? 0) * 100), cartSub);
              const total = cartSub - cartDisc;
              const timeStr = new Date(h.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <div key={h.id} className="border border-slate-200 rounded-xl p-3 hover:border-indigo-300 transition">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-800 truncate">{h.label || (h.customer?.name ?? 'Walk-in')}</p>
                      <p className="text-xs text-slate-400">{timeStr} · {h.cart.length} item{h.cart.length !== 1 ? 's' : ''} · <span className="text-indigo-600 font-semibold">{formatCents(total)}</span></p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button type="button" onClick={() => onResume(h)}
                        className="px-2.5 py-1 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition">
                        Resume
                      </button>
                      <button type="button" onClick={() => onDelete(h.id)}
                        className="px-2.5 py-1 text-xs text-red-400 hover:bg-red-50 rounded-lg transition">
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── HoldModal ────────────────────────────────────────────────────────────────

function HoldModal({
  onConfirm, onClose,
}: {
  onConfirm: (label: string) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const holdRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6">
        <h3 className="font-bold text-slate-800 mb-1 flex items-center gap-2">
          <Save size={16} className="text-indigo-500" /> Hold Current Bill
        </h3>
        <p className="text-sm text-slate-500 mb-4">Give this bill a label to find it easily later.</p>
        <input
          ref={inputRef}
          autoFocus
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { onConfirm(label); return; }
            if (e.key === 'Escape') { onClose(); return; }
            if (e.key === 'Tab') {
              e.preventDefault();
              if (e.shiftKey) holdRef.current?.focus();
              else cancelRef.current?.focus();
            }
          }}
          placeholder="e.g. Table 3, Customer name…"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-4"
        />
        <div className="flex gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            onKeyDown={e => {
              if (e.key === 'Escape') { onClose(); return; }
              if (e.key === 'Tab') {
                e.preventDefault();
                if (e.shiftKey) inputRef.current?.focus();
                else holdRef.current?.focus();
              }
            }}
            className="flex-1 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            ref={holdRef}
            type="button"
            onClick={() => onConfirm(label)}
            onKeyDown={e => {
              if (e.key === 'Escape') { onClose(); return; }
              if (e.key === 'Tab') {
                e.preventDefault();
                if (e.shiftKey) cancelRef.current?.focus();
                else inputRef.current?.focus();
              }
            }}
            className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition"
          >
            Hold Bill
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CancelConfirmModal ─────────────────────────────────────────────────────────

function CancelConfirmModal({
  onConfirm, onClose,
}: {
  onConfirm: () => void;
  onClose: () => void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6">
        <h3 className="font-bold text-slate-800 mb-1 flex items-center gap-2">
          <Trash2 size={16} className="text-red-500" /> Cancel Sale?
        </h3>
        <p className="text-sm text-slate-500 mb-4">All items in the current cart will be cleared. This cannot be undone.</p>
        <div className="flex gap-2">
          <button
            ref={keepRef}
            type="button"
            autoFocus
            onClick={onClose}
            onKeyDown={e => {
              if (e.key === 'Escape') { onClose(); return; }
              if (e.key === 'Tab') { e.preventDefault(); cancelRef.current?.focus(); }
            }}
            className="flex-1 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50"
          >
            Keep editing
          </button>
          <button
            ref={cancelRef}
            type="button"
            onClick={onConfirm}
            onKeyDown={e => {
              if (e.key === 'Tab') { e.preventDefault(); keepRef.current?.focus(); }
            }}
            className="flex-1 py-2 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition"
          >
            Cancel sale
          </button>
        </div>
      </div>
    </div>
  );
}

// DiscountModal removed — replaced by inline DiscountInput in cart + totals panel

// ─── PaymentDialog ────────────────────────────────────────────────────────────

function PaymentDialog({
  totalCents: rawTotalCents, onConfirm, onClose, isPending, customer, canSellOnCredit,
  loyaltyEnabled, customerPoints, pointValueCents, minRedeemPoints, redeemPoints, setRedeemPoints,
}: {
  totalCents: number;
  onConfirm: (method: AllPaymentMethods, receivedCents?: number, cashAmountCents?: number) => void;
  onClose: () => void;
  isPending: boolean;
  customer: CustomerOption | null;
  canSellOnCredit: boolean;
  loyaltyEnabled: boolean;
  customerPoints: number;
  pointValueCents: number;
  minRedeemPoints: number;
  redeemPoints: number;
  setRedeemPoints: (n: number) => void;
}) {
  // Loyalty redemption reduces the payable total (points × value, capped at total).
  const canRedeem = loyaltyEnabled && !!customer && customerPoints >= Math.max(1, minRedeemPoints);
  const validRedeem = canRedeem && redeemPoints >= minRedeemPoints && redeemPoints <= customerPoints;
  const redeemDiscountCents = validRedeem ? Math.min(redeemPoints * pointValueCents, rawTotalCents) : 0;
  const totalCents = rawTotalCents - redeemDiscountCents;

  const [activeTab, setActiveTab]     = useState<PayTab>('CASH');
  const [tabsFocused, setTabsFocused] = useState(true);
  const [received, setReceived]       = useState(() => (totalCents / 100).toFixed(2));
  const [splitCash, setSplitCash]     = useState('');
  const [splitSecondary, setSplitSecondary] = useState<'CARD' | 'BANK_TRANSFER' | 'QR_PAY' | 'CREDIT'>('CARD');
  const [creditNote, setCreditNote]   = useState('');
  // Keep the cash-tendered field in step with the (redemption-adjusted) total.
  useEffect(() => { setReceived((totalCents / 100).toFixed(2)); }, [totalCents]);

  const tabRefs    = useRef<(HTMLButtonElement | null)[]>([]);
  const amountRef  = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Synchronous double-submit guard: flips immediately on the first confirm,
  // before isPending (a prop) can propagate, blocking a same-frame second
  // Enter (key repeat / scanner) from firing a second sale.
  const submittingRef = useRef(false);

  const creditOkForTab = customer?.creditEnabled === true && canSellOnCredit;

  const { data: creditInfo } = useQuery({
    queryKey: ['customer-credit-dialog', customer?.id],
    queryFn: () => posApi.getCustomerCredit(customer!.id),
    enabled: !!customer && activeTab === 'CREDIT' && canSellOnCredit,
    staleTime: 30_000,
  });

  const PAY_TABS: { key: PayTab; label: string; icon: ReactNode; disabled?: boolean }[] = [
    { key: 'CASH',   label: 'Cash',   icon: <Banknote size={14} /> },
    { key: 'CARD',   label: 'Card',   icon: <CreditCard size={14} /> },
    { key: 'BANK',   label: 'Bank',   icon: <Building2 size={14} /> },
    { key: 'QR_PAY', label: 'QR Pay', icon: <QrCode size={14} /> },
    { key: 'SPLIT',  label: 'Split',  icon: <Layers size={14} /> },
    { key: 'CREDIT', label: 'Credit', icon: <CreditCard size={14} />,
      disabled: !customer || !creditOkForTab },
  ];

  const available = PAY_TABS.filter(t => !t.disabled).map(t => t.key);

  const receivedCents = Math.round(parseFloat(received || '0') * 100);
  const changeCents   = Math.max(0, receivedCents - totalCents);
  const splitCashC    = Math.round(parseFloat(splitCash || '0') * 100);
  const splitRemainder = Math.max(0, totalCents - splitCashC);
  const splitValid    = splitCashC > 0 && splitCashC < totalCents;

  const canConfirm = (() => {
    if (activeTab === 'CASH') return receivedCents >= totalCents;
    if (activeTab === 'SPLIT') return splitValid;
    if (activeTab === 'CREDIT') return creditOkForTab && !!customer;
    return true;
  })();

  const handleConfirm = () => {
    if (submittingRef.current) return;
    if (!canConfirm || isPending) return;
    submittingRef.current = true;
    if (activeTab === 'CASH')   { onConfirm('CASH', receivedCents); return; }
    if (activeTab === 'CARD')   { onConfirm('CARD'); return; }
    if (activeTab === 'BANK')   { onConfirm('BANK_TRANSFER'); return; }
    if (activeTab === 'QR_PAY') { onConfirm('QR_PAY'); return; }
    if (activeTab === 'SPLIT')  {
      if (splitSecondary === 'CREDIT') {
        // Cash + Credit split: cash portion paid now; remainder recorded as credit/outstanding.
        onConfirm('CREDIT', splitCashC, splitCashC);
      } else {
        // Cash + Card/Bank/QR split: fully paid, no outstanding (unchanged behaviour).
        onConfirm('CASH', splitCashC);
      }
      return;
    }
    if (activeTab === 'CREDIT') { onConfirm('CREDIT'); return; }
  };

  // Focus first tab on open
  useEffect(() => {
    setTabsFocused(true);
    setTimeout(() => tabRefs.current[0]?.focus(), 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Release the double-submit guard once the mutation settles (success or
  // error) so the cashier can retry a genuinely failed payment.
  useEffect(() => {
    if (!isPending) submittingRef.current = false;
  }, [isPending]);

  // Zone-based keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (isPending) return; e.preventDefault(); onClose(); return; }

      if (tabsFocused) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          const i    = available.indexOf(activeTab);
          const next = available[(i + 1) % available.length];
          setActiveTab(next);
          tabRefs.current[PAY_TABS.findIndex(t => t.key === next)]?.focus();
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          const i    = available.indexOf(activeTab);
          const prev = available[(i - 1 + available.length) % available.length];
          setActiveTab(prev);
          tabRefs.current[PAY_TABS.findIndex(t => t.key === prev)]?.focus();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          setTabsFocused(false);
          setTimeout(() => { amountRef.current?.focus(); amountRef.current?.select(); }, 30);
          return;
        }
      } else {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setTabsFocused(true);
          setTimeout(() => tabRefs.current[PAY_TABS.findIndex(t => t.key === activeTab)]?.focus(), 30);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmRef.current?.click();
          return;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsFocused, activeTab, available, onClose, isPending]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-800">Payment</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Amount Due */}
          <div className="bg-indigo-600 rounded-2xl px-5 py-4 text-center">
            <p className="text-indigo-200 text-xs font-semibold uppercase tracking-widest mb-1">Amount Due</p>
            <p className="text-white font-black text-3xl">{formatCents(totalCents)}</p>
            {redeemDiscountCents > 0 && (
              <p className="text-indigo-200 text-xs mt-1">
                <span className="line-through opacity-70">{formatCents(rawTotalCents)}</span>
                {' '}· {redeemPoints.toLocaleString()} pts redeemed
              </p>
            )}
          </div>

          {/* Loyalty redemption */}
          {canRedeem && (
            <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-indigo-700">🎁 Redeem points</span>
                <span className="text-xs text-indigo-500">{customerPoints.toLocaleString()} available · 1 pt = {formatCents(pointValueCents)}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0} max={customerPoints}
                  value={redeemPoints || ''}
                  placeholder="0"
                  onChange={(e) => setRedeemPoints(Math.max(0, Math.min(customerPoints, parseInt(e.target.value) || 0)))}
                  className="w-24 px-2 py-1.5 border border-indigo-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <span className="text-xs text-slate-500">points</span>
                <button type="button" onClick={() => setRedeemPoints(customerPoints)} className="text-xs text-indigo-600 hover:underline ml-auto">Redeem max</button>
              </div>
              {redeemPoints > 0 && redeemPoints < minRedeemPoints && (
                <p className="text-xs text-amber-600 mt-1.5">Minimum {minRedeemPoints.toLocaleString()} points to redeem</p>
              )}
            </div>
          )}

          {/* Method tabs — 6 columns */}
          <div className="grid grid-cols-6 gap-1">
            {PAY_TABS.map((pt, i) => {
              const isDisabled = !!pt.disabled;
              return (
                <div key={pt.key} className="relative group">
                  <button
                    ref={el => { tabRefs.current[i] = el; }}
                    type="button"
                    tabIndex={isDisabled ? -1 : 0}
                    onClick={() => { if (!isDisabled) { setActiveTab(pt.key); setTabsFocused(false); setTimeout(() => { amountRef.current?.focus(); amountRef.current?.select(); }, 30); } }}
                    style={isDisabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                    className={cls(
                      'w-full flex flex-col items-center gap-1 py-2 rounded-xl text-[11px] font-semibold border transition',
                      'focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1',
                      activeTab === pt.key && !isDisabled
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : isDisabled
                          ? 'border-slate-200 text-slate-400 bg-slate-50'
                          : 'border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50',
                    )}>
                    {pt.icon}
                    <span>{pt.label}</span>
                  </button>
                  {isDisabled && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-10">
                      <div className="bg-slate-800 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap shadow-lg">
                        Select a credit-approved customer to enable
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Tab content */}
          {activeTab === 'CASH' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Amount Received (Rs.)</label>
                <input
                  ref={amountRef}
                  type="number" min="0" step="0.01"
                  value={received}
                  onChange={e => setReceived(e.target.value)}
                  onFocus={() => setTabsFocused(false)}
                  className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-2xl font-bold text-center focus:outline-none focus:border-indigo-400"
                  placeholder="0.00"
                />
              </div>
              {receivedCents >= totalCents && receivedCents > 0 && (
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
                  <span className="text-green-700 font-semibold text-sm">Change</span>
                  <span className="text-green-700 font-black text-2xl">{formatCents(changeCents)}</span>
                </div>
              )}
              {receivedCents > 0 && receivedCents < totalCents && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-center text-sm text-red-600 font-medium">
                  Short by {formatCents(totalCents - receivedCents)}
                </div>
              )}
            </div>
          )}

          {(activeTab === 'CARD' || activeTab === 'BANK') && (
            <div className="space-y-3">
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-5 text-center">
                <p className="text-slate-600 text-sm">
                  {activeTab === 'CARD' ? 'Card' : 'Bank transfer'} payment of
                </p>
                <p className="text-indigo-700 font-black text-2xl mt-1">{formatCents(totalCents)}</p>
                <p className="text-xs text-slate-400 mt-1">Exact amount will be charged</p>
              </div>
              <input ref={amountRef} className="sr-only" readOnly onFocus={() => setTabsFocused(false)} />
            </div>
          )}

          {activeTab === 'QR_PAY' && (
            <div className="space-y-3">
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-5 text-center">
                <QrCode size={40} className="mx-auto text-slate-400 mb-2" />
                <p className="text-indigo-700 font-black text-2xl">{formatCents(totalCents)}</p>
                <p className="text-xs text-slate-500 mt-1">Present QR code to customer</p>
              </div>
              <input ref={amountRef} className="sr-only" readOnly onFocus={() => setTabsFocused(false)} />
            </div>
          )}

          {activeTab === 'SPLIT' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Cash Amount (Rs.)</label>
                <input
                  ref={amountRef}
                  type="number" min="0" step="0.01"
                  value={splitCash}
                  onChange={e => setSplitCash(e.target.value)}
                  onFocus={() => setTabsFocused(false)}
                  className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-lg font-bold text-center focus:outline-none focus:border-indigo-400"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Remainder via</label>
                <select
                  value={splitSecondary}
                  onChange={e => setSplitSecondary(e.target.value as typeof splitSecondary)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                >
                  <option value="CARD">Card</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="QR_PAY">QR Pay</option>
                  {customer?.creditEnabled === true && canSellOnCredit && (
                    <option value="CREDIT">Credit</option>
                  )}
                </select>
              </div>
              <div className={cls(
                'rounded-xl px-4 py-2 text-sm text-center font-medium',
                splitValid ? 'bg-green-50 text-green-700 border border-green-200'
                           : 'bg-slate-50 text-slate-500 border border-slate-200',
              )}>
                {splitCashC > 0
                  ? splitValid
                    ? `${formatCents(splitCashC)} cash + ${formatCents(splitRemainder)} via ${splitSecondary === 'CARD' ? 'Card' : splitSecondary === 'BANK_TRANSFER' ? 'Bank' : splitSecondary === 'CREDIT' ? 'Credit' : 'QR Pay'} ✓`
                    : `Remaining: ${formatCents(splitRemainder)} via ${splitSecondary === 'CARD' ? 'Card' : splitSecondary === 'BANK_TRANSFER' ? 'Bank' : splitSecondary === 'CREDIT' ? 'Credit' : 'QR Pay'}`
                  : 'Enter cash amount'}
              </div>
            </div>
          )}

          {activeTab === 'CREDIT' && (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4">
                {customer && <p className="font-bold text-slate-800 mb-1">{customer.name}</p>}
                <p className="text-sm text-amber-800">
                  This sale will be recorded as credit. Payment due from customer.
                </p>
                {creditInfo && (
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div className="bg-white border border-amber-200 rounded-lg py-2 px-1">
                      <p className="text-[10px] text-slate-500 font-medium">Limit</p>
                      <p className="text-sm font-bold text-slate-800">{formatCents(creditInfo.limit)}</p>
                    </div>
                    <div className="bg-white border border-amber-200 rounded-lg py-2 px-1">
                      <p className="text-[10px] text-slate-500 font-medium">Used</p>
                      <p className="text-sm font-bold text-red-600">{formatCents(creditInfo.balance)}</p>
                    </div>
                    <div className={`border rounded-lg py-2 px-1 ${creditInfo.isOverLimit ? 'bg-red-50 border-red-300' : creditInfo.isNearLimit ? 'bg-yellow-50 border-yellow-300' : 'bg-green-50 border-green-200'}`}>
                      <p className="text-[10px] text-slate-500 font-medium">Available</p>
                      <p className={`text-sm font-bold ${creditInfo.isOverLimit ? 'text-red-600' : 'text-green-700'}`}>
                        {creditInfo.available < 0 ? '∞' : formatCents(creditInfo.available)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Notes (optional)</label>
                <input
                  ref={amountRef}
                  type="text"
                  value={creditNote}
                  onChange={e => setCreditNote(e.target.value)}
                  onFocus={() => setTabsFocused(false)}
                  placeholder="e.g. Payment due in 30 days…"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400"
                />
              </div>
            </div>
          )}

          {/* Processing indicator (v1.0.42) — reassures cashier the sale is in flight */}
          {isPending && (
            <p className="text-center text-sm text-indigo-600 font-medium animate-pulse mb-2">
              Processing payment, please wait...
            </p>
          )}

          {/* Confirm */}
          <div className="flex gap-3">
            <button type="button" onClick={onClose}
              className="flex-1 py-3 border border-slate-200 rounded-xl text-slate-600 text-sm hover:bg-slate-50">
              Cancel
            </button>
            <button ref={confirmRef} type="button" onClick={handleConfirm}
              disabled={isPending || !canConfirm}
              className="flex-[2] py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
              {isPending
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processing…</>
                : <><CheckCircle size={16} /> Confirm Payment</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ReceiptModal ─────────────────────────────────────────────────────────────

function ReceiptModal({
  receipt, changeCents, onNewSale, onClose, onPrint, onReturn, readOnly = false,
}: {
  receipt: Receipt;
  changeCents: number;
  onNewSale: () => void;
  onClose: () => void;
  onPrint: () => void;
  onReturn: () => void;
  // v1.0.72 — reprint (read-only) context: nothing to acknowledge and no new
  // sale is being started, so the primary button just closes the view. Also
  // suppresses the F5 hint, which only fires on the live post-sale receipt.
  readOnly?: boolean;
}) {
  const { settings, businessName, formatMoney } = useAppSettings();
  const waEnabled = useModule('whatsapp');

  if (!settings) return null;

  const pmLabel: Record<string, string> = {
    CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank Transfer',
    QR_PAY: 'QR Pay', CREDIT: 'Credit',
  };

  // Split (cash + credit): recorded as CREDIT with a partial cash payment
  const isSplit = receipt.paymentMethod === 'CREDIT'
    && receipt.paidCents > 0
    && receipt.paidCents < receipt.totalCents;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full flex overflow-hidden" style={{ maxWidth: 740, maxHeight: '90vh' }}>

        {/* LEFT — receipt preview */}
        <div className="bg-slate-100 flex items-start justify-center overflow-y-auto p-6 flex-shrink-0" style={{ width: 300 }}>
          <div style={{ boxShadow: '2px 4px 16px rgba(0,0,0,0.18)' }}>
            <ThermalReceipt receipt={receipt} settings={settings} changeCents={changeCents} />
          </div>
        </div>

        {/* RIGHT — actions */}
        <div className="flex-1 flex flex-col p-6 overflow-y-auto">
          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
              <CheckCircle size={22} className="text-emerald-600" />
            </div>
            <div>
              <p className="font-bold text-slate-800 text-base">Sale Complete</p>
              <p className="text-xs text-slate-500">{receipt.number}</p>
            </div>
          </div>

          {/* Quick stats */}
          <div className="space-y-2 mb-6 bg-slate-50 rounded-xl p-4">
            {[
              { label: 'Invoice', value: receipt.number },
              { label: 'Total', value: formatCents(receipt.totalCents) },
              { label: 'Payment', value: isSplit ? 'Cash + Credit' : (pmLabel[receipt.paymentMethod] ?? receipt.paymentMethod) },
              ...(receipt.paymentMethod === 'CASH' && changeCents > 0 ? [{ label: 'Change', value: formatCents(changeCents) }] : []),
              ...(isSplit ? [{ label: 'Cash Paid', value: formatCents(receipt.paidCents) }] : []),
              ...(receipt.isCreditSale ? [{ label: 'Balance Due', value: formatCents(receipt.totalCents - receipt.paidCents) }] : []),
              ...(receipt.isStaffSale  ? [{ label: 'Type', value: 'Staff Sale' }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{label}</span>
                <span className="font-semibold text-slate-800">{value}</span>
              </div>
            ))}

            {receipt.promotions && receipt.promotions.length > 0 && (
              <div className="pt-2 mt-1 border-t border-slate-200 space-y-1">
                <p className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wide">Promotions applied</p>
                {receipt.promotions.map((pr) => (
                  <div key={pr.promotionId} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 truncate mr-2">{pr.label}</span>
                    <span className="font-medium text-emerald-600">− {formatCents(pr.discountCents)}</span>
                  </div>
                ))}
              </div>
            )}

            {receipt.loyalty && (receipt.loyalty.earned > 0 || receipt.loyalty.redeemed > 0) && (
              <div className="pt-2 mt-1 border-t border-slate-200 space-y-1">
                <p className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wide">Loyalty</p>
                {receipt.loyalty.redeemed > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Points redeemed</span>
                    <span className="font-medium text-red-500">− {receipt.loyalty.redeemed.toLocaleString()}</span>
                  </div>
                )}
                {receipt.loyalty.earned > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Points earned</span>
                    <span className="font-medium text-indigo-600">+ {receipt.loyalty.earned.toLocaleString()}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="space-y-2 mt-auto">
            <button
              type="button"
              onClick={onPrint}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2.5 text-sm font-bold transition"
            >
              <Printer size={15} /> Print Receipt
              <span className="ml-1 text-indigo-300 text-xs font-normal">F8</span>
            </button>

            {/* Send the receipt over WhatsApp — only when enabled AND the
                customer has a phone. Opens WhatsApp with recipient + message
                pre-filled; the cashier clicks Send inside WhatsApp. */}
            {waEnabled && settings?.whatsappEnabled && receipt.customer?.phone && (
              <button
                type="button"
                onClick={() => {
                  const itemsList = buildItemsList(
                    receipt.lines.map(l => ({
                      name: l.product.receiptName || l.product.name,
                      qty: Number(l.qty),
                      lineTotalCents: l.lineTotalCents,
                    })),
                  );
                  // formatMoney respects currencyPosition (before/after) from Settings.
                  const total = formatMoney(receipt.totalCents);
                  const message = fillTemplate(
                    settings.waReceiptTemplate || DEFAULT_RECEIPT_TEMPLATE,
                    {
                      customerName:  receipt.customer?.name ?? 'Valued Customer',
                      businessName:  businessName ?? 'Our Store',
                      invoiceNumber: receipt.number ?? '',
                      date:          new Date(receipt.date).toLocaleDateString(),
                      items:         itemsList || 'See invoice for details',
                      total,
                    },
                  );
                  openWhatsApp(receipt.customer!.phone, message, settings?.whatsappOpenMode);
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-medium transition"
                title="Open WhatsApp with the receipt pre-filled. Click Send inside WhatsApp."
              >
                <span className="text-base">💬</span>
                Send Receipt via WhatsApp
              </button>
            )}

            <button
              type="button"
              disabled
              title="Email receipt feature coming soon"
              className="w-full flex items-center justify-center gap-2 border border-slate-200 rounded-xl py-2.5 text-sm text-slate-400 cursor-not-allowed"
            >
              <Mail size={15} /> Email Receipt
              <span className="ml-1 text-xs text-slate-300">(coming soon)</span>
            </button>

            <button
              type="button"
              onClick={onNewSale}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-2.5 text-sm font-bold transition"
            >
              {readOnly ? (
                <><X size={15} /> Close</>
              ) : (
                <><ShoppingCart size={15} /> New Sale
                  <span className="ml-1 text-emerald-300 text-xs font-normal">F5</span></>
              )}
            </button>

            {/* Return items from THIS sale — one-click into the shared return modal */}
            <button
              type="button"
              onClick={onReturn}
              className="w-full flex items-center justify-center gap-2 border border-orange-200 text-orange-600 hover:bg-orange-50 rounded-xl py-2.5 text-sm font-semibold transition"
            >
              <RotateCcw size={15} /> Return Items
            </button>

          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Product → PosProduct adapter (for newly created products) ───────────────

function productToPosProduct(p: Product): PosProduct {
  return {
    id:              p.id,
    sku:             p.sku,
    barcode:         p.barcode,
    name:            p.name,
    categoryId:      p.categoryId,
    priceCents:           p.priceCents,
    costCents:            p.costCents,
    defaultDiscountCents: p.defaultDiscountCents ?? 0,
    serviceChargeCents:   p.serviceChargeCents ?? 0,
    serviceChargeLabel:   p.serviceChargeLabel ?? null,
    serviceChargeMode:    p.serviceChargeMode ?? 'per_item',
    receiptName:          p.receiptName ?? null,
    taxPercent:           p.taxPercent,
    imageUrl:        p.imageUrl ?? null,
    expiryDate:      p.expiryDate ?? null,
    expiryAlertDays: p.expiryAlertDays ?? 30,
    isBatchTracked:  p.isBatchTracked ?? false,
    unitId:          p.unitId,
    baseUnitId:      p.baseUnitId ?? null,
    purchaseUnitId:  p.purchaseUnitId ?? null,
    salesUnitId:     p.salesUnitId ?? null,
    // Quick-add products carry no allowDecimal on their unit type → default
    // false (whole numbers, the safe choice for an unknown unit); preserve a
    // real value if the API ever provides one.
    unit:            { ...p.unit,     allowDecimal: (p.unit     as { allowDecimal?: boolean }).allowDecimal ?? false },
    baseUnit:        p.baseUnit  ? { ...p.baseUnit,  allowDecimal: (p.baseUnit  as { allowDecimal?: boolean }).allowDecimal ?? false } : null,
    salesUnit:       p.salesUnit ? { ...p.salesUnit, allowDecimal: (p.salesUnit as { allowDecimal?: boolean }).allowDecimal ?? false } : null,
    unitConversions: [],
    stock:           p.stock.map(s => ({ qty: String(s.qty) })),
    batchSummary:    null,
  };
}

// ─── Logo base64 helper ───────────────────────────────────────────────────────

async function fetchLogoAsBase64(url: string, token: string | null): Promise<string | null> {
  if (!url || !token) return null;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror  = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// ─── Resizable products/cart split ────────────────────────────────────────────

const PANEL_WIDTH_KEY       = 'pos_left_panel_width';
const MIN_LEFT_PANEL_WIDTH  = 380;
const MIN_RIGHT_PANEL_WIDTH = 420;
const PANEL_HANDLE_WIDTH    = 6;
const DEFAULT_PANEL_RATIO   = 0.46;

// One clamp shared by dragging and by window resizes, so the split can never
// leave a panel unusable. If the window is too narrow to satisfy both minimums
// the cart wins — a cashier needs the totals more than the product grid — with
// a hard floor so the products panel never collapses to nothing.
function clampPanelWidth(proposed: number, containerWidth: number): number {
  const maxLeft = containerWidth - MIN_RIGHT_PANEL_WIDTH - PANEL_HANDLE_WIDTH;
  return Math.round(Math.max(Math.min(Math.max(proposed, MIN_LEFT_PANEL_WIDTH), maxLeft), 240));
}

// ─── Main POSPage ─────────────────────────────────────────────────────────────

export default function POSPage() {
  const navigate  = useNavigate();
  const { user, logout }  = useAuthStore();
  const { currencySymbol, settings: appSettings } = useAppSettings();
  const { enterPOS, exitPOS, shiftId, openShift: storeOpenShift, closeShift: storeCloseShift } = usePosStore();
  const shiftOpenedAt = usePosStore(s => s.shiftOpenedAt);
  const qc        = useQueryClient();

  const isAdmin   = isManagerOrAbove(user?.role);
  const canSellOnCredit = user?.permissions?.includes('sell_on_credit') ?? isAdmin;

  async function handleLogout() {
    // v1.0.49 — ALL roles must close an open shift before signing out
    // (previously ADMIN/MANAGER bypassed this check).
    if (currentShift) {
      setSignOutCash('');
      setSignOutNote('');
      setSignOutError(null);
      setShowSignOutShift(true);
      return;
    }
    exitPOS();
    logout();
    navigate('/login');
  }

  async function handleSignOutWithClose() {
    if (!currentShift) return;
    setSignOutPending(true);
    setSignOutError(null);
    try {
      await shiftsApi.close({
        shiftId:     currentShift.id,
        closingCash: parseFloat(signOutCash) || 0,
        note:        signOutNote.trim() || undefined,
      });
      storeCloseShift();
      exitPOS();
      logout();
      navigate('/login');
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
      setSignOutError(data?.message ?? data?.error ?? 'Failed to close shift. Please try again.');
      setSignOutPending(false);
    }
  }

  // ── Refs ──────────────────────────────────────────────────────────────────────
  const barcodeRef      = useRef<HTMLInputElement>(null);
  const whDropdownRef   = useRef<HTMLDivElement>(null);
  // Grid container for keyboard navigation of no-barcode products (v1.0.60)
  const gridRef         = useRef<HTMLDivElement>(null);
  // Products/cart panel container — measured to clamp the draggable divider
  const panelContainerRef = useRef<HTMLDivElement>(null);
  // Per-cart-item refs for keyboard focus flow (scan → qty → D:discount → Enter:barcode)
  const cartLineRefs    = useRef<Record<string, CartLineHandle | null>>({});
  // Total cart discount ref (Shift+Enter from anywhere)
  const totalDiscountRef = useRef<DiscountInputHandle>(null);
  // Barcode debounce: ignore duplicate scans within 300ms
  const lastScanTime    = useRef(0);

  // ── State ─────────────────────────────────────────────────────────────────────
  const [barcodeInput, setBarcodeInput]         = useState('');
  const [search, setSearch]                     = useState('');
  const [debouncedSearch, setDebouncedSearch]   = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand]       = useState<string | null>(null);
  // Highlighted product card index for keyboard grid navigation (v1.0.60; -1 = none)
  const [gridSelectedIndex, setGridSelectedIndex] = useState<number>(-1);

  // ── Draggable products/cart divider ─────────────────────────────────────────
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return saved > 0 ? saved : Math.round(window.innerWidth * DEFAULT_PANEL_RATIO);
  });
  const [isResizingPanels, setIsResizingPanels] = useState(false);

  // Shared by mouse and touch. Only mousedown is prevented — preventing
  // touchstart would also kill the synthesized tap events on the handle.
  const handlePanelResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (e.type === 'mousedown') e.preventDefault();
    setIsResizingPanels(true);
  }, []);

  // Drag tracking — attaches to window so the drag keeps working even if the
  // pointer slips off the thin handle. Clamped to keep both panels usable.
  // Touch is supported too: POS terminals are frequently touchscreens.
  useEffect(() => {
    if (!isResizingPanels) return;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const moveTo = (clientX: number) => {
      const rect = panelContainerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setLeftPanelWidth(clampPanelWidth(clientX - rect.left, rect.width));
    };
    const handleMouseMove = (e: MouseEvent) => moveTo(e.clientX);
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();   // stop the page panning under the finger
      moveTo(e.touches[0].clientX);
    };
    const handleEnd = () => setIsResizingPanels(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleEnd);
    window.addEventListener('touchcancel', handleEnd);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchcancel', handleEnd);
    };
  }, [isResizingPanels]);

  // Re-clamp when the window changes size, and once on mount — a width saved on
  // a wide monitor must not squeeze the cart when restored on a smaller screen.
  useEffect(() => {
    const reclamp = () => {
      const rect = panelContainerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      setLeftPanelWidth(prev => clampPanelWidth(prev, rect.width));
    };
    reclamp();
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, []);

  // Persist the chosen split once a drag ends, so it survives a reload.
  useEffect(() => {
    if (isResizingPanels) return;
    localStorage.setItem(PANEL_WIDTH_KEY, String(leftPanelWidth));
  }, [isResizingPanels, leftPanelWidth]);

  const CART_KEY = 'pos_cart_draft';
  const [cart, setCart]                         = useState<CartItem[]>(() => {
    try {
      const raw = localStorage.getItem('pos_cart_draft');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  // Multi-batch product awaiting a cashier's batch pick — set by
  // handleProductClick, cleared once BatchPickerModal resolves.
  const [pendingBatchProduct, setPendingBatchProduct] = useState<PosProduct | null>(null);
  const [cartDiscountType, setCartDiscountType] = useState<'percent' | 'amount'>('amount');
  const [cartDiscountValue, setCartDiscountValue] = useState(0);
  const [isStaffSale, setIsStaffSale]           = useState(false);
  const [customer, setCustomer]                 = useState<CustomerOption | null>(null);
  const [warehouseId, setWarehouseId]           = useState('');
  const [lastReceipt, setLastReceipt]           = useState<Receipt | null>(null);
  // v1.0.72 — Reprint Last Receipt escape hatch. lastSaleInfo survives reloads
  // (localStorage); reprintReceipt drives a read-only ReceiptModal whose close
  // handlers never clear the cart and never touch receiptPendingRef/lastReceipt.
  const [lastSaleInfo, setLastSaleInfo]         = useState<LastSaleInfo | null>(loadLastSaleInfo);
  const [reprintReceipt, setReprintReceipt]     = useState<Receipt | null>(null);
  const [reprintChangeCents, setReprintChangeCents] = useState(0);
  const [reprintLoading, setReprintLoading]     = useState(false);
  // v1.0.43 — true once a sale completes, until the cashier acknowledges via "New Sale".
  // Drives the receipt-recovery effect that re-opens the popup if it ever closes early.
  const receiptPendingRef                       = useRef(false);
  const [lastChangeCents, setLastChangeCents]   = useState(0);
  const [holds, setHolds]                       = useState<HoldBill[]>(loadHolds);

  // Dialog visibility
  const [showPayment,         setShowPayment]         = useState(false);
  // Loyalty redemption (module-gated). redeemPoints is applied at checkout.
  const loyaltyOn = useModule('loyalty');
  const [redeemPoints, setRedeemPoints] = useState(0);
  const { data: loyaltyConfig } = useQuery({ queryKey: ['loyalty-config'], queryFn: loyaltyApi.getConfig, enabled: loyaltyOn });
  const { data: customerLoyalty } = useQuery({
    queryKey: ['loyalty-customer', customer?.id],
    queryFn: () => loyaltyApi.getCustomer(customer!.id),
    enabled: loyaltyOn && !!customer,
  });
  // Reset redemption whenever the customer changes.
  useEffect(() => { setRedeemPoints(0); }, [customer?.id]);
  const [showReceipt,         setShowReceipt]         = useState(false);
  const [showHoldModal,       setShowHoldModal]       = useState(false);
  const [showCancelConfirm,   setShowCancelConfirm]   = useState(false);
  const [showHolds,           setShowHolds]           = useState(false);
  const [showCustomer,        setShowCustomer]        = useState(false);
  // Quick sales return (reuses shared NewReturnModal). prefill = last completed sale id.
  const [showReturn,          setShowReturn]          = useState(false);
  const [returnPrefillId,     setReturnPrefillId]     = useState<string | undefined>(undefined);
  const [showShortcuts,       setShowShortcuts]       = useState(false);
  const [showExitBlocked,     setShowExitBlocked]     = useState(false);
  const [showWhDropdown,      setShowWhDropdown]      = useState(false);
  const [showQuickAddCustomer,setShowQuickAddCustomer]= useState(false);
  const [showCloseShift,      setShowCloseShift]      = useState(false);
  const [exitAfterShiftClose, setExitAfterShiftClose] = useState(false);
  const [showSignOutShift,    setShowSignOutShift]    = useState(false);
  const [signOutCash,         setSignOutCash]         = useState('');
  const [signOutNote,         setSignOutNote]         = useState('');
  const [signOutError,        setSignOutError]        = useState<string | null>(null);
  const [signOutPending,      setSignOutPending]      = useState(false);
  const [quickAddBarcode,     setQuickAddBarcode]      = useState<string | null>(null);
  const [quickAddToast,       setQuickAddToast]        = useState<string | null>(null);
  const [barcodeLoading,      setBarcodeLoading]       = useState(false);
  const [batchCapToast,       setBatchCapToast]       = useState<string | null>(null);
  // Checkout timeout warning — shown in the main POS view after the payment
  // modal closes when a checkout request times out (sale may have committed).
  const [checkoutError,       setCheckoutError]       = useState<string | null>(null);

  // Quick-add customer form
  const [newCustName,  setNewCustName]  = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [quickAddError,setQuickAddError]= useState('');

  const clock   = useLiveClock();
  const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  // ── Resume AudioContext on first user interaction (browser gesture requirement) ─
  useEffect(() => {
    const resume = () => sound.resume();
    document.addEventListener('click', resume, { once: true });
    return () => document.removeEventListener('click', resume);
  }, []);

  // ── Cart persistence ──────────────────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* ignore */ }
  }, [cart, CART_KEY]);

  // ── Fullscreen mode ───────────────────────────────────────────────────────────
  useEffect(() => {
    enterPOS();
    return () => { exitPOS(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Barcode refocus ───────────────────────────────────────────────────────────
  const refocusBarcode = useCallback(() => {
    setTimeout(() => {
      // Don't steal focus if, during the 100ms window, the cashier moved into
      // another field (e.g. clicked a line discount input to override it).
      const a = document.activeElement;
      if (a && a !== barcodeRef.current &&
          (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement)) {
        return;
      }
      barcodeRef.current?.focus();
    }, 100);
  }, []);

  // ── Batch cap toast auto-dismiss ─────────────────────────────────────────────
  useEffect(() => {
    if (!batchCapToast) return;
    const t = setTimeout(() => setBatchCapToast(null), 3000);
    return () => clearTimeout(t);
  }, [batchCapToast]);

  // ── Search debounce ───────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 280);
    return () => clearTimeout(t);
  }, [search]);

  // Reset grid keyboard selection whenever the product result set changes (v1.0.60)
  useEffect(() => {
    setGridSelectedIndex(-1);
  }, [debouncedSearch, selectedCategory, warehouseId]);

  // ── Queries ───────────────────────────────────────────────────────────────────
  const { data: warehouses = [] } = useQuery({
    queryKey: ['pos-warehouses'],
    queryFn:  posApi.getWarehouses,
  });
  useEffect(() => {
    if (warehouses.length > 0 && !warehouseId) {
      const whList = warehouses as { id: string; isDefault?: boolean }[];
      // Priority 1: last-used warehouse from localStorage (if still in active list)
      const saved   = localStorage.getItem('pos_warehouse_id');
      const savedWh = saved ? whList.find(w => w.id === saved) : undefined;
      // Priority 2: warehouse marked isDefault
      const defaultWh = savedWh ?? whList.find(w => w.isDefault) ?? whList[0];
      setWarehouseId(defaultWh.id);
    }
  }, [warehouses, warehouseId]);

  // Current shift — checked per warehouse; null means no open shift → show OpenShiftModal
  const { data: currentShift, isLoading: shiftLoading } = useQuery({
    queryKey: ['current-shift', warehouseId],
    queryFn:  () => shiftsApi.current(warehouseId),
    enabled:  !!warehouseId,
    // Refetch to pick up real-time saleCount/totalSalesCents updates
    refetchInterval: 30_000,
  });

  // Derived: selected warehouse object
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selectedWarehouse = (warehouses as any[]).find(w => w.id === warehouseId);

  // Outside-click to close warehouse dropdown
  useEffect(() => {
    if (!showWhDropdown) return;
    const handler = (e: MouseEvent) => {
      if (whDropdownRef.current && !whDropdownRef.current.contains(e.target as Node)) {
        setShowWhDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showWhDropdown]);

  // Quick-add customer mutation. Phone is REQUIRED for registered customers
  // (backend Zod enforces it since P1) — validate client-side before firing
  // so the cashier gets a clear inline error, not a raw 400 mid-sale.
  const isQuickAddPhoneValid = (() => {
    const p = newCustPhone.trim();
    return p.length >= 7 && /^[+\d][\d\s-]*$/.test(p);
  })();
  const submitQuickAddCustomer = () => {
    if (!newCustName.trim()) return;
    if (!isQuickAddPhoneValid) {
      setQuickAddError('A valid phone number is required (min 7 digits)');
      return;
    }
    setQuickAddError('');
    createCustomerMutation.mutate();
  };
  const createCustomerMutation = useMutation({
    mutationFn: () => api.post('/customers', {
      name:  newCustName.trim(),
      phone: newCustPhone.trim(),
    }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setCustomer({ id: res.data.id, name: res.data.name, phone: res.data.phone ?? null });
      setShowQuickAddCustomer(false);
      setNewCustName('');
      setNewCustPhone('');
      setQuickAddError('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message ?? 'Failed to add customer';
      setQuickAddError(msg);
    },
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn:  categoriesApi.list,
    staleTime: 5 * 60_000,
  });

  const { data: brands = [] } = useQuery<Brand[]>({
    queryKey: ['brands'],
    queryFn:  brandsApi.list,
    staleTime: 5 * 60_000,
  });

  const { data: productsData, isFetching: loadingProducts } = useQuery({
    queryKey: ['pos-products', debouncedSearch, warehouseId, selectedCategory, selectedBrand],
    queryFn:  () => posApi.searchProducts({
      search:      debouncedSearch || undefined,
      warehouseId: warehouseId    || undefined,
      categoryId:  selectedCategory ?? undefined,
      brandId:     selectedBrand ?? undefined,
      pageSize:    120,
    }),
    enabled: !!warehouseId,
    staleTime: 30 * 1000, // v1.0.46 — keep stock badges reasonably fresh (30s)
  });
  const products = productsData?.data ?? [];

  // ── v1.0.46 — policy-aware available stock for a live POS product ──────────────
  // Mirrors addToCart/commitEdit cap logic: batch + BLOCK → sellableQty;
  // batch + WARN/ALLOW → total physical stock (includes expired); non-batch → total.
  const capPolicy = (appSettings?.expiredStockPolicy ?? 'BLOCK') as 'BLOCK' | 'WARN' | 'ALLOW';
  const availableStockFor = useCallback((product: PosProduct): number => {
    const bs = product.batchSummary;
    if (bs && bs.expiryStatus !== 'none') {
      return capPolicy === 'BLOCK' ? bs.sellableQty : totalStock(product);
    }
    return totalStock(product);
  }, [capPolicy]);

  // ── Totals (per spec — discount before tax) ───────────────────────────────────
  // cartSubtotalCents = Σ (lineSubtotal - itemDiscountCents)
  const cartSubtotalCents = cart.reduce(
    (s, i) => s + i.qty * i.unitPriceCents - i.itemDiscountCents, 0,
  );
  // Cart-level discount
  const cartDiscountCents = cartDiscountType === 'percent'
    ? Math.floor(cartSubtotalCents * cartDiscountValue / 100)
    : Math.min(Math.round(cartDiscountValue * 100), cartSubtotalCents);
  const taxableAmount = cartSubtotalCents - cartDiscountCents;
  // Gross tax on cartSubtotal, then scaled proportionally to taxableAmount
  const grossTaxCents = cart.reduce((s, i) => {
    const lineAfterDisc = i.qty * i.unitPriceCents - i.itemDiscountCents;
    return s + Math.floor(lineAfterDisc * (i.product.taxPercent / 100));
  }, 0);
  const effectiveTaxCents = cartSubtotalCents > 0
    ? Math.floor(grossTaxCents * taxableAmount / cartSubtotalCents)
    : 0;
  const grandTotal = taxableAmount + effectiveTaxCents;

  // Gross subtotal: full prices before any discounts (display only — math uses cartSubtotalCents)
  const cartGrossSubtotalCents = cart.reduce((s, i) => s + i.qty * i.unitPriceCents, 0);
  // Total item-level savings (sum of per-line discount cents)
  const totalItemDiscountCents = cart.reduce((s, i) => s + i.itemDiscountCents, 0);

  // ── v1.0.46 — oversell guard ──────────────────────────────────────────────────
  // True if any non-service cart line exceeds live available stock. Drives the
  // PAY NOW disabled state + warning. Backend remains the final authority.
  // v1.0.61 — Aggregate BASE-unit demand per product across ALL its cart lines
  // (a product may appear under different sales units), then compare the summed
  // base qty to live base-unit stock. Backend remains the final authority.
  const hasOversoldItem = (() => {
    const baseByProduct = new Map<string, number>();
    for (const i of cart) {
      if (i.isServiceCharge) continue;
      baseByProduct.set(
        i.product.id,
        (baseByProduct.get(i.product.id) ?? 0) + lineBaseQty(i),
      );
    }
    for (const [pid, baseQty] of baseByProduct) {
      const posProduct = products.find(p => p.id === pid);
      if (!posProduct) continue; // not in live list (filtered/svc) — let backend guard
      if (baseQty > availableStockFor(posProduct)) return true;
    }
    return false;
  })();

  // ── Cart helpers ──────────────────────────────────────────────────────────────
  const addToCart = useCallback((product: PosProduct, chosenBatch?: ProductBatch) => {
    // Block out-of-stock products
    const availableQty = totalStock(product);
    if (availableQty <= 0) {
      setQuickAddToast(`${product.name} is out of stock`);
      setTimeout(() => setQuickAddToast(null), 3000);
      setTimeout(() => barcodeRef.current?.focus(), 100);
      return;
    }
    const bs       = product.batchSummary;
    const policy   = (appSettings?.expiredStockPolicy ?? 'BLOCK') as 'BLOCK' | 'WARN' | 'ALLOW';
    const rawTotal = totalStock(product);

    // maxQty: for BLOCK → sellableQty; for WARN/ALLOW → total (includes expired)
    const maxQty = bs && bs.expiryStatus !== 'none'
      ? (policy === 'BLOCK' ? bs.sellableQty : rawTotal)
      : null;

    setCart(prev => {
      // Match on product AND batch: re-adding the same batch tops up that line,
      // while a different batch starts its own line at its own price.
      const targetKey = `${product.id}|${chosenBatch?.id ?? ''}`;
      const idx = prev.findIndex(i => !i.isServiceCharge && lineKeyOf(i) === targetKey);
      if (idx >= 0) {
        const line   = prev[idx];
        const newQty = line.qty + 1;
        // A line bound to a specific batch can only draw on THAT batch. Capping
        // against the product's total let the cashier build a line the batch
        // could never fill, and the refusal only arrived at payment.
        if (line.batchId && line.batchQty !== undefined) {
          const factor      = getBaseFactor(product, line.unitId);
          const maxFromBatch = Math.floor(line.batchQty / factor);
          if (newQty > maxFromBatch) {
            setBatchCapToast(
              maxFromBatch > 0
                ? `Only ${maxFromBatch} left in this batch — add the rest from another batch`
                : 'This batch is finished — pick another batch',
            );
            return prev;
          }
        } else if (maxQty !== null && newQty > maxQty) {
          if (maxQty === 0) {
            setBatchCapToast('No stock available');
          } else {
            setBatchCapToast(`Only ${maxQty} available`);
          }
          return prev; // don't add
        } else if (maxQty === null && newQty > availableQty) {
          // Non-batch products: cap at total physical stock
          setBatchCapToast(`Only ${availableQty} available`);
          return prev;
        }
        const next = [...prev];
        next[idx] = { ...next[idx], qty: newQty };
        return syncServiceCharges(next);
      }
      if (maxQty !== null && maxQty <= 0) {
        setBatchCapToast('No stock available');
        return prev;
      }
      // Default the line to the base/legacy unit
      const unitOpts     = getUnitOptions(product);
      const baseOpt      = unitOpts.find(o => o.isBase) ?? unitOpts[0];
      // A manually-picked batch supplies its OWN cost/price — otherwise the
      // product's usual defaults, unchanged.
      //
      // A zero batch price means "no price recorded", not "free" — batches from
      // before per-batch pricing default to 0 — so it must not win over the
      // product price. `??` would let 0 through; the explicit check does not.
      // Mirrors the same guard in the backend checkout, which sets the price
      // that is actually charged.
      const batchPrice   = (chosenBatch?.sellingPriceCents ?? 0) > 0 ? chosenBatch!.sellingPriceCents : undefined;
      const priceToUse   = isStaffSale
        ? (chosenBatch?.unitCostCents ?? product.costCents ?? product.priceCents)
        : (batchPrice ?? baseOpt.priceCents);
      // Seed the line discount from the selected unit (per-unit override) or the
      // product-level default. Cashier can override afterward.
      const seed         = discountSeedFromOption(baseOpt, product, appSettings?.posApplyDefaultDiscount !== false);
      const lineSubtotal = 1 * priceToUse;
      const seedDiscountCents = seed.itemDiscountType === 'percent'
        ? Math.floor(lineSubtotal * seed.itemDiscountValue / 100)
        : Math.min(Math.round(seed.itemDiscountValue * 100) * 1, lineSubtotal);
      const newItems: CartItem[] = [{
        product, qty: 1, unitPriceCents: priceToUse,
        originalPriceCents: product.priceCents,
        costCents: product.costCents ?? 0,
        itemDiscountType:  seed.itemDiscountType,
        itemDiscountValue: seed.itemDiscountValue,
        itemDiscountCents: seedDiscountCents,
        unitId:        baseOpt.unitId,
        unitShortCode: baseOpt.label,
        batchId:       chosenBatch?.id,
        batchQty:      chosenBatch?.qty,
      }];
      // Auto-add service charge item if configured — but only once per product.
      // A second batch line must not spawn a second charge; syncServiceCharges
      // below adjusts the existing one's qty instead.
      const svcCents = product.serviceChargeCents ?? 0;
      const svcAlreadyPresent = prev.some(i => i.isServiceCharge && i.linkedProductId === product.id);
      if (svcCents > 0 && !svcAlreadyPresent) {
        // Create a pseudo-product for the service charge line
        const svcProduct: PosProduct = {
          ...product,
          id:         `svc_${product.id}`,
          name:       product.serviceChargeLabel || 'Service Charge',
          priceCents: svcCents,
          defaultDiscountCents: 0,
          serviceChargeCents: 0,
        };
        // per_transaction: flat — svc qty always 1. Every other mode (per_unit,
        // legacy per_item/proportional, null) multiplies by the parent line qty.
        // unitPriceCents stays the flat per-unit rate — qty carries the multiplier.
        const svcQty = product.serviceChargeMode === 'per_transaction' ? 1 : newItems[0].qty;
        newItems.push({
          product: svcProduct, qty: svcQty, unitPriceCents: svcCents,
          itemDiscountType: 'percent', itemDiscountValue: 0, itemDiscountCents: 0,
          isServiceCharge: true, linkedProductId: product.id,
        });
      }
      return syncServiceCharges([...prev, ...newItems]);
    });
    refocusBarcode();
  }, [appSettings, refocusBarcode, isStaffSale]);

  // Entry point for every "add this product" action (search grid, barcode,
  // keyboard nav, quick-add).
  //
  // The picker opens on how many batches the product ACTUALLY has, not on the
  // isBatchTracked flag. Those are different things: a product can hold several
  // batches without being flagged — accepting damaged goods creates a second,
  // cheaper batch on any product — and the cashier must be able to choose which
  // one is sold rather than have FEFO decide silently. A single batch needs no
  // decision, so it is added straight away without interrupting the till.
  //
  // It re-opens EVERY time for a multi-batch product, including when the product
  // is already in the cart. That is how a quantity gets filled from more than
  // one batch: the cheap batch holds one, the cashier adds the product again and
  // picks the next batch for the rest. Picking a batch that is already on a line
  // tops that line up rather than starting a second one for the same batch.
  //
  // It must not fall through to a batch-less add once every batch is taken —
  // that produced an extra, unpriced line beyond the number of real batches.
  const handleProductClick = useCallback((product: PosProduct) => {
    // A scanned product can arrive from the barcode API fallback, which returns
    // no batch summary — batchCount would read 0 and the scan would silently
    // add a batch-less line at the product price, bypassing batch selection
    // entirely. Prefer the loaded grid's copy, which carries the summary.
    const known   = products.find(p => p.id === product.id);
    const summary = product.batchSummary ?? known?.batchSummary ?? null;

    // Unknown count → let the picker decide rather than guessing: it resolves
    // itself silently for 0 or 1 batch and only appears for 2+.
    if (!summary || summary.batchCount > 1) {
      setPendingBatchProduct(known ?? product);
      return;
    }
    addToCart(product);
  }, [addToCart, products]);

  const removeFromCart = useCallback((lineKey: string) => {
    setCart(prev => {
      const target = prev.find(i => lineKeyOf(i) === lineKey);
      if (!target) return prev;
      const productId = target.product.id;
      const remaining = prev.filter(i => lineKeyOf(i) !== lineKey);
      // The product's service charge survives while ANY of its lines remain —
      // removing one batch line of a split quantity must not drop the charge.
      const stillHasLines = remaining.some(i => !i.isServiceCharge && i.product.id === productId);
      const cleaned = stillHasLines
        ? remaining
        : remaining.filter(i => i.linkedProductId !== productId);
      return syncServiceCharges(cleaned);
    });
    refocusBarcode();
  }, [refocusBarcode]);

  const updateQty = useCallback((lineKey: string, qty: number) => {
    if (qty <= 0) { removeFromCart(lineKey); return; }

    // v1.0.61 — cap requested qty at available stock. The +/- steppers call this
    // directly and bypass CartLine's typed-input cap, so enforce it here too.
    // availableStockFor returns BASE units, but `qty` is in the line's SELECTED
    // unit (e.g. boxes). Convert: maxUnits = floor(baseAvailable / baseFactor).
    // The line's unit lives on the cart line, so resolve it from the FRESH `prev`
    // state inside the updater (updateQty's closure has no `cart` dep → stale).
    setCart(prev => {
      const targetLine = prev.find(i => lineKeyOf(i) === lineKey && !i.isServiceCharge);
      const posProduct = targetLine ? products.find(p => p.id === targetLine.product.id) : undefined;

      let cappedQty = qty;
      if (posProduct) {
        const factor = getBaseFactor(posProduct, targetLine?.unitId);

        // A batch-bound line is limited by its own batch, not by the product's
        // total stock — otherwise the cashier can type a qty this batch can
        // never fill and only finds out when payment is refused.
        const isBatchLine = !!targetLine?.batchId && targetLine.batchQty !== undefined;
        const available   = isBatchLine
          ? (targetLine!.batchQty as number)
          : availableStockFor(posProduct);   // BASE units either way

        if (available <= 0) {
          setBatchCapToast(isBatchLine ? 'This batch is finished — pick another batch' : 'No stock available');
          return prev; // no change
        }
        const maxUnits = Math.floor(available / factor);
        if (cappedQty > maxUnits) {
          cappedQty = maxUnits;
          setBatchCapToast(
            isBatchLine
              ? (maxUnits > 0
                  ? `Only ${maxUnits} left in this batch — add the rest from another batch`
                  : 'This batch is finished — pick another batch')
              : (maxUnits > 0 ? `Only ${maxUnits} available` : 'Not enough stock'),
          );
        }
        if (cappedQty <= 0) return prev; // can't fit even one whole unit
      }

      // Only the addressed line changes; service charges are recomputed after,
      // from the totals across all of that product's lines.
      const next = prev.map(i => {
        if (lineKeyOf(i) !== lineKey || i.isServiceCharge) return i;
        const newLineSubtotal = cappedQty * i.unitPriceCents;
        const newDiscountCents = i.itemDiscountType === 'percent'
          ? Math.floor(newLineSubtotal * i.itemDiscountValue / 100)
          : Math.min(Math.round(i.itemDiscountValue * 100) * cappedQty, newLineSubtotal);
        return { ...i, qty: cappedQty, itemDiscountCents: newDiscountCents };
      });
      return syncServiceCharges(next);
    });
    refocusBarcode();
  }, [removeFromCart, refocusBarcode, products, availableStockFor]);

  const clearCart = useCallback(() => {
    receiptPendingRef.current = false;   // v1.0.43 — acknowledge any pending receipt
    try { localStorage.removeItem(CART_KEY); } catch { /* ignore */ }
    sound.clear();
    setCart([]);
    setCartDiscountType('amount');
    setCartDiscountValue(0);
    setCustomer(null);
    refocusBarcode();
  }, [refocusBarcode]);

  // ── Barcode lookup ────────────────────────────────────────────────────────────
  // Focus the qty input of a (possibly just-added) cart item once state settles.
  // Component-scope (v1.0.60) so both the barcode flow and the grid can call it.
  // Focus a specific line's qty box (and select its contents) by line key —
  // used by the batch picker, which knows exactly which line it just filled.
  const focusLineQty = useCallback((lineKey: string) => {
    setTimeout(() => { cartLineRefs.current[lineKey]?.focusQty(); }, 120);
  }, []);

  // Callers know the product, not which batch line was just created, so focus
  // the LAST line for that product — the one the add produced.
  const focusNewItemQty = useCallback((productId: string) => {
    setTimeout(() => {
      setCart(current => {
        const lines = current.filter(i => !i.isServiceCharge && i.product.id === productId);
        const target = lines[lines.length - 1];
        if (target) cartLineRefs.current[lineKeyOf(target)]?.focusQty();
        return current;   // read-only use of fresh state
      });
    }, 120);
  }, []);

  const handleBarcodeEnter = useCallback(async () => {
    const code = barcodeInput.trim();
    if (!code) {
      // Empty barcode + items in cart → open payment dialog
      if (hasOversoldItem) return; // v1.0.48 — block checkout while cart oversold
      if (cart.length > 0) setShowPayment(true);
      return;
    }

    // 300ms debounce: ignore duplicate scans from scanners that send CR+LF suffix
    const now = Date.now();
    if (now - lastScanTime.current < 300) {
      setBarcodeInput('');
      return;
    }
    lastScanTime.current = now;

    setBarcodeInput('');

    // 1. Fast: search locally in the already-loaded products grid
    const localMatch = products.find(p => p.barcode === code || p.sku === code);
    if (localMatch) {
      sound.beep();
      handleProductClick(localMatch);
      focusNewItemQty(localMatch.id);
      return;
    }

    // 2. Not found locally → hit the API (covers products outside current category view)
    setBarcodeLoading(true);
    try {
      const found = await productsApi.getByBarcode(code);

      // Block adding out-of-stock product under BLOCK policy
      const policy = (appSettings?.expiredStockPolicy ?? 'BLOCK') as 'BLOCK' | 'WARN' | 'ALLOW';
      const totalQty = found.stock.reduce((sum, s) => sum + Number(s.qty), 0);
      if (policy === 'BLOCK' && totalQty <= 0) {
        sound.error();
        setQuickAddToast('This product is out of stock and cannot be sold');
        setTimeout(() => setQuickAddToast(null), 3000);
        return;
      }

      sound.beep();
      const posProduct = productToPosProduct(found);
      handleProductClick(posProduct);
      focusNewItemQty(posProduct.id);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        // 3. Truly not in DB → open QuickAddModal
        setQuickAddBarcode(code);
      } else {
        // 4. Network / server error
        sound.error();
        setQuickAddToast('Network error — could not look up barcode');
        setTimeout(() => setQuickAddToast(null), 3000);
      }
    } finally {
      setBarcodeLoading(false);
      // Only refocus barcode if we didn't focus qty (i.e. 404 path or error)
    }
  }, [barcodeInput, cart.length, products, handleProductClick, refocusBarcode, appSettings, hasOversoldItem, focusNewItemQty]);

  // ── Grid keyboard navigation (v1.0.60) ─────────────────────────────────────────
  // Count of columns currently rendered in the auto-fill product grid, so Up/Down
  // arrows move by a full row. Falls back to 1 if the grid isn't measurable yet.
  const getGridColumns = useCallback((): number => {
    const el = gridRef.current;
    if (!el) return 1;
    const cols = window.getComputedStyle(el).gridTemplateColumns;
    const n = cols.split(' ').filter(Boolean).length;
    return n > 0 ? n : 1;
  }, []);

  const handleGridKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (products.length === 0) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      setGridSelectedIndex(-1);
      barcodeRef.current?.focus();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation(); // prevent window keydown handler from opening payment
      const idx = gridSelectedIndex;
      if (idx >= 0 && idx < products.length) {
        const p = products[idx];
        sound.beep();
        handleProductClick(p);
        focusNewItemQty(p.id);
        // Return to a clean state: clear the name filter + grid highlight
        setSearch('');
        setGridSelectedIndex(-1);
      }
      return;
    }

    let next = gridSelectedIndex;
    const cols = getGridColumns();
    const last = products.length - 1;

    if (e.key === 'ArrowRight')      { e.preventDefault(); next = next < 0 ? 0 : Math.min(next + 1, last); }
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); next = next < 0 ? 0 : Math.max(next - 1, 0); }
    else if (e.key === 'ArrowDown')  { e.preventDefault(); next = next < 0 ? 0 : Math.min(next + cols, last); }
    else if (e.key === 'ArrowUp')    {
      e.preventDefault();
      if (next - cols < 0) { setGridSelectedIndex(-1); barcodeRef.current?.focus(); return; }
      next = next - cols;
    }
    else return;

    setGridSelectedIndex(next);
  }, [products, gridSelectedIndex, getGridColumns, handleProductClick, focusNewItemQty]);

  // ── Hold helpers ──────────────────────────────────────────────────────────────
  const holdBill = useCallback((label: string) => {
    if (cart.length === 0) { setShowHoldModal(false); return; }
    try {
      const newHold: HoldBill = {
        id:                newHoldId(),
        label:             label || (customer?.name ?? 'Walk-in'),
        cart,
        cartDiscountType,
        cartDiscountValue,
        customer,
        savedAt:           new Date().toISOString(),
      };
      const next = [...holds, newHold];
      setHolds(next);
      saveHoldsToStorage(next);
      clearCart();
      setShowHoldModal(false);
    } catch (err) {
      console.error('[v1.0.71 holdBill] failed:', err);
      setBatchCapToast('Could not hold bill. Please try again.');
      setShowHoldModal(false);
    }
  }, [cart, cartDiscountType, cartDiscountValue, customer, holds, clearCart]);

  const resumeHold = useCallback((h: HoldBill) => {
    setCart(h.cart);
    setCartDiscountType(h.cartDiscountType ?? 'amount');
    setCartDiscountValue(h.cartDiscountValue ?? 0);
    setCustomer(h.customer);
    const remaining = holds.filter(x => x.id !== h.id);
    setHolds(remaining);
    saveHoldsToStorage(remaining);
    setShowHolds(false);
    refocusBarcode();
  }, [holds, refocusBarcode]);

  const deleteHold = useCallback((id: string) => {
    const remaining = holds.filter(h => h.id !== id);
    setHolds(remaining);
    saveHoldsToStorage(remaining);
  }, [holds]);

  // ── Checkout mutation ─────────────────────────────────────────────────────────
  const [pendingReceivedCents, setPendingReceivedCents] = useState(0);

  const checkoutMutation = useMutation({
    mutationFn: (payload: Parameters<typeof posApi.checkout>[0]) => posApi.checkout(payload),
    onSuccess: (data) => {
      sound.success();
      // Guard: ensure receipt data exists. If the server returns 200 with a
      // missing/malformed body, the sale was still recorded — close the
      // payment modal and show a safe fallback receipt state instead of
      // throwing (which would leave the cashier on a blank screen).
      if (!data?.receipt) {
        setLastReceipt(null);
        setShowPayment(false);
        setShowReceipt(true);
        return;
      }
      // Augment receipt: split service-charge amounts back out as separate lines for display.
      // Guarded (v1.0.42): only augment when receipt.lines is a valid non-empty array, and
      // wrap the whole flatMap in try/catch. A throw here would be caught by TanStack Query
      // and rerouted to onError — suppressing the receipt popup even though the sale committed.
      // On any failure we fall back to the raw receipt so the popup always shows.
      const svcItems = cart.filter(i => i.isServiceCharge);

      const canAugment =
        svcItems.length > 0 &&
        Array.isArray(data.receipt.lines) &&
        data.receipt.lines.length > 0;

      if (canAugment) {
        try {
          const productLines: typeof data.receipt.lines = [];
          const svcLines: typeof data.receipt.lines = [];

          data.receipt.lines.forEach(line => {
            const svc = svcItems.find(sc => sc.linkedProductId === line.product?.id);
            if (!svc) {
              productLines.push(line);
              return;
            }
            const svcCents = svc.unitPriceCents;
            const mainUnit = line.unitPriceCents - svcCents;
            // Product line with service charge removed from unit price
            productLines.push({ ...line, unitPriceCents: mainUnit, lineTotalCents: mainUnit * line.qty });
            // Service charge line: qty=1 for clean display, unit price = actual
            // total svc amount (svcCents × qty), so receipt shows qty=1/price=amount.
            const actualSvcAmount = svcCents * Number(line.qty);
            svcLines.push({
              product:        { id: svc.product.id, name: svc.product.name, sku: svc.product.sku, receiptName: svc.product.receiptName },
              qty:            1,
              unitPriceCents: actualSvcAmount,
              taxPercent:     0,
              discountCents:  0,
              lineTotalCents: actualSvcAmount,
            });
          });

          const augLines = [...productLines, ...svcLines];
          setLastReceipt({ ...data.receipt, lines: augLines, promotions: data.promotions, loyalty: data.loyalty });
        } catch {
          // Augmentation failed — use receipt as-is, never block the popup
          setLastReceipt({ ...data.receipt, promotions: data.promotions, loyalty: data.loyalty });
        }
      } else {
        setLastReceipt({ ...data.receipt, promotions: data.promotions, loyalty: data.loyalty });
      }
      const changeCents = pendingReceivedCents > 0 ? Math.max(0, pendingReceivedCents - data.receipt.totalCents) : 0;
      setLastChangeCents(changeCents);
      setRedeemPoints(0); // consumed by this sale
      // v1.0.72 — persist a pointer to this completed sale so "Last Receipt"
      // can re-open/reprint it even after a page reload.
      const saleInfo: LastSaleInfo = { id: data.receipt.id, number: data.receipt.number, changeCents };
      setLastSaleInfo(saleInfo);
      try { localStorage.setItem(LAST_RECEIPT_KEY, JSON.stringify(saleInfo)); } catch { /* ignore */ }
      setShowPayment(false);
      setShowReceipt(true);
      // Success toast
      setQuickAddToast(`✓ Sale ${data.receipt.number} completed`);
      setTimeout(() => setQuickAddToast(null), 2000);
      // Surface any checkout warnings (e.g. expired batches sold under WARN policy)
      if (data.warnings && data.warnings.length > 0) {
        setBatchCapToast(data.warnings.join(' · '));
      }
      qc.invalidateQueries({ queryKey: ['pos-products'] });
      // v1.0.43 — mark this sale's receipt as pending acknowledgement (cleared on New Sale)
      receiptPendingRef.current = true;
    },
    onError: (err: unknown) => {
      sound.error();
      // Detect a connection timeout separately. On a timeout the backend may
      // have already committed the sale, so we must NOT silently re-prompt for
      // payment. Close the payment modal and warn the cashier to verify before
      // re-ringing (avoids duplicate sales).
      const e = err as { code?: string; message?: string };
      const isTimeout = e?.code === 'ECONNABORTED' || (e?.message?.includes('timeout') ?? false);
      if (isTimeout) {
        setShowPayment(false);
        setCheckoutError(
          'Connection timed out. The sale may have been recorded. ' +
          'Please check Sales before processing again to avoid duplicate sales.'
        );
        // Do NOT call setShowReceipt(true) — we have no receipt data to show.
        return;
      }

      // v1.0.43 — Detect an expired session (401). The cashier's JWT lapsed
      // before this checkout, so the sale almost certainly was NOT recorded.
      // Close the payment modal and tell them to re-authenticate, but warn
      // them to verify Sales in case the request did land server-side.
      const isUnauthorized = (err as { response?: { status?: number } })?.response?.status === 401;
      if (isUnauthorized) {
        setShowPayment(false);
        setCheckoutError(
          'Your session has expired. Please sign out and sign back in to continue. ' +
          'The last sale may not have been recorded — check Sales.'
        );
        return;
      }

      const data = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
      const msg =
        data?.message
        ?? data?.error
        ?? (err as { message?: string })?.message
        ?? 'Payment failed. Please try again.';
      setQuickAddToast(`⚠ ${msg}`);
      setTimeout(() => setQuickAddToast(null), 7000);
      // do NOT call setShowPayment(false) — leave modal open so cashier can choose differently
    },
  });

  const updateItemDiscount = useCallback((lineKey: string, type: 'percent' | 'amount', value: number) => {
    setCart(prev => prev.map(i => {
      if (lineKeyOf(i) !== lineKey) return i;
      const lineSubtotal   = i.qty * i.unitPriceCents;
      const discountCents  = type === 'percent'
        ? Math.floor(lineSubtotal * value / 100)
        : Math.min(Math.round(value * 100) * i.qty, lineSubtotal);
      return { ...i, itemDiscountType: type, itemDiscountValue: value, itemDiscountCents: discountCents };
    }));
  }, []);

  // Change the sales unit for a cart line. Updates unitId + label and (unless
  // in staff-sale mode, which prices at cost) the unit price, then ALWAYS
  // re-seeds the line discount from the target unit (per-unit override wins;
  // else product default) and recomputes against the new subtotal.
  const changeCartUnit = useCallback((lineKey: string, unitId: string) => {
    setCart(prev => prev.map(i => {
      if (lineKeyOf(i) !== lineKey || i.isServiceCharge) return i;
      const opt = getUnitOptions(i.product).find(o => o.unitId === unitId);
      if (!opt) return i;
      const newUnitPrice   = isStaffSale ? i.unitPriceCents : opt.priceCents;
      const seed           = discountSeedFromOption(opt, i.product, appSettings?.posApplyDefaultDiscount !== false);
      const newLineSubtotal = i.qty * newUnitPrice;
      const newDiscountCents = seed.itemDiscountType === 'percent'
        ? Math.floor(newLineSubtotal * seed.itemDiscountValue / 100)
        : Math.min(Math.round(seed.itemDiscountValue * 100) * i.qty, newLineSubtotal);
      return {
        ...i,
        unitId:            opt.unitId,
        unitShortCode:     opt.label,
        unitPriceCents:    newUnitPrice,
        itemDiscountType:  seed.itemDiscountType,
        itemDiscountValue: seed.itemDiscountValue,
        itemDiscountCents: newDiscountCents,
      };
    }));
  }, [isStaffSale]);

  const handleCheckout = useCallback((method: AllPaymentMethods, receivedCents = 0, cashAmountCents?: number) => {
    if (!warehouseId || cart.length === 0) return;
    setPendingReceivedCents(receivedCents);
    const payload = {
      warehouseId,
      customerId:          customer?.id,
      paymentMethod:       method,
      cartDiscountCents,
      cartDiscountPercent: cartDiscountType === 'percent' ? cartDiscountValue : 0,
      isStaffSale:         isStaffSale && isAdmin,
      ...(loyaltyOn && customer && redeemPoints > 0
          && redeemPoints >= (loyaltyConfig?.minRedeemPoints ?? 1)
          && redeemPoints <= (customerLoyalty?.balance ?? 0)
          ? { redeemPoints } : {}),
      // Split payment: cash portion paid now, remainder is credit/outstanding
      ...(cashAmountCents && cashAmountCents > 0 ? { cashAmountCents } : {}),
      items: cart
        .filter(i => !i.isServiceCharge)
        .map((i, idx, sellable) => {
          // Service charge folded into unitPriceCents — see cartLines.ts for the
          // rule (one charge per product, on its first line, divided by qty so
          // the backend's unitPrice x qty re-multiplies back to the total).
          const svcPerUnit = serviceChargePerUnitFor(i, idx, sellable, cart);
          return {
            productId:      i.product.id,
            qty:            i.qty,
            unitId:         i.unitId,
            unitPriceCents: i.unitPriceCents + svcPerUnit,
            discountCents:  i.itemDiscountCents,
            batchId:        i.batchId,
          };
        }),
    } satisfies Parameters<typeof posApi.checkout>[0];
    checkoutMutation.mutate(payload);
  }, [warehouseId, cart, customer, cartDiscountCents, cartDiscountType, cartDiscountValue, isStaffSale, isAdmin, checkoutMutation, loyaltyOn, redeemPoints]);

  const newSale = useCallback(() => {
    receiptPendingRef.current = false;   // v1.0.43 — cashier acknowledged the receipt
    clearCart();
    setIsStaffSale(false);
    setShowReceipt(false);
  }, [clearCart]);

  // v1.0.43 — Receipt recovery safety net. If a completed sale's receipt popup
  // closes before the cashier acknowledges it, re-open it so the sale is never
  // silently lost from view. NOTE (v1.0.72 correction): every CURRENT close
  // path — New Sale, the modal X, and Esc — acknowledges via newSale()/clearCart(),
  // which clear receiptPendingRef first, so today this net only catches future
  // close paths that forget to acknowledge. It also cannot survive a page
  // reload (the ref dies with the page) — see the beforeunload guard below.
  useEffect(() => {
    if (receiptPendingRef.current && !showReceipt && lastReceipt !== null) {
      setShowReceipt(true);
    }
  }, [showReceipt, lastReceipt]);

  // v1.0.72 — Block accidental reload/close while a checkout is in flight
  // (covers Ctrl+R and window close in both browser and Electron): the sale
  // may commit server-side while the client loses the receipt.
  useEffect(() => {
    if (!checkoutMutation.isPending) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [checkoutMutation.isPending]);

  const handleStaffSaleChange = useCallback((checked: boolean) => {
    setIsStaffSale(checked);
    setCart(prev => prev.map(item => {
      if (item.isServiceCharge) return item;
      return {
        ...item,
        unitPriceCents: checked
          ? (item.costCents ?? item.unitPriceCents)
          : (item.originalPriceCents ?? item.unitPriceCents),
      };
    }));
  }, []);

  // v1.0.72 — shared print path for both the live post-sale modal and the
  // Reprint Last Receipt view. The window MUST be opened synchronously, before
  // any await: window.open after an await can outlive the transient user
  // activation (or hit a popup blocker / Electron window-open policy) and
  // return null — which previously returned silently, so Print appeared to
  // "do nothing" with no feedback to the cashier.
  const printReceiptDoc = useCallback(async (receipt: Receipt, changeCents: number) => {
    if (!appSettings) return;
    const win = window.open('', '_blank', 'width=420,height=640');
    if (!win) {
      setQuickAddToast('⚠ Print window was blocked — allow pop-ups for this app and try again.');
      setTimeout(() => setQuickAddToast(null), 5000);
      return;
    }
    win.document.write('<p style="font-family:system-ui,sans-serif;padding:16px;color:#334155">Preparing receipt…</p>');
    let logoBase64: string | null = null;
    if (appSettings.receiptShowLogo && appSettings.logoUrl) {
      logoBase64 = await fetchLogoAsBase64(appSettings.logoUrl, useAuthStore.getState().accessToken);
    }
    const html = generateReceiptHtml(receipt, appSettings, changeCents, logoBase64);
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 600);
  }, [appSettings]);

  const printReceipt = useCallback(async () => {
    if (!lastReceipt) return;
    await printReceiptDoc(lastReceipt, lastChangeCents);
  }, [lastReceipt, lastChangeCents, printReceiptDoc]);

  // v1.0.72 — open the last completed sale in a read-only ReceiptModal.
  // Uses the in-memory receipt when it matches (no network); otherwise
  // re-fetches via GET /pos/receipt/:id — so it works after a page reload.
  const openLastReceipt = useCallback(async () => {
    if (!lastSaleInfo || reprintLoading) return;
    if (lastReceipt && lastReceipt.id === lastSaleInfo.id) {
      setReprintChangeCents(lastChangeCents);
      setReprintReceipt(lastReceipt);
      return;
    }
    setReprintLoading(true);
    try {
      const receipt = await posApi.getReceipt(lastSaleInfo.id);
      setReprintChangeCents(lastSaleInfo.changeCents ?? 0);
      setReprintReceipt(receipt);
    } catch {
      setQuickAddToast(`⚠ Could not load receipt ${lastSaleInfo.number}. Check Sales history.`);
      setTimeout(() => setQuickAddToast(null), 5000);
    } finally {
      setReprintLoading(false);
    }
  }, [lastSaleInfo, reprintLoading, lastReceipt, lastChangeCents]);

  // ── Auto-focus barcode when shift becomes active ──────────────────────────────
  // Depend on the shift IDENTITY (currentShift?.id), not the whole object, so the
  // 30s refetch (which returns a fresh reference for live sale counts) does not
  // re-fire this. Also skip when another input/select is focused so we never steal
  // focus from a cashier mid-edit (e.g. typing a per-line discount override).
  useEffect(() => {
    if (!currentShift || !barcodeRef.current) return;
    const a = document.activeElement;
    if (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement) return;
    barcodeRef.current.focus();
  }, [currentShift?.id]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag     = (e.target as HTMLElement).tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // v1.0.72 — F4/F5/F8 are POS workflow keys whose browser defaults are
      // destructive here (F5 = page reload). Previously, when any dialog was
      // open EXCEPT the receipt modal, these keys fell through the anyDialog
      // gate below WITHOUT preventDefault — so F5 pressed while the payment
      // dialog was processing reloaded the page mid-checkout: the sale still
      // committed server-side but the receipt was lost and the cart restored
      // from localStorage (duplicate re-ring risk). Swallow the default in
      // EVERY state; the branches below decide what (if anything) to do.
      if (e.key === 'F4' || e.key === 'F5' || e.key === 'F8') e.preventDefault();

      // ── Always-fires: F1, Ctrl+Shift+X, Ctrl+Shift+O ─────────────────────────

      // F8 in receipt modal → print
      if (e.key === 'F8' && showReceipt) {
        e.preventDefault();
        printReceipt();
        return;
      }

      // F5 in receipt modal → new sale (no confirm needed — sale is done)
      if (e.key === 'F5' && showReceipt) {
        e.preventDefault();
        newSale();
        return;
      }

      // F1 — toggle shortcuts panel
      if (e.key === 'F1') {
        e.preventDefault();
        setShowShortcuts(prev => !prev);
        return;
      }

      // Ctrl+Shift+X — ADMIN/MANAGER: exit POS immediately; CASHIER: close shift → sign out
      if (e.ctrlKey && e.shiftKey && e.key === 'X') {
        e.preventDefault();
        if (isAdmin) {
          exitPOS();
          navigate('/');
        } else if (currentShift) {
          setExitAfterShiftClose(true);
          setShowCloseShift(true);
        }
        return;
      }

      // Ctrl+Shift+O — open shift (OpenShiftModal appears automatically when needed)
      if (e.ctrlKey && e.shiftKey && e.key === 'O') {
        e.preventDefault();
        return;
      }

      // Escape — close topmost modal/panel
      if (e.key === 'Escape') {
        if (showCloseShift)       { setShowCloseShift(false);       return; }
        if (showPayment)          { if (checkoutMutation.isPending) return; setShowPayment(false); return; }
        if (showHoldModal)        { setShowHoldModal(false);        return; }
        if (showShortcuts)        { setShowShortcuts(false);        return; }
        if (showExitBlocked)      { setShowExitBlocked(false);      return; }
        if (showSignOutShift)     { setShowSignOutShift(false);     return; }
        if (showQuickAddCustomer) { setShowQuickAddCustomer(false); return; }
        if (quickAddBarcode)      { setQuickAddBarcode(null);       return; }
        if (showHolds)            { setShowHolds(false);            return; }
        // Reprint view is read-only — closing it must NOT clear the cart
        // (unlike the live post-sale receipt modal below).
        if (reprintReceipt)       { setReprintReceipt(null); refocusBarcode(); return; }
        if (showReceipt)          { clearCart(); setCustomer(null); setCartDiscountValue(0); setCartDiscountType('amount'); setShowReceipt(false); refocusBarcode(); return; }
        if (showCustomer)         { setShowCustomer(false);         return; }
        refocusBarcode();
        return;
      }

      // ── Don't fire remaining shortcuts when typing in an input ────────────────
      // Exception: F4 (Hold), F5 (Cancel), F8 (Pay Now) are workflow shortcuts
      // that must fire even when the barcode bar is focused. They are not
      // character keys so they cannot conflict with SKU/barcode typing.
      // Dialog-suppression still applies — these keys are gated by anyDialog
      // (next check below).
      if (inInput && e.key !== 'F4' && e.key !== 'F5' && e.key !== 'F8') return;

      const anyDialog = showCloseShift || showSignOutShift || showPayment || showHoldModal || showShortcuts
        || showExitBlocked || showQuickAddCustomer || showHolds
        || showReceipt || showCustomer || showCancelConfirm || showReturn || !!quickAddBarcode
        || !!reprintReceipt;
      if (anyDialog) return;

      // F2 — focus barcode/scanner input
      if (e.key === 'F2') {
        e.preventDefault();
        barcodeRef.current?.focus();
        return;
      }

      // F4 — hold current cart
      if (e.key === 'F4') {
        e.preventDefault();
        if (cart.length > 0) setShowHoldModal(true);
        return;
      }

      // F5 — cancel current sale (with confirmation)
      if (e.key === 'F5') {
        e.preventDefault();
        if (cart.length > 0) setShowCancelConfirm(true);
        return;
      }

      // F8 — open checkout / pay now
      if (e.key === 'F8') {
        e.preventDefault();
        if (hasOversoldItem) return; // v1.0.47 — block checkout while cart oversold
        if (cart.length > 0 && !showPayment) setShowPayment(true);
        return;
      }

      // + / = — increase qty of last cart item
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        if (cart.length > 0) {
          const last = cart[cart.length - 1];
          updateQty(lineKeyOf(last), last.qty + 1);
        }
        return;
      }

      // - — decrease qty of last cart item
      if (e.key === '-') {
        e.preventDefault();
        if (cart.length > 0) {
          const last = cart[cart.length - 1];
          if (last.qty > 1) updateQty(lineKeyOf(last), last.qty - 1);
          else removeFromCart(lineKeyOf(last));
        }
        return;
      }

      // Delete — remove last cart item
      if (e.key === 'Delete' || e.key === 'Del') {
        e.preventDefault();
        if (cart.length > 0) {
          const last = cart[cart.length - 1];
          removeFromCart(lineKeyOf(last));
        }
        return;
      }

      // L — open drafts list
      if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        setShowHolds(true);
        return;
      }

      // Enter — open payment dialog if cart has items
      if (e.key === 'Enter') {
        const active = document.activeElement;
        const isInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
        if (!isInput && cart.length > 0) {
          e.preventDefault();
          if (hasOversoldItem) return; // v1.0.47 — block checkout while cart oversold
          setShowPayment(true);
          return;
        }
      }

      // Any printable character outside an input → route focus to barcode
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const active  = document.activeElement;
        const isInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
        if (!isInput) barcodeRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showCloseShift, showSignOutShift, showPayment, showHoldModal, showShortcuts, showExitBlocked, showQuickAddCustomer,
      showHolds, showReceipt, showCustomer, showCancelConfirm, showReturn, quickAddBarcode, reprintReceipt,
      cart, user, clearCart, refocusBarcode, updateQty, removeFromCart, currentShift, printReceipt, newSale,
      checkoutMutation.isPending, hasOversoldItem]);

  // ── Render ────────────────────────────────────────────────────────────────────
  // Use live shift data from API (has real-time saleCount / totalSalesCents)
  // Fall back to store data for the time display if API hasn't loaded yet
  const liveShift      = currentShift ?? null;
  const shiftTimeStr   = liveShift?.openedAt ?? shiftOpenedAt;
  const shiftTime      = shiftTimeStr
    ? new Date(shiftTimeStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const shiftSalesStr  = liveShift
    ? `· ${currencySymbol} ${(liveShift.totalSalesCents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} · ${liveShift.saleCount} sales`
    : '';

  // If warehouse is selected and shift query has returned with no open shift → block POS
  const selectedWarehouseName = (warehouses as { id: string; name: string }[]).find(w => w.id === warehouseId)?.name ?? 'Warehouse';
  const needsShiftOpen = !!warehouseId && !shiftLoading && currentShift === null;

  return (
    <div
      className="h-screen w-screen overflow-hidden bg-slate-50"
      style={{ display: 'grid', gridTemplateRows: 'auto 1fr' }}
    >
      {/* Block POS and prompt cashier to open a shift */}
      {needsShiftOpen && (
        <OpenShiftModal
          warehouseId={warehouseId}
          warehouseName={selectedWarehouseName}
          onShiftOpened={(shift) => {
            storeOpenShift(shift.id);
            qc.setQueryData(['current-shift', warehouseId], shift);
          }}
        />
      )}
      {/* ═══════════════════════════════════════════════════════════════
          TOP BAR
      ═══════════════════════════════════════════════════════════════ */}
      <header className="bg-white border-b border-slate-200 px-4 flex items-center gap-3 shrink-0" style={{ height: 52 }}>

        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <ShoppingCart size={17} className="text-indigo-600" />
          <span className="font-bold text-slate-800 text-sm tracking-tight">BROcode ERP POS</span>
          {shiftTime && (
            <span className="flex items-center gap-1 text-[10px] bg-indigo-50 border border-indigo-200 text-indigo-600 px-2 py-0.5 rounded-full font-medium">
              <Clock size={9} /> Shift since {shiftTime}{shiftSalesStr}
            </span>
          )}
        </div>

        {/* Separator */}
        <div style={{ width: 1, height: 20, background: '#e2e8f0', flexShrink: 0 }} />

        {/* Warehouse custom dropdown */}
        <div ref={whDropdownRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" onClick={() => setShowWhDropdown(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, border: '.5px solid #e2e8f0', borderRadius: 6, padding: '5px 10px', fontSize: 12, color: '#1e293b', background: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <Building2 size={13} style={{ color: '#94a3b8' }} />
            {selectedWarehouse
              ? `${selectedWarehouse.isDefault ? '★ ' : ''}${selectedWarehouse.name} (${selectedWarehouse.code || String(selectedWarehouse.name).slice(0, 4).toUpperCase()})`
              : 'Warehouse'}
            <ChevronDown size={11} style={{ color: '#94a3b8' }} />
          </button>
          {showWhDropdown && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff', border: '.5px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,.08)', zIndex: 50, minWidth: 200, padding: 4 }}>
              {warehouses.map(w => (
                <button key={w.id} type="button"
                  onClick={() => { setWarehouseId(w.id); setShowWhDropdown(false); try { localStorage.setItem('pos_warehouse_id', w.id); } catch { /* ignore */ } }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '7px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 5,
                    color: w.id === warehouseId ? '#4338ca' : '#1e293b',
                    fontWeight: w.id === warehouseId ? 500 : 400,
                    background: 'transparent', border: 'none',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f0f4ff'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
                  {w.isDefault ? '★ ' : ''}{w.name} ({w.code || String(w.name).slice(0, 4).toUpperCase()})
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Customer pill */}
        <button type="button" onClick={() => setShowCustomer(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
            border: customer ? '.5px solid #a5b4fc' : '.5px solid #e2e8f0',
            borderRadius: 6, padding: '5px 10px', fontSize: 12,
            color: '#1e293b', background: customer ? '#f0f4ff' : '#fff', cursor: 'pointer',
          }}>
          <User size={13} style={{ color: customer ? '#6366f1' : '#94a3b8' }} />
          {customer
            ? (customer.name.length > 16 ? customer.name.slice(0, 16) + '…' : customer.name)
            : 'Walk-in'}
          <ChevronDown size={11} style={{ color: '#94a3b8' }} />
        </button>

        {/* Add Customer [👤+] */}
        <button type="button" onClick={() => { setNewCustName(''); setNewCustPhone(''); setQuickAddError(''); setShowQuickAddCustomer(true); }}
          title="Add new customer"
          style={{ width: 30, height: 30, border: '.5px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          onMouseEnter={e => { const el = e.currentTarget; el.style.background = '#f0f4ff'; el.style.borderColor = '#818cf8'; }}
          onMouseLeave={e => { const el = e.currentTarget; el.style.background = '#fff'; el.style.borderColor = '#e2e8f0'; }}>
          <UserPlus size={14} style={{ color: '#64748b' }} />
        </button>

        <div className="flex-1" />

        {/* Cashier name */}
        <span className="text-xs text-slate-400 hidden sm:block shrink-0">{user?.fullName}</span>

        {/* Quick Sales Return — opens the shared return modal in search mode */}
        <button type="button"
          onClick={() => { setReturnPrefillId(undefined); setShowReturn(true); }}
          title="Process a sales return"
          className="flex items-center gap-1.5 px-3 py-1.5 border border-orange-200 rounded-lg text-xs font-medium text-orange-600 hover:bg-orange-50 transition shrink-0">
          <RotateCcw size={13} /> Return
        </button>

        {/* Exit POS — all roles */}
        <button type="button" onClick={() => {
          if (isAdmin) {
            exitPOS();
            navigate('/');
          } else if (currentShift) {
            setExitAfterShiftClose(true);
            setShowCloseShift(true);
          } else {
            exitPOS();
            logout();
            navigate('/login');
          }
        }}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition shrink-0">
          <LogOut size={13} /> Exit POS
        </button>

        {/* Sign out — visible to ALL roles */}
        <button type="button" onClick={handleLogout}
          title="Sign out"
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 transition shrink-0">
          <LogOut size={13} />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </header>

      {/* ═══════════════════════════════════════════════════════════════
          MAIN: products | drag handle | cart — split is user-resizable
          and remembered across sessions (localStorage).
      ═══════════════════════════════════════════════════════════════ */}
      <div
        ref={panelContainerRef}
        className="overflow-hidden"
        style={{ display: 'grid', gridTemplateColumns: `${leftPanelWidth}px ${PANEL_HANDLE_WIDTH}px 1fr` }}
      >

        {/* ─── LEFT PANEL: products ─────────────────────────────────── */}
        <div className="flex flex-col overflow-hidden border-r border-slate-200 bg-slate-50">

          {/* Search + barcode row */}
          <div className="bg-white border-b border-slate-200 px-4 py-3 space-y-2 shrink-0">
            {/* Category + Brand filters — compact dropdowns above the search bars
                so they don't consume vertical space as categories/brands grow. */}
            {(categories.length > 0 || brands.length > 0) && (
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <Layers size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <select
                    value={selectedCategory ?? ''}
                    onChange={e => setSelectedCategory(e.target.value || null)}
                    className="w-full appearance-none pl-8 pr-7 py-1.5 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white transition cursor-pointer"
                  >
                    <option value="">All Categories</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
                <div className="relative">
                  <Tag size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <select
                    value={selectedBrand ?? ''}
                    onChange={e => setSelectedBrand(e.target.value || null)}
                    className="w-full appearance-none pl-8 pr-7 py-1.5 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white transition cursor-pointer"
                  >
                    <option value="">All Brands</option>
                    {brands.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </div>
            )}

            {/* Barcode scanner input */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={barcodeRef}
                type="text"
                value={barcodeInput}
                onChange={e => setBarcodeInput(e.target.value)}
                onKeyDown={e => {
                  // v1.0.60: Down arrow → move into the product grid for keyboard
                  // selection of products that have no barcode. Carry whatever was
                  // typed into the name-search box so the grid filters to it.
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (barcodeInput.trim()) setSearch(barcodeInput.trim());
                    setBarcodeInput('');
                    setGridSelectedIndex(0);
                    setTimeout(() => gridRef.current?.focus(), 50);
                    return;
                  }
                  if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault();
                    totalDiscountRef.current?.focus();
                    totalDiscountRef.current?.select();
                    return;
                  }
                  if (e.key === 'Enter') handleBarcodeEnter();
                }}
                placeholder="Scan barcode or enter SKU → press Enter"
                disabled={barcodeLoading}
                className="w-full pl-8 pr-28 py-2 text-sm border border-indigo-200 rounded-lg bg-indigo-50/40 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white transition disabled:opacity-60"
              />
              {barcodeLoading
                ? <span className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin" />
                : <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-300 font-mono">BARCODE</span>
              }
            </div>

            {/* Product text search */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by product name…"
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white transition"
              />
            </div>

          </div>

          {/* Product grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {loadingProducts && (
              <div className="flex items-center justify-center gap-2 h-32 text-slate-400 text-sm">
                <div className="w-4 h-4 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
                Loading products…
              </div>
            )}
            {!loadingProducts && products.length === 0 && (
              <div className="flex flex-col items-center justify-center h-32 text-slate-400 gap-2">
                <ShoppingCart size={32} className="text-slate-300" />
                <span className="text-sm">No products found</span>
              </div>
            )}
            {products.length > 0 && (
              <div
                ref={gridRef}
                tabIndex={-1}
                onKeyDown={handleGridKeyDown}
                className="grid gap-3 outline-none"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(144px, 1fr))' }}
              >
                {products.map((p, idx) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    isSelected={idx === gridSelectedIndex}
                    onAdd={() => { handleProductClick(p); focusNewItemQty(p.id); setSearch(''); setGridSelectedIndex(-1); }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ─── Quick bar — relocated under the product grid (left column only)
               so the checkout column reclaims the full-width footer's height.
               Shortcut handlers (F1/F4/L/Ctrl+Shift+X) live in the global
               keydown effect — independent of where these buttons render. ── */}
          <footer className="shrink-0" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#f8fafc', borderTop: '.5px solid #e2e8f0' }}>

            {/* Hold — F4 */}
            <button type="button"
              onClick={() => { if (cart.length > 0) setShowHoldModal(true); }}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '.5px solid #e2e8f0', borderRadius: 6, background: '#fff', fontSize: 12, color: '#1e293b', cursor: 'pointer', opacity: cart.length === 0 ? 0.4 : 1 }}>
              ⏸ Hold
              <span style={{ fontSize: 10, color: '#94a3b8', background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, border: '.5px solid #e2e8f0' }}>F4</span>
            </button>

            {/* Drafts — L */}
            <button type="button"
              onClick={() => setShowHolds(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '.5px solid #e2e8f0', borderRadius: 6, background: '#fff', fontSize: 12, color: '#1e293b', cursor: 'pointer' }}>
              📋 Drafts
              {holds.length > 0 && (
                <span style={{ background: '#6366f1', color: '#fff', fontSize: 9, fontWeight: 700, borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{holds.length}</span>
              )}
              <span style={{ fontSize: 10, color: '#94a3b8', background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, border: '.5px solid #e2e8f0' }}>L</span>
            </button>

            {/* Last Receipt — v1.0.72 reprint escape hatch (survives page reload) */}
            <button type="button"
              onClick={openLastReceipt}
              disabled={!lastSaleInfo || reprintLoading}
              title={lastSaleInfo ? `Reopen ${lastSaleInfo.number}` : 'No completed sale yet'}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '.5px solid #e2e8f0', borderRadius: 6, background: '#fff', fontSize: 12, color: '#1e293b', cursor: lastSaleInfo && !reprintLoading ? 'pointer' : 'not-allowed', opacity: lastSaleInfo ? 1 : 0.4 }}>
              🧾 {reprintLoading ? 'Loading…' : 'Last Receipt'}
            </button>

            {/* Right side */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {/* Shortcuts — F1 */}
              <button type="button"
                onClick={() => setShowShortcuts(prev => !prev)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px',
                  border: showShortcuts ? '.5px solid #818cf8' : '.5px solid #e2e8f0',
                  borderRadius: 6,
                  background: showShortcuts ? '#eef2ff' : '#fff',
                  fontSize: 12, color: showShortcuts ? '#4338ca' : '#64748b', cursor: 'pointer',
                }}>
                ⌨ Shortcuts
                <span style={{ fontSize: 10, color: '#94a3b8', background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, border: '.5px solid #e2e8f0' }}>F1</span>
              </button>

              {/* Close Shift — Ctrl+Shift+X */}
              <button type="button"
                onClick={() => setShowCloseShift(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '.5px solid #fca5a5', borderRadius: 6, background: '#fff', fontSize: 12, color: '#dc2626', cursor: 'pointer' }}>
                ⏱ Close Shift
                <span style={{ fontSize: 10, color: '#fca5a5', background: '#fff1f2', padding: '1px 4px', borderRadius: 3, border: '.5px solid #fecaca' }}>⌃⇧X</span>
              </button>
            </div>
          </footer>
        </div>

        {/* ─── DRAG HANDLE ──────────────────────────────────────────── */}
        <div
          onMouseDown={handlePanelResizeStart}
          onTouchStart={handlePanelResizeStart}
          onDoubleClick={() => {
            const rect = panelContainerRef.current?.getBoundingClientRect();
            if (rect) setLeftPanelWidth(clampPanelWidth(Math.round(rect.width * DEFAULT_PANEL_RATIO), rect.width));
          }}
          title="Drag to resize · double-click to reset"
          style={{ touchAction: 'none' }}
          className={`group relative cursor-col-resize select-none ${isResizingPanels ? 'bg-indigo-400' : 'bg-slate-200 hover:bg-indigo-300'} transition-colors`}
        >
          {/* Widened invisible grab area — 6px is fine for a mouse but far too
              thin for a fingertip. Overhangs only the panels' own padding. */}
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 rounded-full bg-slate-400 group-hover:bg-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {/* ─── RIGHT PANEL: cart ────────────────────────────────────── */}
        <div className="flex flex-col overflow-hidden bg-white">

          {/* Cart header */}
          <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 font-bold text-slate-800">
              <ShoppingCart size={17} className="text-indigo-500" />
              Cart
              {cart.length > 0 && (
                <>
                  <span className="bg-indigo-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center"
                        title="Total quantity">
                    {cart.reduce((s, i) => s + i.qty, 0)}
                  </span>
                  <span className="text-[11px] font-medium text-slate-400"
                        title="Distinct line items">
                    {cart.length} {cart.length === 1 ? 'item' : 'items'}
                  </span>
                </>
              )}
            </div>
            {customer && (
              <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium px-2.5 py-1 rounded-full">
                <User size={11} /> {customer.name}
                <button type="button" onClick={() => setCustomer(null)} className="text-indigo-400 hover:text-indigo-600 ml-0.5">
                  <X size={10} />
                </button>
              </div>
            )}
          </div>

          {/* Cart items — scrollable */}
          {/* Batch cap toast */}
          {batchCapToast && (
            <div className="mx-3 mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs font-medium text-amber-800 flex items-center gap-2">
              <span>⚠</span> {batchCapToast}
            </div>
          )}

          {/* Expired-items warning banner (WARN policy) */}
          {(appSettings?.expiredStockPolicy ?? 'BLOCK') === 'WARN' &&
           cart.some(i => (i.product.batchSummary?.expiredQty ?? 0) > 0) && (
            <div className="mx-3 mt-2 px-3 py-2 bg-orange-50 border border-orange-300 rounded-lg text-xs font-semibold text-orange-800 flex items-center gap-2">
              <span>⚠️</span> Cart contains expired items — manager approval required
            </div>
          )}

          <div className="flex-1 overflow-hidden px-3 py-2">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-300 gap-2">
                <ShoppingCart size={44} />
                <p className="text-sm">Cart is empty</p>
                <p className="text-xs text-slate-200">Scan a barcode or tap a product</p>
              </div>
            ) : (
              // Framed, scrollable table card — the scroll lives here so the dark
              // header can stay pinned (sticky) and the rounded corners clip cleanly.
              <div
                className="h-full overflow-y-auto"
                style={{ borderRadius: 12, border: '1px solid #e2e8f0', background: '#fff', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}
              >
                {/* Fixed dark column-header — aligns with every CartLine via CART_GRID */}
                <div
                  className="sticky top-0 z-10 text-[10px] font-bold uppercase"
                  style={{
                    display: 'grid', gridTemplateColumns: CART_GRID, columnGap: 0,
                    background: 'linear-gradient(180deg,#1e293b,#0f172a)',
                    color: '#e2e8f0', letterSpacing: '0.05em',
                    borderRadius: '12px 12px 0 0',
                    boxShadow: '0 2px 5px rgba(15,23,42,0.25)',
                  }}
                >
                  <span style={{ padding: '9px 10px', borderRight: CART_HDR_BORDER }}>Item</span>
                  <span style={{ padding: '9px 6px', borderRight: CART_HDR_BORDER, textAlign: 'center' }}>Unit</span>
                  <span style={{ padding: '9px 10px', borderRight: CART_HDR_BORDER, textAlign: 'right' }}>Price</span>
                  <span style={{ padding: '9px 6px', borderRight: CART_HDR_BORDER, textAlign: 'center' }}>Qty</span>
                  <span style={{ padding: '9px 6px', borderRight: CART_HDR_BORDER, textAlign: 'center' }}>Disc</span>
                  <span style={{ padding: '9px 10px', borderRight: CART_HDR_BORDER, textAlign: 'right' }}>Disc&nbsp;Tot</span>
                  <span style={{ padding: '9px 10px', borderRight: CART_HDR_BORDER, textAlign: 'right' }}>Total</span>
                  <span style={{ padding: '9px 2px' }} />
                </div>
                {cart.map(item => (
                  <CartLine
                    key={lineKeyOf(item)}
                    ref={el => { cartLineRefs.current[lineKeyOf(item)] = el; }}
                    item={item}
                    onChange={qty => updateQty(lineKeyOf(item), qty)}
                    onRemove={() => removeFromCart(lineKeyOf(item))}
                    onBatchCap={msg => setBatchCapToast(msg)}
                    onUpdateDiscount={(type, value) => updateItemDiscount(lineKeyOf(item), type, value)}
                    onNavigateToBarcode={refocusBarcode}
                    onChangeUnit={unitId => changeCartUnit(lineKeyOf(item), unitId)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Totals + PAY NOW */}
          <div className="border-t border-slate-200 px-4 pt-2 pb-2.5 space-y-1 shrink-0 bg-white">
            {/* Gross subtotal — full prices before any discounts */}
            <div className="flex justify-between text-sm text-slate-500">
              <span>Subtotal</span>
              <span className="font-medium text-slate-700">{formatCents(cartGrossSubtotalCents)}</span>
            </div>

            {/* Cart-level discount — toggle [%][₨] + DiscountInput.
                Hidden entirely when manual discounts are turned off in Settings. */}
            {appSettings?.posAllowDiscount !== false && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <span className="text-sm text-slate-500">Discount</span>
                <button
                  type="button"
                  onClick={() => { setCartDiscountType('percent'); setCartDiscountValue(0); }}
                  style={{
                    padding: '1px 5px', fontSize: 10, borderRadius: 3, cursor: 'pointer', fontWeight: 600,
                    background: cartDiscountType === 'percent' ? '#e0e7ff' : '#f1f5f9',
                    color:      cartDiscountType === 'percent' ? '#4338ca' : '#64748b',
                    border: cartDiscountType === 'percent' ? '1px solid #a5b4fc' : '1px solid #cbd5e1',
                  }}
                >%</button>
                <button
                  type="button"
                  onClick={() => { setCartDiscountType('amount'); setCartDiscountValue(0); }}
                  style={{
                    padding: '1px 5px', fontSize: 10, borderRadius: 3, cursor: 'pointer', fontWeight: 600,
                    background: cartDiscountType === 'amount' ? '#e0e7ff' : '#f1f5f9',
                    color:      cartDiscountType === 'amount' ? '#4338ca' : '#64748b',
                    border: cartDiscountType === 'amount' ? '1px solid #a5b4fc' : '1px solid #cbd5e1',
                  }}
                >₨</button>
              </div>
              <div className="flex items-center gap-1.5">
                {cartDiscountCents > 0 && (
                  <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>
                    -{formatCents(cartDiscountCents)}
                  </span>
                )}
                <DiscountInput
                  ref={totalDiscountRef}
                  mode={cartDiscountType}
                  value={cartDiscountValue}
                  maxAmount={cartSubtotalCents}
                  onChange={v => setCartDiscountValue(v)}
                  onEnter={() => { if (hasOversoldItem) return; if (cart.length > 0) setShowPayment(true); }}
                />
              </div>
            </div>
            )}

            {/* You Saved — sum of all item discounts + cart discount */}
            {(totalItemDiscountCents + cartDiscountCents) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-green-700 font-medium">You Saved</span>
                <span className="text-green-700 font-semibold">-{formatCents(totalItemDiscountCents + cartDiscountCents)}</span>
              </div>
            )}

            {/* Tax — show only when non-zero */}
            {effectiveTaxCents > 0 && (
              <div className="flex justify-between text-sm text-slate-500">
                <span>Tax</span>
                <span>{formatCents(effectiveTaxCents)}</span>
              </div>
            )}

            {/* Staff Sale toggle — visible only when feature is enabled and user is ADMIN/MANAGER */}
            {appSettings?.staffSalesEnabled && isAdmin && (
              <label className={`flex items-center gap-2.5 cursor-pointer select-none px-3 py-1.5 rounded-lg transition ${isStaffSale ? 'bg-violet-50 border border-violet-200' : 'bg-slate-50 border border-transparent'}`}>
                <input
                  type="checkbox"
                  checked={isStaffSale}
                  onChange={e => handleStaffSaleChange(e.target.checked)}
                  className="w-4 h-4 rounded accent-violet-600 cursor-pointer"
                />
                <span className={`text-sm font-medium ${isStaffSale ? 'text-violet-700' : 'text-slate-600'}`}>
                  Staff Sale
                </span>
                {isStaffSale && (
                  <span className="ml-auto text-[10px] font-semibold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">
                    Tagged
                  </span>
                )}
              </label>
            )}

            {/* v1.0.46 — oversell warning above PAY NOW */}
            {hasOversoldItem && (
              <p className="text-xs text-red-600 text-center mb-2 font-medium">
                ⚠ Cart contains items exceeding available stock. Reduce quantities before checkout.
              </p>
            )}

            {/* TOTAL · CANCEL · PAY NOW — single row, 3 columns (compact footer) */}
            <div className="mt-1" style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.85fr 1.3fr', gap: 8, alignItems: 'stretch' }}>
              {/* TOTAL — premium dark band, cohesive with the cart header */}
              <div
                className="flex flex-col justify-center rounded-xl px-3 py-2"
                style={{ background: 'linear-gradient(135deg,#1e293b,#0f172a)', boxShadow: '0 4px 14px rgba(15,23,42,0.18)' }}
              >
                <span className="text-[10px] font-bold tracking-[0.18em] text-slate-400 leading-none">TOTAL</span>
                <span className="text-2xl font-black text-white leading-tight" style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' }}>{formatCents(grandTotal)}</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (cart.length > 0) setShowCancelConfirm(true);
                }}
                disabled={cart.length === 0 || checkoutMutation.isPending}
                className={cls(
                  'rounded-xl font-semibold border-2 border-red-500 text-red-600 bg-white',
                  'hover:bg-red-50 active:bg-red-100 transition-colors',
                  'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white',
                  'flex flex-col items-center justify-center gap-0.5 px-2',
                )}
                aria-label="Cancel sale (F5)"
              >
                <span className="flex items-center gap-1.5"><X className="w-4 h-4" /> CANCEL</span>
                <kbd className="text-[10px] bg-red-50 border border-red-200 text-red-600 rounded px-1 font-mono">F5</kbd>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (cart.length === 0 || !warehouseId || hasOversoldItem) return;
                  setShowPayment(true);
                }}
                disabled={cart.length === 0 || !warehouseId || checkoutMutation.isPending || hasOversoldItem}
                className={cls(
                  'font-bold text-lg rounded-xl flex flex-col items-center justify-center gap-0.5 px-2 transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
                  cart.length === 0 || !warehouseId
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : hasOversoldItem
                      ? 'bg-red-500 cursor-not-allowed text-white opacity-75'
                      : 'bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-100 active:scale-[0.98]',
                )}
              >
                {checkoutMutation.isPending
                  ? <span className="flex items-center gap-2 text-base"><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processing…</span>
                  : <>
                      <span className="flex items-center gap-1.5"><CheckCircle size={18} /> PAY NOW</span>
                      <kbd className="text-[10px] bg-white/20 border border-white/30 rounded px-1 font-mono">F8</kbd>
                    </>
                }
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          DIALOGS / MODALS
      ═══════════════════════════════════════════════════════════════ */}

      {showPayment && (
        <PaymentDialog
          totalCents={grandTotal}
          onConfirm={(method, receivedCents = 0, cashAmountCents) => handleCheckout(method, receivedCents, cashAmountCents)}
          onClose={() => setShowPayment(false)}
          isPending={checkoutMutation.isPending}
          customer={customer}
          canSellOnCredit={canSellOnCredit}
          loyaltyEnabled={loyaltyOn && (loyaltyConfig?.isEnabled ?? false)}
          customerPoints={customerLoyalty?.balance ?? 0}
          pointValueCents={loyaltyConfig?.pointValueCents ?? 0}
          minRedeemPoints={loyaltyConfig?.minRedeemPoints ?? 0}
          redeemPoints={redeemPoints}
          setRedeemPoints={setRedeemPoints}
        />
      )}

      {showReceipt && (
        lastReceipt ? (
          <ReceiptModal
            receipt={lastReceipt}
            changeCents={lastChangeCents}
            onNewSale={newSale}
            onClose={() => { clearCart(); setCustomer(null); setCartDiscountValue(0); setCartDiscountType('amount'); setShowReceipt(false); refocusBarcode(); }}
            onPrint={printReceipt}
            onReturn={() => {
              // Acknowledge the receipt (clears cart, closes popup, stops the
              // recovery effect) then open the shared return modal prefilled with
              // the just-completed sale — "return what I just sold" in one click.
              setReturnPrefillId(lastReceipt.id);
              newSale();
              setShowReturn(true);
            }}
          />
        ) : (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
              <div className="text-center p-8">
                <div className="text-green-600 text-xl font-bold mb-2">
                  ✓ Payment Recorded
                </div>
                <p className="text-gray-600 mb-6">
                  Sale completed successfully. Receipt data unavailable.
                </p>
                <button
                  type="button"
                  onClick={() => { setShowReceipt(false); newSale(); }}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2.5 text-sm font-bold transition"
                >
                  New Sale
                </button>
              </div>
            </div>
          </div>
        )
      )}

      {/* v1.0.72 — Reprint Last Receipt: read-only view of the last completed
          sale. Reuses ReceiptModal but with non-destructive handlers — closing
          it never clears the in-progress cart and never touches
          receiptPendingRef / lastReceipt (unlike the live post-sale modal). */}
      {reprintReceipt && !showReceipt && (
        <ReceiptModal
          receipt={reprintReceipt}
          changeCents={reprintChangeCents}
          readOnly
          onNewSale={() => { setReprintReceipt(null); refocusBarcode(); }}
          onClose={() => { setReprintReceipt(null); refocusBarcode(); }}
          onPrint={() => printReceiptDoc(reprintReceipt, reprintChangeCents)}
          onReturn={() => {
            setReturnPrefillId(reprintReceipt.id);
            setReprintReceipt(null);
            setShowReturn(true);
          }}
        />
      )}

      {showHoldModal && (
        <HoldModal
          onConfirm={holdBill}
          onClose={() => setShowHoldModal(false)}
        />
      )}

      {showCancelConfirm && (
        <CancelConfirmModal
          onConfirm={() => { clearCart(); setShowCancelConfirm(false); }}
          onClose={() => setShowCancelConfirm(false)}
        />
      )}

      {showHolds && (
        <HoldsPanel
          holds={holds}
          onResume={resumeHold}
          onDelete={deleteHold}
          onClose={() => setShowHolds(false)}
        />
      )}

      {showCustomer && (
        <CustomerPicker
          selected={customer}
          onSelect={setCustomer}
          onClose={() => setShowCustomer(false)}
        />
      )}

      {showReturn && (
        <NewReturnModal
          prefillSaleId={returnPrefillId}
          onClose={() => { setShowReturn(false); setReturnPrefillId(undefined); refocusBarcode(); }}
        />
      )}

      {showQuickAddCustomer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <UserPlus size={16} className="text-indigo-500" /> Add Customer
            </h3>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Full Name *</label>
                <input
                  autoFocus
                  value={newCustName}
                  onChange={e => setNewCustName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') submitQuickAddCustomer();
                    if (e.key === 'Escape') setShowQuickAddCustomer(false);
                  }}
                  placeholder="Customer name"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Phone *</label>
                <input
                  required aria-required="true"
                  maxLength={20}
                  value={newCustPhone}
                  onChange={e => { setNewCustPhone(e.target.value); if (quickAddError) setQuickAddError(''); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') submitQuickAddCustomer();
                    if (e.key === 'Escape') setShowQuickAddCustomer(false);
                  }}
                  placeholder="Phone number"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              {quickAddError && <p className="text-xs text-red-500">{quickAddError}</p>}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowQuickAddCustomer(false)}
                className="flex-1 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="button"
                onClick={submitQuickAddCustomer}
                disabled={!newCustName.trim() || !isQuickAddPhoneValid || createCustomerMutation.isPending}
                className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition">
                {createCustomerMutation.isPending ? 'Adding…' : 'Add & Select'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showExitBlocked && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowExitBlocked(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6 text-center" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <LogOut size={22} className="text-red-500" />
            </div>
            <h3 className="font-bold text-slate-800 mb-1">Exit Not Allowed</h3>
            <p className="text-sm text-slate-500 mb-4">Contact your manager to exit POS mode.</p>
            <button type="button" onClick={() => setShowExitBlocked(false)}
              className="px-5 py-2 bg-slate-800 text-white rounded-xl text-sm font-semibold hover:bg-slate-700 transition">
              OK
            </button>
          </div>
        </div>
      )}

      {/* Close Shift & Sign Out modal */}
      {showSignOutShift && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
          onClick={() => { if (!signOutPending) setShowSignOutShift(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800 text-lg mb-1">Close Shift &amp; Sign Out</h3>
            <p className="text-sm text-slate-500 mb-4">
              You have an open shift. Close your shift before signing out.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Closing Cash (Rs.)
                </label>
                <input
                  type="number" min="0" step="0.01"
                  value={signOutCash}
                  onChange={e => setSignOutCash(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-right font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  Notes (optional)
                </label>
                <input
                  type="text"
                  value={signOutNote}
                  onChange={e => setSignOutNote(e.target.value)}
                  placeholder="Add a note…"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              {signOutError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {signOutError}
                </p>
              )}
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowSignOutShift(false)} disabled={signOutPending}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition">
                Cancel
              </button>
              <button type="button" onClick={handleSignOutWithClose}
                disabled={signOutPending || signOutCash === ''}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition">
                {signOutPending ? 'Closing…' : 'Close Shift & Sign Out'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showShortcuts && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          {/* Clickable backdrop (only right panel area is interactive) */}
          <div
            className="absolute inset-0 pointer-events-auto"
            onClick={() => setShowShortcuts(false)}
          />
          {/* Slide-in panel from the right */}
          <div
            className="absolute top-0 right-0 h-full bg-white shadow-2xl border-l border-slate-200 flex flex-col pointer-events-auto overflow-y-auto"
            style={{ width: 320 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
              <span className="font-bold text-slate-800 text-sm">Keyboard Shortcuts</span>
              <button
                type="button"
                onClick={() => setShowShortcuts(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
              >
                <X size={15} />
              </button>
            </div>

            {/* Grouped shortcut rows */}
            <div className="p-4 space-y-5 flex-1">
              {(
                [
                  { label: 'SALES', keys: [
                    { key: 'F2',  desc: 'Focus scanner / barcode' },
                    { key: 'F5',  desc: 'Cancel current sale' },
                    { key: 'F8',  desc: 'Pay now' },
                    { key: 'F4',  desc: 'Hold current cart' },
                    { key: 'Esc', desc: 'Close any open modal' },
                  ]},
                  { label: 'CART ITEMS', keys: [
                    { key: '+',   desc: 'Add 1 to last item qty' },
                    { key: '-',   desc: 'Remove 1 from last item qty' },
                    { key: 'Del', desc: 'Remove last item from cart' },
                  ]},
                  { label: 'DRAFTS', keys: [
                    { key: 'L',   desc: 'Open drafts list' },
                  ]},
                  { label: 'SHIFT', keys: [
                    { key: 'Ctrl+Shift+O', desc: 'Open shift' },
                    { key: 'Ctrl+Shift+X', desc: 'Close shift' },
                  ]},
                  { label: 'HELP', keys: [
                    { key: 'F1',  desc: 'Toggle this panel' },
                  ]},
                ] as { label: string; keys: { key: string; desc: string }[] }[]
              ).map(({ label, keys }) => (
                <div key={label}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.08em', marginBottom: 8, textTransform: 'uppercase' }}>
                    {label}
                  </p>
                  <div className="space-y-1.5">
                    {keys.map(({ key, desc }) => (
                      <div key={key + desc} className="flex items-center justify-between gap-3">
                        <span style={{ fontSize: 12, color: '#475569', flex: 1 }}>{desc}</span>
                        <kbd style={{
                          fontSize: 10, background: '#f1f5f9', color: '#334155',
                          border: '1px solid #cbd5e1',
                          padding: '2px 7px', borderRadius: 4,
                          fontFamily: 'monospace', whiteSpace: 'nowrap', flexShrink: 0,
                        }}>{key}</kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Close Shift Modal */}
      {showCloseShift && liveShift && (
        <CloseShiftModal
          shift={liveShift}
          onClose={() => { setShowCloseShift(false); setExitAfterShiftClose(false); }}
          onShiftClosed={() => {
            storeCloseShift();
            qc.setQueryData(['current-shift', warehouseId], null);
            setShowCloseShift(false);
            if (exitAfterShiftClose) {
              setExitAfterShiftClose(false);
              exitPOS();
              logout();
              navigate('/login');
            } else {
              setQuickAddToast('✓ Shift closed');
              setTimeout(() => setQuickAddToast(null), 3000);
            }
          }}
        />
      )}

      {/* QuickAdd Modal — unknown barcode → create product on the fly */}
      {quickAddBarcode && (
        <QuickAddModal
          barcode={quickAddBarcode}
          onSuccess={(product) => {
            setQuickAddBarcode(null);
            sound.beep();
            handleProductClick(productToPosProduct(product));
            setQuickAddToast(`"${product.name}" added. Complete details in Products page later.`);
            setTimeout(() => setQuickAddToast(null), 4000);
            refocusBarcode();
          }}
          onCancel={() => {
            setQuickAddBarcode(null);
            refocusBarcode();
          }}
        />
      )}

      {/* Batch picker — mounted whenever a multi-batch product is added;
          resolves itself silently for 0/1 batches, or shows a picker. */}
      {pendingBatchProduct && (
        <BatchPickerModal
          productId={pendingBatchProduct.id}
          warehouseId={warehouseId}
          productName={pendingBatchProduct.name}
          qtyNeeded={1}
          fallbackPriceCents={pendingBatchProduct.priceCents}
          alreadyInCart={cart.reduce<Record<string, number>>((acc, i) => {
            // Base units already taken from each batch by this sale, so the
            // picker offers what is left rather than the full shelf quantity.
            if (i.isServiceCharge || !i.batchId || i.product.id !== pendingBatchProduct.id) return acc;
            acc[i.batchId] = (acc[i.batchId] ?? 0) + i.qty * getBaseFactor(i.product, i.unitId);
            return acc;
          }, {})}
          onSelect={(batch) => {
            const product = pendingBatchProduct;
            setPendingBatchProduct(null);
            addToCart(product, batch ?? undefined);
            // Focus the exact line this pick landed on — topping up an existing
            // batch line must select ITS qty box, not the most recently added.
            focusLineQty(`${product.id}|${batch?.id ?? ''}`);
          }}
          onClose={() => setPendingBatchProduct(null)}
        />
      )}

      {/* Checkout timeout warning — persists until dismissed; shown over the
          main POS view after the payment modal closes on a timeout. */}
      {checkoutError && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[80] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 text-center">
            <div className="text-amber-600 text-lg font-bold mb-2">⚠ Verify Sale</div>
            <p className="text-slate-600 text-sm mb-6">{checkoutError}</p>
            <button
              type="button"
              onClick={() => setCheckoutError(null)}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-2.5 text-sm font-bold transition"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* QuickAdd / barcode-error toast */}
      {quickAddToast && (
        <div
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[70] bg-slate-800 text-white text-xs font-medium rounded-xl px-4 py-3 shadow-2xl flex items-center gap-2 max-w-sm"
          style={{ whiteSpace: 'nowrap' }}
        >
          <CheckCircle size={13} className="text-green-400 shrink-0" />
          <span className="truncate">{quickAddToast}</span>
          <button onClick={() => setQuickAddToast(null)} className="text-slate-400 hover:text-white ml-1 shrink-0">
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
