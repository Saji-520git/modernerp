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
} from 'lucide-react';
import {
  posApi, formatCents, daysUntilExpiry,
  type PosProduct, type Receipt, type AllPaymentMethods,
} from '../../services/pos';
import DiscountInput, { type DiscountInputHandle } from '../../components/pos/DiscountInput';
import { categoriesApi, type Category } from '../../services/masterData';
import { shiftsApi } from '../../services/shifts';
import { useAppSettings } from '../../context/SettingsContext';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { usePosStore } from '../../store/posStore';
import OpenShiftModal from '../../components/pos/OpenShiftModal';
import CloseShiftModal from '../../components/pos/CloseShiftModal';
import ThermalReceipt from '../../components/pos/ThermalReceipt';
import QuickAddModal from '../../components/pos/QuickAddModal';
import { productsApi, type Product } from '../../services/products';
import axios from 'axios';
import { generateReceiptHtml } from '../../utils/generateReceiptHtml';

// ─── Audio engine ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (_audioCtx) return _audioCtx;
  try { _audioCtx = new AudioCtxClass(); return _audioCtx; } catch { return null; }
}
function beep(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.13) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator(); const g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.frequency.value = freq; osc.type = type;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur);
  } catch { /* ignore */ }
}
const sfx = {
  add:      () => beep(880, 0.07),
  remove:   () => beep(300, 0.09, 'triangle', 0.1),
  checkout: () => { beep(523, 0.09); setTimeout(() => beep(659, 0.09), 100); setTimeout(() => beep(784, 0.18), 200); },
  error:    () => beep(180, 0.14, 'sawtooth', 0.1),
};

// ─── Shortcut map ─────────────────────────────────────────────────────────────

const POS_SHORTCUTS = [
  { group: 'SALES',      key: 'F2',           action: 'Focus barcode / scanner' },
  { group: 'SALES',      key: 'F4',           action: 'Hold current cart' },
  { group: 'SALES',      key: 'F5',           action: 'New sale / clear cart' },
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

interface CartItem {
  product:            PosProduct;
  qty:                number;
  unitPriceCents:     number;
  itemDiscountType:   'percent' | 'amount';
  itemDiscountValue:  number;  // % or display-currency amount
  itemDiscountCents:  number;  // computed cents
  isServiceCharge?:   boolean; // service charge line (display only — excluded from checkout items)
  linkedProductId?:   string;  // product ID this service charge belongs to
}

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

/** Display qty: whole numbers as integers, decimals to 3 places (e.g. 0.500 kg) */
function fmtQty(qty: number): string {
  return Number.isInteger(qty) ? qty.toString() : qty.toFixed(3);
}

const HOLDS_KEY = 'pos_holds_v2';
function loadHolds(): HoldBill[] {
  try { return JSON.parse(localStorage.getItem(HOLDS_KEY) ?? '[]') as HoldBill[]; }
  catch { return []; }
}
function saveHoldsToStorage(holds: HoldBill[]) {
  try { localStorage.setItem(HOLDS_KEY, JSON.stringify(holds)); } catch { /* ignore */ }
}

// ─── ProductCard ──────────────────────────────────────────────────────────────

function ProductCard({ product, onAdd }: { product: PosProduct; onAdd: () => void }) {
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
    sfx.add();
    onAdd();
  }

  return (
    <>
      <button
        type="button"
        disabled={isDisabled}
        onClick={handleClick}
        className="relative flex flex-col rounded-xl border text-left transition-all active:scale-95 bg-white border-slate-200 hover:border-indigo-400 hover:shadow-md"
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
          <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 4,
            background: badgeBg, color: badgeColor, flexShrink: 0 }}>
            {trueOut ? 'OUT' : displayQty}
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
                onClick={() => { setShowConfirm(false); sfx.add(); onAdd(); }}
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

const CartLine = forwardRef<CartLineHandle, {
  item: CartItem;
  onChange: (qty: number) => void;
  onRemove: () => void;
  onBatchCap?: (msg: string) => void;
  onUpdateDiscount: (type: 'percent' | 'amount', value: number) => void;
  onNavigateToBarcode: () => void;
}>(function CartLine({
  item, onChange, onRemove, onBatchCap, onUpdateDiscount, onNavigateToBarcode,
}, cartLineRef) {
  const { settings: cartSettings } = useAppSettings();
  const cartPolicy = (cartSettings?.expiredStockPolicy ?? 'BLOCK') as 'BLOCK' | 'WARN' | 'ALLOW';

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
    background: '#f1f5f9', border: '.5px solid #cbd5e1',
    borderRadius: 6, padding: '3px 10px',
    fontSize: 13, fontWeight: 600,
    width: 52, textAlign: 'center', color: '#1e1b4b',
  };

  return (
    <div className="mb-1.5">
      {/* Fix 4: single grid row — name | qty | unit-price | line-total | trash */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto auto auto auto',
        gap: 8,
        alignItems: 'center',
        padding: '8px 14px',
        background: 'white',
        borderRadius: 8,
        border: '1px solid #f1f5f9',
      }}>
        {/* Product name — service charge gets amber styling */}
        <span className={`text-sm font-semibold truncate ${item.isServiceCharge ? 'text-amber-700' : 'text-slate-800'}`}>
          {item.isServiceCharge && <span style={{ fontSize: 9, marginRight: 4, background: '#fef3c7', color: '#b45309', padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>SVC</span>}
          {item.product.name}
        </span>

        {/* Editable qty box — service charge items show fixed qty (not editable) */}
        {item.isServiceCharge ? (
          <span style={{ ...qtyBoxStyle, cursor: 'default', opacity: 0.6 }}>1</span>
        ) : editing ? (
          <input
            ref={inputRef}
            type="number"
            min="0.001"
            step="0.001"
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
            style={{ ...qtyBoxStyle, outline: 'none', cursor: 'text' }}
          />
        ) : (
          <button type="button" onClick={startEdit} style={{ ...qtyBoxStyle, cursor: 'pointer' }}>
            {fmtQty(item.qty)}
          </button>
        )}

        {/* Unit price — muted, 12px */}
        <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>
          {formatCents(item.unitPriceCents)}
        </span>

        {/* Line total — bold */}
        <span style={{ fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', minWidth: 60, textAlign: 'right' }}>
          {formatCents(lineTotal)}
        </span>

        {/* Trash — hidden for auto service-charge lines (removed when parent is removed) */}
        {!item.isServiceCharge && (
          <button type="button" onClick={() => { sfx.remove(); onRemove(); }}
            className="text-slate-300 hover:text-red-600 transition shrink-0">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* Amber warning when qty was capped to max stock */}
      {cappedAt !== null && (
        <p style={{ fontSize: 11, color: '#854F0B', padding: '1px 14px 0' }}>
          Only {cappedAt} in stock
        </p>
      )}

      {/* Per-item discount row — hidden for service charge items; shown when discount exists or being edited */}
      {!item.isServiceCharge && (showDiscount || editing) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '2px 14px 4px',
        }}>
          <span style={{ fontSize: 10, color: '#94a3b8', marginRight: 2 }}>Item disc.</span>
          {/* Type toggle: % / Rs. */}
          <button
            type="button"
            onClick={() => onUpdateDiscount('percent', 0)}
            style={{
              padding: '1px 5px', fontSize: 10, borderRadius: 3, cursor: 'pointer', fontWeight: 600,
              background: item.itemDiscountType === 'percent' ? '#e0e7ff' : '#f1f5f9',
              color:      item.itemDiscountType === 'percent' ? '#4338ca' : '#94a3b8',
              border: item.itemDiscountType === 'percent' ? '1px solid #a5b4fc' : '1px solid #e2e8f0',
            }}
          >%</button>
          <button
            type="button"
            onClick={() => onUpdateDiscount('amount', 0)}
            style={{
              padding: '1px 5px', fontSize: 10, borderRadius: 3, cursor: 'pointer', fontWeight: 600,
              background: item.itemDiscountType === 'amount' ? '#e0e7ff' : '#f1f5f9',
              color:      item.itemDiscountType === 'amount' ? '#4338ca' : '#94a3b8',
              border: item.itemDiscountType === 'amount' ? '1px solid #a5b4fc' : '1px solid #e2e8f0',
            }}
          >₨</button>
          <DiscountInput
            ref={discountRef}
            mode={item.itemDiscountType}
            value={item.itemDiscountValue}
            maxAmount={lineSubtotal}
            onChange={(v) => { onUpdateDiscount(item.itemDiscountType, v); }}
            onEnter={onNavigateToBarcode}
          />
          {item.itemDiscountCents > 0 && (
            <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, marginLeft: 2 }}>
              -{formatCents(item.itemDiscountCents)}
            </span>
          )}
        </div>
      )}
      {/* For items without active discount, show a small "D" hint when in qty-edit mode */}
      {!item.isServiceCharge && !showDiscount && !editing && item.itemDiscountCents === 0 && (
        <div style={{ padding: '0 14px 2px' }}>
          <button
            type="button"
            onClick={() => setShowDiscount(true)}
            style={{ fontSize: 9, color: '#cbd5e1', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
          >
            + disc
          </button>
        </div>
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
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6">
        <h3 className="font-bold text-slate-800 mb-1 flex items-center gap-2">
          <Save size={16} className="text-indigo-500" /> Hold Current Bill
        </h3>
        <p className="text-sm text-slate-500 mb-4">Give this bill a label to find it easily later.</p>
        <input autoFocus value={label} onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onConfirm(label); if (e.key === 'Escape') onClose(); }}
          placeholder="e.g. Table 3, Customer name…"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-4" />
        <div className="flex gap-2">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={() => onConfirm(label)}
            className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition">
            Hold Bill
          </button>
        </div>
      </div>
    </div>
  );
}

// DiscountModal removed — replaced by inline DiscountInput in cart + totals panel

// ─── PaymentDialog ────────────────────────────────────────────────────────────

function PaymentDialog({
  totalCents, onConfirm, onClose, isPending, customer,
}: {
  totalCents: number;
  onConfirm: (method: AllPaymentMethods, receivedCents?: number) => void;
  onClose: () => void;
  isPending: boolean;
  customer: CustomerOption | null;
}) {
  const [activeTab, setActiveTab]     = useState<PayTab>('CASH');
  const [tabsFocused, setTabsFocused] = useState(true);
  const [received, setReceived]       = useState(() => (totalCents / 100).toFixed(2));
  const [splitCash, setSplitCash]     = useState('');
  const [splitSecondary, setSplitSecondary] = useState<'CARD' | 'BANK_TRANSFER' | 'QR_PAY'>('CARD');
  const [creditNote, setCreditNote]   = useState('');

  const tabRefs    = useRef<(HTMLButtonElement | null)[]>([]);
  const amountRef  = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const creditOkForTab = customer?.creditEnabled === true;

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
    if (!canConfirm || isPending) return;
    if (activeTab === 'CASH')   { onConfirm('CASH', receivedCents); return; }
    if (activeTab === 'CARD')   { onConfirm('CARD'); return; }
    if (activeTab === 'BANK')   { onConfirm('BANK_TRANSFER'); return; }
    if (activeTab === 'QR_PAY') { onConfirm('QR_PAY'); return; }
    if (activeTab === 'SPLIT')  { onConfirm('CASH', splitCashC); return; }
    if (activeTab === 'CREDIT') { onConfirm('CREDIT'); return; }
  };

  // Focus first tab on open
  useEffect(() => {
    setTabsFocused(true);
    setTimeout(() => tabRefs.current[0]?.focus(), 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zone-based keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }

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
  }, [tabsFocused, activeTab, available, onClose]);

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
          </div>

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
                </select>
              </div>
              <div className={cls(
                'rounded-xl px-4 py-2 text-sm text-center font-medium',
                splitValid ? 'bg-green-50 text-green-700 border border-green-200'
                           : 'bg-slate-50 text-slate-500 border border-slate-200',
              )}>
                {splitCashC > 0
                  ? splitValid
                    ? `${formatCents(splitCashC)} cash + ${formatCents(splitRemainder)} via ${splitSecondary === 'CARD' ? 'Card' : splitSecondary === 'BANK_TRANSFER' ? 'Bank' : 'QR Pay'} ✓`
                    : `Remaining: ${formatCents(splitRemainder)} via ${splitSecondary === 'CARD' ? 'Card' : splitSecondary === 'BANK_TRANSFER' ? 'Bank' : 'QR Pay'}`
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
  receipt, changeCents, onNewSale, onClose, onPrint,
}: {
  receipt: Receipt;
  changeCents: number;
  onNewSale: () => void;
  onClose: () => void;
  onPrint: () => void;
}) {
  const { settings } = useAppSettings();

  if (!settings) return null;

  const pmLabel: Record<string, string> = {
    CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank Transfer',
    QR_PAY: 'QR Pay', CREDIT: 'Credit',
  };

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
              { label: 'Payment', value: pmLabel[receipt.paymentMethod] ?? receipt.paymentMethod },
              ...(receipt.paymentMethod === 'CASH' && changeCents > 0 ? [{ label: 'Change', value: formatCents(changeCents) }] : []),
              ...(receipt.isCreditSale ? [{ label: 'Balance Due', value: formatCents(receipt.totalCents) }] : []),
              ...(receipt.isStaffSale  ? [{ label: 'Type', value: 'Staff Sale' }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{label}</span>
                <span className="font-semibold text-slate-800">{value}</span>
              </div>
            ))}
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
              <ShoppingCart size={15} /> New Sale
              <span className="ml-1 text-emerald-300 text-xs font-normal">F5</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-full flex items-center justify-center gap-2 border border-slate-200 rounded-xl py-2 text-xs text-slate-500 hover:bg-slate-50 transition"
            >
              ↩ Keep Cart
              <span className="ml-1 text-slate-300 text-xs font-normal">Esc</span>
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
    receiptName:          p.receiptName ?? null,
    taxPercent:           p.taxPercent,
    imageUrl:        p.imageUrl ?? null,
    expiryDate:      p.expiryDate ?? null,
    expiryAlertDays: p.expiryAlertDays ?? 30,
    unitId:          p.unitId,
    baseUnitId:      p.baseUnitId ?? null,
    purchaseUnitId:  p.purchaseUnitId ?? null,
    salesUnitId:     p.salesUnitId ?? null,
    unit:            p.unit,
    baseUnit:        p.baseUnit ?? null,
    salesUnit:       p.salesUnit ?? null,
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

// ─── Main POSPage ─────────────────────────────────────────────────────────────

export default function POSPage() {
  const navigate  = useNavigate();
  const { user, logout }  = useAuthStore();
  const { currencySymbol, settings: appSettings } = useAppSettings();
  const { enterPOS, exitPOS, shiftId, openShift: storeOpenShift, closeShift: storeCloseShift } = usePosStore();
  const shiftOpenedAt = usePosStore(s => s.shiftOpenedAt);
  const qc        = useQueryClient();

  const isAdmin   = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  async function handleLogout() {
    try {
      const result = await shiftsApi.list({ status: 'OPEN', userId: user?.id });
      if (result.data && result.data.length > 0) {
        window.alert('Please close your POS shift before logging out.');
        return;
      }
    } catch {
      // If shift check fails, allow logout
    }
    exitPOS();
    logout();
    navigate('/login');
  }

  // ── Refs ──────────────────────────────────────────────────────────────────────
  const barcodeRef      = useRef<HTMLInputElement>(null);
  const whDropdownRef   = useRef<HTMLDivElement>(null);
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
  const [cartDiscountType, setCartDiscountType] = useState<'percent' | 'amount'>('percent');
  const [cartDiscountValue, setCartDiscountValue] = useState(0);
  const [isStaffSale, setIsStaffSale]           = useState(false);
  const [customer, setCustomer]                 = useState<CustomerOption | null>(null);
  const [warehouseId, setWarehouseId]           = useState('');
  const [lastReceipt, setLastReceipt]           = useState<Receipt | null>(null);
  const [lastChangeCents, setLastChangeCents]   = useState(0);
  const [holds, setHolds]                       = useState<HoldBill[]>(loadHolds);

  // Dialog visibility
  const [showPayment,         setShowPayment]         = useState(false);
  const [showReceipt,         setShowReceipt]         = useState(false);
  const [showHoldModal,       setShowHoldModal]       = useState(false);
  const [showHolds,           setShowHolds]           = useState(false);
  const [showCustomer,        setShowCustomer]        = useState(false);
  const [showShortcuts,       setShowShortcuts]       = useState(false);
  const [showExitBlocked,     setShowExitBlocked]     = useState(false);
  const [showWhDropdown,      setShowWhDropdown]      = useState(false);
  const [showQuickAddCustomer,setShowQuickAddCustomer]= useState(false);
  const [showCloseShift,      setShowCloseShift]      = useState(false);
  const [quickAddBarcode,     setQuickAddBarcode]      = useState<string | null>(null);
  const [quickAddToast,       setQuickAddToast]        = useState<string | null>(null);
  const [barcodeLoading,      setBarcodeLoading]       = useState(false);
  const [batchCapToast,       setBatchCapToast]       = useState<string | null>(null);

  // Quick-add customer form
  const [newCustName,  setNewCustName]  = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [quickAddError,setQuickAddError]= useState('');

  const clock   = useLiveClock();
  const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

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
    setTimeout(() => barcodeRef.current?.focus(), 100);
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

  // ── Queries ───────────────────────────────────────────────────────────────────
  const { data: warehouses = [] } = useQuery({
    queryKey: ['pos-warehouses'],
    queryFn:  posApi.getWarehouses,
  });
  useEffect(() => {
    if (warehouses.length > 0 && !warehouseId) {
      const defaultWh = (warehouses as { id: string; isDefault?: boolean }[]).find(w => w.isDefault) ?? warehouses[0];
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

  // Quick-add customer mutation
  const createCustomerMutation = useMutation({
    mutationFn: () => api.post('/customers', {
      name:  newCustName.trim(),
      phone: newCustPhone.trim() || undefined,
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

  const { data: productsData, isFetching: loadingProducts } = useQuery({
    queryKey: ['pos-products', debouncedSearch, warehouseId, selectedCategory],
    queryFn:  () => posApi.searchProducts({
      search:      debouncedSearch || undefined,
      warehouseId: warehouseId    || undefined,
      categoryId:  selectedCategory ?? undefined,
      pageSize:    120,
    }),
    enabled: !!warehouseId,
  });
  const products = productsData?.data ?? [];

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

  // ── Cart helpers ──────────────────────────────────────────────────────────────
  const addToCart = useCallback((product: PosProduct) => {
    const bs       = product.batchSummary;
    const policy   = (appSettings?.expiredStockPolicy ?? 'BLOCK') as 'BLOCK' | 'WARN' | 'ALLOW';
    const rawTotal = totalStock(product);

    // maxQty: for BLOCK → sellableQty; for WARN/ALLOW → total (includes expired)
    const maxQty = bs && bs.expiryStatus !== 'none'
      ? (policy === 'BLOCK' ? bs.sellableQty : rawTotal)
      : null;

    setCart(prev => {
      const idx = prev.findIndex(i => i.product.id === product.id);
      if (idx >= 0) {
        const newQty = prev[idx].qty + 1;
        if (maxQty !== null && newQty > maxQty) {
          if (maxQty === 0) {
            setBatchCapToast('No stock available');
          } else {
            setBatchCapToast(`Only ${maxQty} available`);
          }
          return prev; // don't add
        }
        const next = [...prev];
        next[idx] = { ...next[idx], qty: newQty };
        return next;
      }
      if (maxQty !== null && maxQty <= 0) {
        setBatchCapToast('No stock available');
        return prev;
      }
      // Pre-fill default discount set on the product (cashier can override)
      const defDisc      = product.defaultDiscountCents ?? 0;
      const defDiscCents = Math.min(defDisc, product.priceCents);
      const newItems: CartItem[] = [{
        product, qty: 1, unitPriceCents: product.priceCents,
        itemDiscountType:  (defDiscCents > 0 ? 'amount' : 'percent') as 'amount' | 'percent',
        itemDiscountValue: defDiscCents > 0 ? defDiscCents / 100 : 0,
        itemDiscountCents: defDiscCents,
      }];
      // Auto-add service charge item if configured
      const svcCents = product.serviceChargeCents ?? 0;
      if (svcCents > 0) {
        // Create a pseudo-product for the service charge line
        const svcProduct: PosProduct = {
          ...product,
          id:         `svc_${product.id}`,
          name:       product.serviceChargeLabel || 'Service Charge',
          priceCents: svcCents,
          defaultDiscountCents: 0,
          serviceChargeCents: 0,
        };
        newItems.push({
          product: svcProduct, qty: 1, unitPriceCents: svcCents,
          itemDiscountType: 'percent', itemDiscountValue: 0, itemDiscountCents: 0,
          isServiceCharge: true, linkedProductId: product.id,
        });
      }
      return [...prev, ...newItems];
    });
    refocusBarcode();
  }, [appSettings, refocusBarcode]);

  const removeFromCart = useCallback((productId: string) => {
    setCart(prev => prev.filter(i =>
      i.product.id !== productId &&
      // Also remove any service charge linked to this product
      i.linkedProductId !== productId,
    ));
    refocusBarcode();
  }, [refocusBarcode]);

  const updateQty = useCallback((productId: string, qty: number) => {
    if (qty <= 0) { removeFromCart(productId); return; }
    setCart(prev => prev.map(i => {
      if (i.product.id !== productId) return i;
      const newLineSubtotal = qty * i.unitPriceCents;
      const newDiscountCents = i.itemDiscountType === 'percent'
        ? Math.floor(newLineSubtotal * i.itemDiscountValue / 100)
        : Math.min(Math.round(i.itemDiscountValue * 100), newLineSubtotal);
      return { ...i, qty, itemDiscountCents: newDiscountCents };
    }));
    refocusBarcode();
  }, [removeFromCart, refocusBarcode]);

  const clearCart = useCallback(() => {
    try { localStorage.removeItem(CART_KEY); } catch { /* ignore */ }
    setCart([]);
    setCartDiscountType('percent');
    setCartDiscountValue(0);
    setCustomer(null);
    refocusBarcode();
  }, [refocusBarcode]);

  // ── Barcode lookup ────────────────────────────────────────────────────────────
  const handleBarcodeEnter = useCallback(async () => {
    const code = barcodeInput.trim();
    if (!code) {
      // Empty barcode + items in cart → open payment dialog
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

    // Helper: focus the qty input of the newly added item after cart state settles
    const focusNewItemQty = (productId: string) => {
      setTimeout(() => {
        cartLineRefs.current[productId]?.focusQty();
      }, 120);
    };

    // 1. Fast: search locally in the already-loaded products grid
    const localMatch = products.find(p => p.barcode === code || p.sku === code);
    if (localMatch) {
      sfx.add();
      addToCart(localMatch);
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
        sfx.error();
        setQuickAddToast('This product is out of stock and cannot be sold');
        setTimeout(() => setQuickAddToast(null), 3000);
        return;
      }

      sfx.add();
      const posProduct = productToPosProduct(found);
      addToCart(posProduct);
      focusNewItemQty(posProduct.id);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        // 3. Truly not in DB → open QuickAddModal
        setQuickAddBarcode(code);
      } else {
        // 4. Network / server error
        sfx.error();
        setQuickAddToast('Network error — could not look up barcode');
        setTimeout(() => setQuickAddToast(null), 3000);
      }
    } finally {
      setBarcodeLoading(false);
      // Only refocus barcode if we didn't focus qty (i.e. 404 path or error)
    }
  }, [barcodeInput, cart.length, products, addToCart, refocusBarcode, appSettings]);

  // ── Hold helpers ──────────────────────────────────────────────────────────────
  const holdBill = useCallback((label: string) => {
    if (cart.length === 0) { setShowHoldModal(false); return; }
    const newHold: HoldBill = {
      id:                crypto.randomUUID(),
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
  }, [cart, cartDiscountType, cartDiscountValue, customer, holds, clearCart]);

  const resumeHold = useCallback((h: HoldBill) => {
    setCart(h.cart);
    setCartDiscountType(h.cartDiscountType ?? 'percent');
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
      sfx.checkout();
      // Augment receipt: split service-charge amounts back out as separate lines for display
      const svcItems = cart.filter(i => i.isServiceCharge);
      if (svcItems.length > 0) {
        const augLines = data.receipt.lines.flatMap(line => {
          const svc = svcItems.find(sc => sc.linkedProductId === line.product.id);
          if (!svc) return [line];
          const svcCents = svc.unitPriceCents;
          const mainUnit = line.unitPriceCents - svcCents;
          return [
            { ...line, unitPriceCents: mainUnit, lineTotalCents: mainUnit * line.qty },
            {
              product:        { id: svc.product.id, name: svc.product.name, sku: svc.product.sku, receiptName: svc.product.receiptName },
              qty:            line.qty,
              unitPriceCents: svcCents,
              taxPercent:     0,
              discountCents:  0,
              lineTotalCents: svcCents * line.qty,
            },
          ];
        });
        setLastReceipt({ ...data.receipt, lines: augLines });
      } else {
        setLastReceipt(data.receipt);
      }
      setLastChangeCents(pendingReceivedCents > 0 ? Math.max(0, pendingReceivedCents - data.receipt.totalCents) : 0);
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
    },
    onError: (err: unknown) => {
      sfx.error();
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Checkout failed — please try again';
      setQuickAddToast(msg);
      setTimeout(() => setQuickAddToast(null), 5000);
    },
  });

  const updateItemDiscount = useCallback((productId: string, type: 'percent' | 'amount', value: number) => {
    setCart(prev => prev.map(i => {
      if (i.product.id !== productId) return i;
      const lineSubtotal   = i.qty * i.unitPriceCents;
      const discountCents  = type === 'percent'
        ? Math.floor(lineSubtotal * value / 100)
        : Math.min(Math.round(value * 100), lineSubtotal);
      return { ...i, itemDiscountType: type, itemDiscountValue: value, itemDiscountCents: discountCents };
    }));
  }, []);

  const handleCheckout = useCallback((method: AllPaymentMethods, receivedCents = 0) => {
    if (!warehouseId || cart.length === 0) return;
    setPendingReceivedCents(receivedCents);
    const payload = {
      warehouseId,
      customerId:          customer?.id,
      paymentMethod:       method,
      cartDiscountCents,
      cartDiscountPercent: cartDiscountType === 'percent' ? cartDiscountValue : 0,
      isStaffSale:         isStaffSale && isAdmin,
      items: cart
        .filter(i => !i.isServiceCharge)
        .map(i => {
          // Fold any service charge for this product into its unitPriceCents
          const svcItem = cart.find(sc => sc.isServiceCharge && sc.linkedProductId === i.product.id);
          const svcCents = svcItem ? svcItem.unitPriceCents : 0;
          return {
            productId:      i.product.id,
            qty:            i.qty,
            unitPriceCents: i.unitPriceCents + svcCents,
            discountCents:  i.itemDiscountCents,
          };
        }),
    } satisfies Parameters<typeof posApi.checkout>[0];
    checkoutMutation.mutate(payload);
  }, [warehouseId, cart, customer, cartDiscountCents, cartDiscountType, cartDiscountValue, isStaffSale, isAdmin, checkoutMutation]);

  const newSale = useCallback(() => {
    clearCart();
    setIsStaffSale(false);
    setShowReceipt(false);
  }, [clearCart]);

  const printReceipt = useCallback(async () => {
    if (!lastReceipt || !appSettings) return;
    let logoBase64: string | null = null;
    if (appSettings.receiptShowLogo && appSettings.logoUrl) {
      logoBase64 = await fetchLogoAsBase64(appSettings.logoUrl, useAuthStore.getState().accessToken);
    }
    const html = generateReceiptHtml(lastReceipt, appSettings, lastChangeCents, logoBase64);
    const win  = window.open('', '_blank', 'width=420,height=640');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 600);
  }, [lastReceipt, appSettings, lastChangeCents]);

  // ── Auto-focus barcode when shift becomes active ──────────────────────────────
  useEffect(() => {
    if (currentShift && barcodeRef.current) {
      barcodeRef.current.focus();
    }
  }, [currentShift]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag     = (e.target as HTMLElement).tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

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

      // Ctrl+Shift+X — close shift
      if (e.ctrlKey && e.shiftKey && e.key === 'X') {
        e.preventDefault();
        if (user?.role === 'ADMIN' || user?.role === 'MANAGER') {
          setShowCloseShift(true);
        } else {
          setShowExitBlocked(true);
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
        if (showPayment)          { setShowPayment(false);          return; }
        if (showHoldModal)        { setShowHoldModal(false);        return; }
        if (showShortcuts)        { setShowShortcuts(false);        return; }
        if (showExitBlocked)      { setShowExitBlocked(false);      return; }
        if (showQuickAddCustomer) { setShowQuickAddCustomer(false); return; }
        if (quickAddBarcode)      { setQuickAddBarcode(null);       return; }
        if (showHolds)            { setShowHolds(false);            return; }
        if (showReceipt)          { setShowReceipt(false);          return; }
        if (showCustomer)         { setShowCustomer(false);         return; }
        refocusBarcode();
        return;
      }

      // ── Don't fire remaining shortcuts when typing in an input ────────────────
      if (inInput) return;

      const anyDialog = showCloseShift || showPayment || showHoldModal || showShortcuts
        || showExitBlocked || showQuickAddCustomer || showHolds
        || showReceipt || showCustomer || !!quickAddBarcode;
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

      // F5 — new sale (clear cart with confirmation)
      if (e.key === 'F5') {
        e.preventDefault();
        if (cart.length > 0) {
          if (window.confirm('Clear current cart and start a new sale?')) {
            clearCart();
          }
        }
        return;
      }

      // F8 — open checkout / pay now
      if (e.key === 'F8') {
        e.preventDefault();
        if (cart.length > 0 && !showPayment) setShowPayment(true);
        return;
      }

      // + / = — increase qty of last cart item
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        if (cart.length > 0) {
          const last = cart[cart.length - 1];
          updateQty(last.product.id, last.qty + 1);
        }
        return;
      }

      // - — decrease qty of last cart item
      if (e.key === '-') {
        e.preventDefault();
        if (cart.length > 0) {
          const last = cart[cart.length - 1];
          if (last.qty > 1) updateQty(last.product.id, last.qty - 1);
          else removeFromCart(last.product.id);
        }
        return;
      }

      // Delete — remove last cart item
      if (e.key === 'Delete' || e.key === 'Del') {
        e.preventDefault();
        if (cart.length > 0) {
          const last = cart[cart.length - 1];
          removeFromCart(last.product.id);
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
  }, [showCloseShift, showPayment, showHoldModal, showShortcuts, showExitBlocked, showQuickAddCustomer,
      showHolds, showReceipt, showCustomer, quickAddBarcode,
      cart, user, clearCart, refocusBarcode, updateQty, removeFromCart, currentShift, printReceipt, newSale]);

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
      style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto' }}
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
          <span className="font-bold text-slate-800 text-sm tracking-tight">ModernERP POS</span>
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
              ? `${(selectedWarehouse as any).isDefault ? '★ ' : ''}${selectedWarehouse.name} (${selectedWarehouse.code || String(selectedWarehouse.name).slice(0, 4).toUpperCase()})`
              : 'Warehouse'}
            <ChevronDown size={11} style={{ color: '#94a3b8' }} />
          </button>
          {showWhDropdown && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff', border: '.5px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,.08)', zIndex: 50, minWidth: 200, padding: 4 }}>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(warehouses as any[]).map(w => (
                <button key={w.id} type="button"
                  onClick={() => { setWarehouseId(w.id); setShowWhDropdown(false); }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '7px 10px', fontSize: 12, cursor: 'pointer', borderRadius: 5,
                    color: w.id === warehouseId ? '#4338ca' : '#1e293b',
                    fontWeight: w.id === warehouseId ? 500 : 400,
                    background: 'transparent', border: 'none',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f0f4ff'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
                  {(w as any).isDefault ? '★ ' : ''}{w.name} ({w.code || String(w.name).slice(0, 4).toUpperCase()})
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

        {/* Exit POS — ADMIN/MANAGER only */}
        {isAdmin && (
          <button type="button" onClick={() => { exitPOS(); navigate('/'); }}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition shrink-0">
            <LogOut size={13} /> Exit POS
          </button>
        )}

        {/* Sign out — visible to ALL roles */}
        <button type="button" onClick={handleLogout}
          title="Sign out"
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 transition shrink-0">
          <LogOut size={13} />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </header>

      {/* ═══════════════════════════════════════════════════════════════
          MAIN: Left 60% + Right 40%
      ═══════════════════════════════════════════════════════════════ */}
      <div
        className="overflow-hidden"
        style={{ display: 'grid', gridTemplateColumns: '60fr 40fr' }}
      >

        {/* ─── LEFT PANEL: products ─────────────────────────────────── */}
        <div className="flex flex-col overflow-hidden border-r border-slate-200 bg-slate-50">

          {/* Search + barcode row */}
          <div className="bg-white border-b border-slate-200 px-4 py-3 space-y-2 shrink-0">
            {/* Barcode scanner input */}
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={barcodeRef}
                type="text"
                value={barcodeInput}
                onChange={e => setBarcodeInput(e.target.value)}
                onKeyDown={e => {
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

            {/* Category chips */}
            {categories.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                <button type="button"
                  onClick={() => setSelectedCategory(null)}
                  className={cls(
                    'px-2.5 py-1 rounded-full text-xs font-medium border transition',
                    selectedCategory === null
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300',
                  )}>
                  All
                </button>
                {categories.map(cat => (
                  <button key={cat.id} type="button"
                    onClick={() => setSelectedCategory(cat.id === selectedCategory ? null : cat.id)}
                    className={cls(
                      'px-2.5 py-1 rounded-full text-xs font-medium border transition',
                      selectedCategory === cat.id
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300',
                    )}>
                    {cat.name}
                  </button>
                ))}
              </div>
            )}
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
                className="grid gap-3"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}
              >
                {products.map(p => (
                  <ProductCard key={p.id} product={p} onAdd={() => addToCart(p)} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── RIGHT PANEL: cart ────────────────────────────────────── */}
        <div className="flex flex-col overflow-hidden bg-white">

          {/* Cart header */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 font-bold text-slate-800">
              <ShoppingCart size={17} className="text-indigo-500" />
              Cart
              {cart.length > 0 && (
                <span className="bg-indigo-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {cart.reduce((s, i) => s + i.qty, 0)}
                </span>
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

          <div className="flex-1 overflow-y-auto px-3 py-2">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-300 gap-2">
                <ShoppingCart size={44} />
                <p className="text-sm">Cart is empty</p>
                <p className="text-xs text-slate-200">Scan a barcode or tap a product</p>
              </div>
            ) : (
              cart.map(item => (
                <CartLine
                  key={item.product.id}
                  ref={el => { cartLineRefs.current[item.product.id] = el; }}
                  item={item}
                  onChange={qty => updateQty(item.product.id, qty)}
                  onRemove={() => removeFromCart(item.product.id)}
                  onBatchCap={msg => setBatchCapToast(msg)}
                  onUpdateDiscount={(type, value) => updateItemDiscount(item.product.id, type, value)}
                  onNavigateToBarcode={refocusBarcode}
                />
              ))
            )}
          </div>

          {/* Totals + PAY NOW */}
          <div className="border-t-2 border-slate-100 px-4 py-4 space-y-2.5 shrink-0">
            {/* Subtotal (after per-item discounts) */}
            <div className="flex justify-between text-sm text-slate-500">
              <span>Subtotal</span>
              <span className="font-medium text-slate-700">{formatCents(cartSubtotalCents)}</span>
            </div>

            {/* Cart-level discount — toggle [%][₨] + DiscountInput */}
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
                  onEnter={() => { if (cart.length > 0) setShowPayment(true); }}
                />
              </div>
            </div>

            {/* Tax — show only when non-zero */}
            {effectiveTaxCents > 0 && (
              <div className="flex justify-between text-sm text-slate-500">
                <span>Tax</span>
                <span>{formatCents(effectiveTaxCents)}</span>
              </div>
            )}

            {/* TOTAL */}
            <div className="pt-1 border-t border-slate-200">
              <div className="flex justify-between items-baseline">
                <span className="text-base font-bold text-slate-700">TOTAL</span>
                <span className="text-3xl font-black text-slate-800">{formatCents(grandTotal)}</span>
              </div>
            </div>

            {/* Staff Sale toggle — visible only when feature is enabled and user is ADMIN/MANAGER */}
            {appSettings?.staffSalesEnabled && isAdmin && (
              <label className={`flex items-center gap-2.5 cursor-pointer select-none px-3 py-2 rounded-lg transition ${isStaffSale ? 'bg-violet-50 border border-violet-200' : 'bg-slate-50 border border-transparent'}`}>
                <input
                  type="checkbox"
                  checked={isStaffSale}
                  onChange={e => setIsStaffSale(e.target.checked)}
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

            {/* PAY NOW */}
            <button
              type="button"
              onClick={() => {
                if (cart.length === 0 || !warehouseId) return;
                setShowPayment(true);
              }}
              disabled={cart.length === 0 || !warehouseId || checkoutMutation.isPending}
              className={cls(
                'w-full py-4 font-bold text-lg rounded-xl flex items-center justify-center gap-2 transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
                cart.length === 0 || !warehouseId
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-100 active:scale-[0.98]',
              )}
            >
              {checkoutMutation.isPending
                ? <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processing…</>
                : <><CheckCircle size={18} /> PAY NOW <kbd className="ml-1 text-[10px] bg-white/20 border border-white/30 rounded px-1 font-mono">F8</kbd></>
              }
            </button>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          BOTTOM QUICK BAR
      ═══════════════════════════════════════════════════════════════ */}
      <footer style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#f8fafc', borderTop: '.5px solid #e2e8f0' }}>

        {/* Hold — F4 */}
        <button type="button"
          onClick={() => { if (cart.length > 0) setShowHoldModal(true); }}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '.5px solid #e2e8f0', borderRadius: 6, background: '#fff', fontSize: 12, color: '#1e293b', cursor: 'pointer', opacity: cart.length === 0 ? 0.4 : 1 }}>
          ⏸ Hold
          <span style={{ fontSize: 10, color: '#94a3b8', background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, border: '.5px solid #e2e8f0' }}>F4</span>
        </button>

        {/* Void & New — F5 */}
        <button type="button"
          onClick={() => { if (cart.length > 0 && window.confirm('Clear current cart and start a new sale?')) clearCart(); else if (cart.length === 0) clearCart(); }}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '.5px solid #e2e8f0', borderRadius: 6, background: '#fff', fontSize: 12, color: '#1e293b', cursor: 'pointer' }}>
          ⊗ Void & New
          <span style={{ fontSize: 10, color: '#94a3b8', background: '#f1f5f9', padding: '1px 4px', borderRadius: 3, border: '.5px solid #e2e8f0' }}>F5</span>
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

      {/* ═══════════════════════════════════════════════════════════════
          DIALOGS / MODALS
      ═══════════════════════════════════════════════════════════════ */}

      {showPayment && (
        <PaymentDialog
          totalCents={grandTotal}
          onConfirm={(method, receivedCents = 0) => handleCheckout(method, receivedCents)}
          onClose={() => setShowPayment(false)}
          isPending={checkoutMutation.isPending}
          customer={customer}
        />
      )}

      {showReceipt && lastReceipt && (
        <ReceiptModal
          receipt={lastReceipt}
          changeCents={lastChangeCents}
          onNewSale={newSale}
          onClose={() => setShowReceipt(false)}
          onPrint={printReceipt}
        />
      )}

      {showHoldModal && (
        <HoldModal
          onConfirm={holdBill}
          onClose={() => setShowHoldModal(false)}
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
                    if (e.key === 'Enter' && newCustName.trim()) createCustomerMutation.mutate();
                    if (e.key === 'Escape') setShowQuickAddCustomer(false);
                  }}
                  placeholder="Customer name"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Phone (optional)</label>
                <input
                  value={newCustPhone}
                  onChange={e => setNewCustPhone(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newCustName.trim()) createCustomerMutation.mutate();
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
                onClick={() => createCustomerMutation.mutate()}
                disabled={!newCustName.trim() || createCustomerMutation.isPending}
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
                    { key: 'F5',  desc: 'New sale (clear cart)' },
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
          onClose={() => setShowCloseShift(false)}
          onShiftClosed={() => {
            storeCloseShift();
            qc.setQueryData(['current-shift', warehouseId], null);
            setShowCloseShift(false);
            exitPOS();
            navigate('/');
          }}
        />
      )}

      {/* QuickAdd Modal — unknown barcode → create product on the fly */}
      {quickAddBarcode && (
        <QuickAddModal
          barcode={quickAddBarcode}
          onSuccess={(product) => {
            setQuickAddBarcode(null);
            sfx.add();
            addToCart(productToPosProduct(product));
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
