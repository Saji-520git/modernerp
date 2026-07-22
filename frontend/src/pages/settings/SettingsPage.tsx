import React, { useState, Fragment } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Percent, ShoppingCart, FileText,
  ShieldCheck, ChevronRight, Check, AlertCircle,
  Lock, Eye, Printer, Bell, X, MessageCircle, LayoutGrid,
} from 'lucide-react';
import { settingsApi, type AppSettings } from '../../services/settings';
import { OPTIONAL_MODULES, MODULE_META } from '../../config/modules';
import { useModule } from '../../hooks/useModule';
import {
  DEFAULT_RECEIPT_TEMPLATE,
  DEFAULT_OUTSTANDING_TEMPLATE,
  DEFAULT_PAYABLE_TEMPLATE,
  DEFAULT_OFFER_TEMPLATE,
} from '../../utils/whatsapp';
import { attachmentsApi, getFileUrl } from '../../services/attachments';
import { useAuthStore } from '../../store/authStore';

// ─── Permission matrix data (mirrors backend/src/config/permissions.ts) ───────

type PermKey = string;

const PERM_GROUPS: { label: string; perms: { key: PermKey; label: string }[] }[] = [
  { label: 'User Management', perms: [
    { key: 'manage_users',      label: 'Manage Users' },
  ]},
  { label: 'Products', perms: [
    { key: 'view_products',     label: 'View Products' },
    { key: 'manage_products',   label: 'Manage Products' },
  ]},
  { label: 'Inventory', perms: [
    { key: 'view_inventory',    label: 'View Stock' },
    { key: 'adjust_inventory',  label: 'Adjust Stock' },
    { key: 'transfer_stock',    label: 'Transfer Stock' },
  ]},
  { label: 'POS', perms: [
    { key: 'pos_checkout',      label: 'POS Checkout' },
    { key: 'adjust_sale_price', label: 'Adjust Sale Price' },
    { key: 'manage_shifts',     label: 'Manage Shifts' },
  ]},
  { label: 'Purchases', perms: [
    { key: 'view_purchases',    label: 'View Purchases' },
    { key: 'create_purchases',  label: 'Create Purchases' },
    { key: 'confirm_purchases', label: 'Confirm & Receive' },
  ]},
  { label: 'Sales', perms: [
    { key: 'view_sales',        label: 'View Sales' },
    { key: 'create_sales',      label: 'Create Invoices' },
    { key: 'confirm_sales',     label: 'Confirm & Dispatch' },
    { key: 'record_payments',   label: 'Record Payments' },
  ]},
  { label: 'Contacts', perms: [
    { key: 'view_contacts',     label: 'View Contacts' },
    { key: 'manage_contacts',   label: 'Manage Contacts' },
  ]},
  { label: 'Credit', perms: [
    { key: 'sell_on_credit',    label: 'Sell on Credit' },
    { key: 'manage_credit',     label: 'Manage Credit' },
  ]},
  { label: 'Reports', perms: [
    { key: 'view_reports',      label: 'View Reports' },
    { key: 'view_all_shifts',   label: 'View All Shifts' },
  ]},
  { label: 'Settings', perms: [
    { key: 'view_settings',     label: 'View Settings' },
    { key: 'manage_settings',   label: 'Manage Settings' },
  ]},
];

const ROLE_MAP: Record<string, Set<PermKey>> = {
  ADMIN:   new Set(['manage_users','view_products','manage_products','view_inventory','adjust_inventory','transfer_stock','pos_checkout','adjust_sale_price','view_purchases','create_purchases','confirm_purchases','view_sales','create_sales','confirm_sales','record_payments','view_contacts','manage_contacts','sell_on_credit','manage_credit','view_reports','view_settings','manage_settings','manage_shifts','view_all_shifts']),
  MANAGER: new Set(['view_products','manage_products','view_inventory','adjust_inventory','transfer_stock','pos_checkout','adjust_sale_price','view_purchases','create_purchases','confirm_purchases','view_sales','create_sales','confirm_sales','record_payments','view_contacts','manage_contacts','sell_on_credit','manage_credit','view_reports','view_settings','manage_settings','manage_shifts','view_all_shifts']),
  CASHIER: new Set(['view_products','view_inventory','pos_checkout','record_payments','view_sales','view_contacts','view_settings','manage_shifts']),
  STAFF:   new Set(['view_products','view_inventory','view_purchases','view_sales','view_contacts','view_reports','view_settings']),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Toggle({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-slate-600">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-slate-200'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}

function inp(disabled?: boolean) {
  return `w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 transition ${disabled ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'bg-white'}`;
}

function SaveButton({ onClick, isPending, label = 'Save Changes', disabled }: {
  onClick: () => void; isPending: boolean; label?: string; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending || disabled}
      className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isPending ? 'Saving…' : label}
    </button>
  );
}

function SectionFooter({ onSave, isPending, success, error, readOnly }: {
  onSave: () => void; isPending: boolean; success?: boolean; error?: string | null; readOnly?: boolean;
}) {
  return (
    <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 text-sm">
        {success && <span className="text-emerald-600 flex items-center gap-1"><Check size={14} /> Saved successfully</span>}
        {error && <span className="text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {error}</span>}
      </div>
      {!readOnly && <SaveButton onClick={onSave} isPending={isPending} />}
    </div>
  );
}

// ─── Panels ───────────────────────────────────────────────────────────────────

function CompanyPanel({ settings, onSave, isPending, readOnly }: {
  settings: AppSettings; onSave: (d: Partial<AppSettings>) => Promise<void>;
  isPending: boolean; readOnly?: boolean;
}) {
  const [f, setF] = useState({
    businessName:    settings.businessName,
    businessRegNo:   settings.businessRegNo ?? '',
    businessAddress: settings.businessAddress ?? '',
    businessPhone:   settings.businessPhone ?? '',
    businessEmail:   settings.businessEmail ?? '',
    logoUrl:         settings.logoUrl ?? '',
  });
  const [success, setSuccess]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoFileRef = React.useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    setSuccess(false); setError(null);
    try {
      await onSave({
        businessName:    f.businessName || undefined,
        businessRegNo:   f.businessRegNo   || null,
        businessAddress: f.businessAddress || null,
        businessPhone:   f.businessPhone   || null,
        businessEmail:   f.businessEmail   || null,
        logoUrl:         f.logoUrl         || null,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Save failed');
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('Logo file must be under 2 MB');
      return;
    }
    setLogoUploading(true);
    setError(null);
    try {
      const att = await attachmentsApi.upload('Settings', 'logo', file);
      const url = getFileUrl(att.storedName);
      setF(p => ({ ...p, logoUrl: url }));
    } catch {
      setError('Logo upload failed. Try again.');
    } finally {
      setLogoUploading(false);
      if (logoFileRef.current) logoFileRef.current.value = '';
    }
  };

  const u = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Business Name *">
          <input disabled={readOnly} className={inp(readOnly)} value={f.businessName} onChange={u('businessName')} placeholder="e.g. Acme Trading Pvt Ltd" />
        </Field>
        <Field label="Registration Number">
          <input disabled={readOnly} className={inp(readOnly)} value={f.businessRegNo} onChange={u('businessRegNo')} placeholder="e.g. REG-0001" />
        </Field>
      </div>
      <Field label="Address">
        <textarea disabled={readOnly} rows={2} className={inp(readOnly)} value={f.businessAddress} onChange={u('businessAddress')} placeholder="Street address, city" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Phone">
          <input disabled={readOnly} className={inp(readOnly)} value={f.businessPhone} onChange={u('businessPhone')} placeholder="+94 77 123 4567" />
        </Field>
        <Field label="Email">
          <input disabled={readOnly} className={inp(readOnly)} type="email" value={f.businessEmail} onChange={u('businessEmail')} placeholder="info@company.com" />
        </Field>
      </div>

      {/* Logo — file upload + URL input */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-700">Business Logo</label>
        <div className="flex items-center gap-3">
          {/* Preview */}
          {f.logoUrl ? (
            <div className="relative shrink-0">
              <img
                src={f.logoUrl}
                alt="Logo"
                className="h-14 w-14 rounded-lg object-contain border border-slate-200 bg-slate-50"
                onError={e => (e.currentTarget.style.display = 'none')}
              />
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setF(p => ({ ...p, logoUrl: '' }))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600"
                  title="Remove logo"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ) : (
            <div className="h-14 w-14 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center bg-slate-50 shrink-0">
              <Building2 size={20} className="text-slate-300" />
            </div>
          )}
          {!readOnly && (
            <div className="flex-1 space-y-1.5">
              <button
                type="button"
                onClick={() => logoFileRef.current?.click()}
                disabled={logoUploading}
                className="flex items-center gap-2 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition disabled:opacity-50"
              >
                {logoUploading
                  ? <><div className="w-3.5 h-3.5 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin" /> Uploading…</>
                  : <><Building2 size={14} /> Upload from PC</>
                }
              </button>
              <input
                ref={logoFileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleLogoUpload}
                className="sr-only"
              />
              <p className="text-xs text-slate-400">PNG, JPG, WebP · max 2 MB</p>
            </div>
          )}
        </div>
        {/* Fallback URL input */}
        <input
          disabled={readOnly}
          className={inp(readOnly)}
          value={f.logoUrl}
          onChange={u('logoUrl')}
          placeholder="Or paste a logo URL (https://…)"
        />
      </div>

      <SectionFooter onSave={handleSave} isPending={isPending} success={success} error={error} readOnly={readOnly} />
    </div>
  );
}

function TaxPanel({ settings, onSave, isPending, readOnly }: {
  settings: AppSettings; onSave: (d: Partial<AppSettings>) => Promise<void>;
  isPending: boolean; readOnly?: boolean;
}) {
  const [f, setF] = useState({
    currencySymbol:    settings.currencySymbol,
    currencyCode:      settings.currencyCode,
    currencyPosition:  settings.currencyPosition as 'before' | 'after',
    dateFormat:        settings.dateFormat,
    taxEnabled:        settings.taxEnabled,
    taxLabel:          settings.taxLabel,
    defaultTaxPercent: settings.defaultTaxPercent,
    taxNumber:         settings.taxNumber ?? '',
    taxInclusive:      settings.taxInclusive,
  });
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleSave = async () => {
    setSuccess(false); setError(null);
    try {
      await onSave({
        currencySymbol:    f.currencySymbol,
        currencyCode:      f.currencyCode,
        currencyPosition:  f.currencyPosition,
        dateFormat:        f.dateFormat,
        taxEnabled:        f.taxEnabled,
        taxLabel:          f.taxLabel,
        defaultTaxPercent: f.defaultTaxPercent,
        taxNumber:         f.taxNumber || null,
        taxInclusive:      f.taxInclusive,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Save failed');
    }
  };

  const sampleCents = 10000;
  const tax         = f.taxEnabled ? Math.round(sampleCents * (f.defaultTaxPercent / 100)) : 0;
  const total       = sampleCents + tax;
  const fmt = (c: number) => f.currencyPosition === 'before'
    ? `${f.currencySymbol} ${(c / 100).toFixed(2)}`
    : `${(c / 100).toFixed(2)} ${f.currencySymbol}`;

  return (
    <div className="space-y-5">
      {/* Currency */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Currency</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Currency Symbol">
            <input disabled={readOnly} className={inp(readOnly)} value={f.currencySymbol}
              onChange={e => setF(p => ({ ...p, currencySymbol: e.target.value }))}
              placeholder='e.g. Rs. £ $' />
          </Field>
          <Field label="Currency Code">
            <input disabled={readOnly} className={inp(readOnly)} value={f.currencyCode}
              onChange={e => setF(p => ({ ...p, currencyCode: e.target.value }))}
              placeholder="LKR USD GBP" />
          </Field>
        </div>
        <div className="mt-3 space-y-1.5">
          <label className="block text-sm font-medium text-slate-700">Symbol Position</label>
          <div className="flex gap-4">
            {(['before', 'after'] as const).map(v => (
              <label key={v} className={`flex items-center gap-2 cursor-pointer text-sm ${readOnly ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <input type="radio" disabled={readOnly} checked={f.currencyPosition === v}
                  onChange={() => !readOnly && setF(p => ({ ...p, currencyPosition: v }))}
                  className="accent-indigo-600" />
                {v === 'before' ? 'Before amount (Rs. 100)' : 'After amount (100 Rs.)'}
              </label>
            ))}
          </div>
        </div>
        <div className="mt-3">
          <Field label="Date Format">
            <select disabled={readOnly} className={inp(readOnly)} value={f.dateFormat}
              onChange={e => setF(p => ({ ...p, dateFormat: e.target.value }))}>
              {['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD'].map(o => <option key={o}>{o}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {/* Tax */}
      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Tax</p>
        <Toggle label="Enable tax on sales" checked={f.taxEnabled} onChange={v => setF(p => ({ ...p, taxEnabled: v }))} disabled={readOnly} />
        {f.taxEnabled && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <Field label={`Tax Label (e.g. "VAT")`}>
                <input disabled={readOnly} className={inp(readOnly)} value={f.taxLabel}
                  onChange={e => setF(p => ({ ...p, taxLabel: e.target.value }))} />
              </Field>
              <Field label="Default Tax %">
                <input disabled={readOnly} className={inp(readOnly)} type="number" min={0} max={100} step={0.01}
                  value={f.defaultTaxPercent}
                  onChange={e => setF(p => ({ ...p, defaultTaxPercent: parseFloat(e.target.value) || 0 }))} />
              </Field>
            </div>
            <Field label="Tax Registration No.">
              <input disabled={readOnly} className={inp(readOnly)} value={f.taxNumber}
                onChange={e => setF(p => ({ ...p, taxNumber: e.target.value }))} placeholder="Tax / GSTIN / VAT number" />
            </Field>
            <Toggle label="Prices include tax (tax-inclusive)" checked={f.taxInclusive} onChange={v => setF(p => ({ ...p, taxInclusive: v }))} disabled={readOnly} />
          </div>
        )}
      </div>

      {/* Live preview */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Price Preview</p>
        <div className="space-y-1 text-sm font-mono">
          <div className="flex justify-between"><span className="text-slate-500">Item price</span><span>{fmt(sampleCents)}</span></div>
          {f.taxEnabled && <div className="flex justify-between"><span className="text-slate-500">{f.taxLabel} ({f.defaultTaxPercent}%)</span><span>{fmt(tax)}</span></div>}
          <div className="flex justify-between font-bold border-t border-slate-200 pt-1 mt-1">
            <span>Total</span><span>{fmt(total)}</span>
          </div>
        </div>
      </div>

      <SectionFooter onSave={handleSave} isPending={isPending} success={success} error={error} readOnly={readOnly} />
    </div>
  );
}

function PosPanel({ settings, onSave, isPending, readOnly }: {
  settings: AppSettings; onSave: (d: Partial<AppSettings>) => Promise<void>;
  isPending: boolean; readOnly?: boolean;
}) {
  const [f, setF] = useState({
    posRequireShift:     settings.posRequireShift,
    posAllowDiscount:    settings.posAllowDiscount,
    posApplyDefaultDiscount: settings.posApplyDefaultDiscount ?? true,
    posMaxDiscountPct:   settings.posMaxDiscountPct,
    posPrintReceipt:     settings.posPrintReceipt,
    expiredStockPolicy:  (settings.expiredStockPolicy ?? 'BLOCK') as 'BLOCK' | 'WARN' | 'ALLOW',
    staffSalesEnabled:   settings.staffSalesEnabled ?? false,
  });
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    try { return localStorage.getItem('erp_sound') !== 'off'; } catch { return true; }
  });
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleSave = async () => {
    setSuccess(false); setError(null);
    try {
      await onSave({
        posRequireShift:    f.posRequireShift,
        posAllowDiscount:   f.posAllowDiscount,
        posApplyDefaultDiscount: f.posApplyDefaultDiscount,
        posMaxDiscountPct:  f.posMaxDiscountPct,
        posPrintReceipt:    f.posPrintReceipt,
        expiredStockPolicy: f.expiredStockPolicy,
        staffSalesEnabled:  f.staffSalesEnabled,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Save failed');
    }
  };

  const POLICY_OPTIONS: { value: 'BLOCK' | 'WARN' | 'ALLOW'; label: string; desc: string }[] = [
    { value: 'BLOCK', label: 'Block completely',  desc: 'Expired items show as OUT OF STOCK. Cashier cannot sell them.' },
    { value: 'WARN',  label: 'Warn but allow',    desc: 'Warning shown. Cashier can proceed after confirmation.' },
    { value: 'ALLOW', label: 'Allow silently',    desc: 'No restriction applied. Expired stock can be sold freely.' },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Toggle label="Require shift to sell (cashiers must open a shift first)" checked={f.posRequireShift} onChange={v => setF(p => ({ ...p, posRequireShift: v }))} disabled={readOnly} />
        <Toggle label="Apply preset (default) discounts automatically" checked={f.posApplyDefaultDiscount} onChange={v => setF(p => ({ ...p, posApplyDefaultDiscount: v }))} disabled={readOnly} />
        <p className="text-xs text-slate-400 mt-1 mb-1">When on, each cart line is pre-filled with the product's / unit's preset discount. Turn off for fixed list-price selling.</p>
        <Toggle label="Allow manual discount at checkout" checked={f.posAllowDiscount} onChange={v => setF(p => ({ ...p, posAllowDiscount: v }))} disabled={readOnly} />
        {f.posAllowDiscount && (
          <div className="pl-0 pt-1">
            <Field label="Maximum Discount %">
              <input disabled={readOnly} className={inp(readOnly)} type="number" min={0} max={100} step={1}
                value={f.posMaxDiscountPct}
                onChange={e => setF(p => ({ ...p, posMaxDiscountPct: parseFloat(e.target.value) || 0 }))} />
            </Field>
          </div>
        )}
        <Toggle label="Print receipt after each sale" checked={f.posPrintReceipt} onChange={v => setF(p => ({ ...p, posPrintReceipt: v }))} disabled={readOnly} />
        <Toggle
          label="Enable staff sales (MANAGER/ADMIN can tag a sale as a staff purchase)"
          checked={f.staffSalesEnabled}
          onChange={v => setF(p => ({ ...p, staffSalesEnabled: v }))}
          disabled={readOnly}
        />
        <div className="flex items-center justify-between py-2">
          <div>
            <span className="text-sm text-slate-600">Sound Effects</span>
            <p className="text-xs text-slate-400">Beeps and chimes for POS actions (stored per device)</p>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !soundOn;
              setSoundOn(next);
              try { localStorage.setItem('erp_sound', next ? 'on' : 'off'); } catch { /* ignore */ }
            }}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${soundOn ? 'bg-indigo-600' : 'bg-slate-200'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${soundOn ? 'translate-x-4' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* Expired Stock Policy — 3-option radio */}
      <div>
        <p className="text-sm font-medium text-slate-700 mb-2">Expired Stock Policy</p>
        <div className="space-y-2">
          {POLICY_OPTIONS.map(opt => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition ${
                f.expiredStockPolicy === opt.value
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              } ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input
                type="radio"
                name="expiredStockPolicy"
                value={opt.value}
                checked={f.expiredStockPolicy === opt.value}
                onChange={() => !readOnly && setF(p => ({ ...p, expiredStockPolicy: opt.value }))}
                className="mt-0.5 shrink-0 accent-indigo-600"
                disabled={readOnly}
              />
              <div>
                <p className="text-sm font-medium text-slate-800">{opt.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{opt.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-400">Receipt layout and footer text are configured in the <strong>Receipt</strong> section.</p>
      <SectionFooter onSave={handleSave} isPending={isPending} success={success} error={error} readOnly={readOnly} />
    </div>
  );
}

function InvoicePanel({ settings, onSave, isPending, readOnly }: {
  settings: AppSettings; onSave: (d: Partial<AppSettings>) => Promise<void>;
  isPending: boolean; readOnly?: boolean;
}) {
  const [f, setF] = useState({
    invoicePrefix:  settings.invoicePrefix,
    invoiceStartNo: settings.invoiceStartNo,
    invoiceDueDays: settings.invoiceDueDays,
    purchasePrefix: settings.purchasePrefix,
    invoiceFooter:  settings.invoiceFooter ?? '',
    invoiceShowLogo: settings.invoiceShowLogo,
    documentTheme:  (settings.documentTheme ?? 'light') as 'dark' | 'light',
  });
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleSave = async () => {
    setSuccess(false); setError(null);
    try {
      await onSave({
        invoicePrefix:   f.invoicePrefix,
        invoiceStartNo:  f.invoiceStartNo,
        invoiceDueDays:  f.invoiceDueDays,
        purchasePrefix:  f.purchasePrefix,
        invoiceFooter:   f.invoiceFooter || null,
        invoiceShowLogo: f.invoiceShowLogo,
        documentTheme:   f.documentTheme,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Save failed');
    }
  };

  const year = new Date().getFullYear();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Invoice Prefix">
          <input disabled={readOnly} className={inp(readOnly)} value={f.invoicePrefix} maxLength={10}
            onChange={e => setF(p => ({ ...p, invoicePrefix: e.target.value }))} />
          <p className="text-xs text-slate-400 mt-1">Preview: {f.invoicePrefix}-{year}-0001</p>
        </Field>
        <Field label="Starting Number">
          <input disabled={readOnly} className={inp(readOnly)} type="number" min={1}
            value={f.invoiceStartNo}
            onChange={e => setF(p => ({ ...p, invoiceStartNo: parseInt(e.target.value) || 1 }))} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Payment Due (days)">
          <input disabled={readOnly} className={inp(readOnly)} type="number" min={0}
            value={f.invoiceDueDays}
            onChange={e => setF(p => ({ ...p, invoiceDueDays: parseInt(e.target.value) || 0 }))} />
        </Field>
        <Field label="Purchase Order Prefix">
          <input disabled={readOnly} className={inp(readOnly)} value={f.purchasePrefix} maxLength={10}
            onChange={e => setF(p => ({ ...p, purchasePrefix: e.target.value }))} />
          <p className="text-xs text-slate-400 mt-1">Preview: {f.purchasePrefix}-{year}-0001</p>
        </Field>
      </div>
      <Field label="Invoice Footer / Terms">
        <textarea disabled={readOnly} rows={3} className={inp(readOnly)}
          value={f.invoiceFooter}
          onChange={e => setF(p => ({ ...p, invoiceFooter: e.target.value }))}
          placeholder="Payment terms and conditions…" />
      </Field>
      <Toggle label="Show company logo on invoices" checked={f.invoiceShowLogo} onChange={v => setF(p => ({ ...p, invoiceShowLogo: v }))} disabled={readOnly} />

      <Field label="PDF Document Theme">
        <p className="text-xs text-slate-400 mb-2">Applies to invoices, purchase orders, credit notes and all reports.</p>
        <div className="grid grid-cols-2 gap-3">
          {([
            { value: 'dark',  title: 'Dark band',   desc: 'Slate letterhead, white text' },
            { value: 'light', title: 'Light',        desc: 'White letterhead, ink-friendly' },
          ] as const).map(opt => (
            <label
              key={opt.value}
              className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer transition ${
                f.documentTheme === opt.value ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'
              } ${readOnly ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              <input
                type="radio"
                name="documentTheme"
                className="mt-0.5"
                checked={f.documentTheme === opt.value}
                onChange={() => !readOnly && setF(p => ({ ...p, documentTheme: opt.value }))}
                disabled={readOnly}
              />
              <span>
                <span className="block text-sm font-medium text-slate-700">{opt.title}</span>
                <span className="block text-xs text-slate-400">{opt.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>

      <SectionFooter onSave={handleSave} isPending={isPending} success={success} error={error} readOnly={readOnly} />
    </div>
  );
}

function PermissionsPanel() {
  const ROLES = ['ADMIN', 'MANAGER', 'CASHIER', 'STAFF'];
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-2 pr-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Permission</th>
              {ROLES.map(r => (
                <th key={r} className="text-center py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-20">{r}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERM_GROUPS.map(group => (
              <Fragment key={group.label}>
                <tr>
                  <td colSpan={5} className="pt-4 pb-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{group.label}</span>
                  </td>
                </tr>
                {group.perms.map(perm => (
                  <tr key={perm.key} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2 pr-4 text-slate-600">{perm.label}</td>
                    {ROLES.map(role => (
                      <td key={role} className="text-center py-2 px-3">
                        {ROLE_MAP[role]?.has(perm.key)
                          ? <span className="inline-flex items-center justify-center w-5 h-5 bg-emerald-100 rounded-full"><Check size={11} className="text-emerald-600" /></span>
                          : <span className="text-slate-300 text-xs">—</span>
                        }
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400 pt-2">
        Permissions are role-based. Individual users can have custom overrides via User Management.
      </p>
    </div>
  );
}

function SecurityPanel({ settings, onSave, isPending, readOnly }: {
  settings: AppSettings; onSave: (d: Partial<AppSettings>) => Promise<void>;
  isPending: boolean; readOnly?: boolean;
}) {
  const TIMEOUT_OPTIONS = [
    { label: '30 minutes', value: 30 },
    { label: '1 hour',     value: 60 },
    { label: '2 hours',    value: 120 },
    { label: '4 hours',    value: 240 },
    { label: '8 hours',    value: 480 },
    { label: 'Never',      value: 0 },
  ];

  const [sessionTimeoutMin, setSessionTimeoutMin] = useState(settings.sessionTimeoutMin);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleSave = async () => {
    setSuccess(false); setError(null);
    try {
      await onSave({ sessionTimeoutMin });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Save failed');
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Session Timeout">
        <select disabled={readOnly} className={inp(readOnly)} value={sessionTimeoutMin}
          onChange={e => setSessionTimeoutMin(parseInt(e.target.value))}>
          {TIMEOUT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <p className="text-xs text-slate-400 mt-1">Auto-logout after this period of inactivity.</p>
      </Field>

      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Planned Features</p>
        <div className="flex items-center justify-between py-1 opacity-50">
          <span className="text-sm text-slate-600">Require password to void a sale</span>
          <span className="text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">Coming soon</span>
        </div>
        <div className="flex items-center justify-between py-1 opacity-50">
          <span className="text-sm text-slate-600">Two-factor authentication</span>
          <span className="text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">Coming soon</span>
        </div>
      </div>

      <SectionFooter onSave={handleSave} isPending={isPending} success={success} error={error} readOnly={readOnly} />
    </div>
  );
}

// ─── ReceiptPanel ─────────────────────────────────────────────────────────────

function ReceiptPanel({ settings, onSave, isPending, readOnly }: {
  settings: AppSettings; onSave: (d: Partial<AppSettings>) => Promise<void>;
  isPending: boolean; readOnly?: boolean;
}) {
  const [f, setF] = useState({
    receiptLanguage:    settings.receiptLanguage     ?? 'en',
    receiptPaperWidth:  settings.receiptPaperWidth   ?? '80mm',
    receiptShowLogo:    settings.receiptShowLogo     ?? true,
    receiptTagline:     settings.receiptTagline      ?? '',
    receiptHeaderLine1: settings.receiptHeaderLine1  ?? '',
    receiptHeaderLine2: settings.receiptHeaderLine2  ?? '',
    receiptShowSku:     settings.receiptShowSku      ?? false,
    receiptShowTax:     settings.receiptShowTax      ?? false,
    receiptShowCashier: settings.receiptShowCashier  ?? true,
    receiptShowBarcode: settings.receiptShowBarcode  ?? true,
    receiptQrEnabled:   settings.receiptQrEnabled    ?? false,
    posReceiptFooter:   settings.posReceiptFooter    ?? '',
    returnPolicy:       settings.returnPolicy        ?? '',
  });
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleSave = async () => {
    setSuccess(false); setError(null);
    try {
      await onSave({
        receiptLanguage:    f.receiptLanguage    as 'en' | 'si',
        receiptPaperWidth:  f.receiptPaperWidth  as '58mm' | '80mm',
        receiptShowLogo:    f.receiptShowLogo,
        receiptTagline:     f.receiptTagline     || null,
        receiptHeaderLine1: f.receiptHeaderLine1 || null,
        receiptHeaderLine2: f.receiptHeaderLine2 || null,
        receiptShowSku:     f.receiptShowSku,
        receiptShowTax:     f.receiptShowTax,
        receiptShowCashier: f.receiptShowCashier,
        receiptShowBarcode: f.receiptShowBarcode,
        receiptQrEnabled:   f.receiptQrEnabled,
        posReceiptFooter:   f.posReceiptFooter   || null,
        returnPolicy:       f.returnPolicy       || '',
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Save failed');
    }
  };

  // Live preview business name
  const bizName = settings.businessName || 'My Business';
  const sym     = settings.currencySymbol || 'Rs.';
  const fmt     = (c: number) => `${sym} ${(c / 100).toFixed(2)}`;

  return (
    <div className="space-y-5">

      {/* Paper & Language */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Paper &amp; Language</p>
        <div className="space-y-3">
          <Field label="Paper Width">
            <div className="flex gap-4">
              {(['58mm', '80mm'] as const).map(v => (
                <label key={v} className={`flex items-center gap-2 cursor-pointer text-sm ${readOnly ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <input type="radio" disabled={readOnly} checked={f.receiptPaperWidth === v}
                    onChange={() => !readOnly && setF(p => ({ ...p, receiptPaperWidth: v }))}
                    className="accent-indigo-600" />
                  {v === '58mm' ? '58mm (narrow)' : '80mm (standard)'}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Receipt Language">
            <div className="flex gap-4">
              <label className={`flex items-center gap-2 cursor-pointer text-sm ${readOnly ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <input type="radio" disabled={readOnly} checked={f.receiptLanguage === 'en'}
                  onChange={() => !readOnly && setF(p => ({ ...p, receiptLanguage: 'en' }))}
                  className="accent-indigo-600" />
                English
              </label>
              <label className={`flex items-center gap-2 cursor-pointer text-sm ${readOnly ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <input type="radio" disabled={readOnly} checked={f.receiptLanguage === 'si'}
                  onChange={() => !readOnly && setF(p => ({ ...p, receiptLanguage: 'si' }))}
                  className="accent-indigo-600" />
                සිංහල (Sinhala)
              </label>
            </div>
          </Field>
          {f.receiptLanguage === 'si' && (
            <div className="flex items-start gap-2 text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
              <span className="mt-0.5">ℹ️</span>
              <span>Product names remain in English. Only labels (totals, headers, column names) appear in Sinhala. Requires <strong>Noto Sans Sinhala</strong> font.</span>
            </div>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Header</p>
        <div className="space-y-3">
          <Toggle label="Show logo on receipt" checked={f.receiptShowLogo} onChange={v => setF(p => ({ ...p, receiptShowLogo: v }))} disabled={readOnly} />
          <Field label="Tagline">
            <input disabled={readOnly} className={inp(readOnly)} value={f.receiptTagline}
              onChange={e => setF(p => ({ ...p, receiptTagline: e.target.value }))}
              placeholder='e.g. "Your #1 choice in Colombo"' maxLength={200} />
          </Field>
          <Field label="Extra Header Line 1">
            <input disabled={readOnly} className={inp(readOnly)} value={f.receiptHeaderLine1}
              onChange={e => setF(p => ({ ...p, receiptHeaderLine1: e.target.value }))}
              placeholder="e.g. Reg. No: PV/12345" maxLength={200} />
          </Field>
          <Field label="Extra Header Line 2">
            <input disabled={readOnly} className={inp(readOnly)} value={f.receiptHeaderLine2}
              onChange={e => setF(p => ({ ...p, receiptHeaderLine2: e.target.value }))}
              placeholder="e.g. VAT Reg: 123-456-789" maxLength={200} />
          </Field>
        </div>
      </div>

      {/* Items */}
      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Items</p>
        <div className="space-y-1">
          <Toggle label="Show cashier name" checked={f.receiptShowCashier} onChange={v => setF(p => ({ ...p, receiptShowCashier: v }))} disabled={readOnly} />
          <Toggle label="Show product SKU below item name" checked={f.receiptShowSku} onChange={v => setF(p => ({ ...p, receiptShowSku: v }))} disabled={readOnly} />
          <Toggle label="Show tax amount separately" checked={f.receiptShowTax} onChange={v => setF(p => ({ ...p, receiptShowTax: v }))} disabled={readOnly} />
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Footer</p>
        <div className="space-y-3">
          <Field label="Receipt Footer Text">
            <textarea disabled={readOnly} rows={2} maxLength={300} className={inp(readOnly)}
              value={f.posReceiptFooter}
              onChange={e => setF(p => ({ ...p, posReceiptFooter: e.target.value }))}
              placeholder="Thank you for your purchase!" />
          </Field>
          <Field label="Return Policy">
            <textarea disabled={readOnly} rows={2} maxLength={500} className={inp(readOnly)}
              value={f.returnPolicy}
              onChange={e => setF(p => ({ ...p, returnPolicy: e.target.value }))}
              placeholder="e.g. Returns accepted within 7 days with receipt." />
            <p className="text-xs text-slate-400 mt-1">Printed at the bottom of every receipt.</p>
          </Field>
        </div>
      </div>

      {/* Barcode & QR */}
      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Barcode &amp; QR</p>
        <div className="space-y-1">
          <Toggle label="Print sale number as barcode" checked={f.receiptShowBarcode} onChange={v => setF(p => ({ ...p, receiptShowBarcode: v }))} disabled={readOnly} />
          <Toggle label="Print QR code (requires hosted URL)" checked={f.receiptQrEnabled} onChange={v => setF(p => ({ ...p, receiptQrEnabled: v }))} disabled={readOnly} />
          {f.receiptQrEnabled && (
            <p className="text-xs text-slate-400 pl-1">QR code feature requires a hosted URL — configure in advanced settings.</p>
          )}
        </div>
      </div>

      {/* Live preview */}
      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Preview</p>
        <div className="flex justify-center">
          <div
            style={{
              width: f.receiptPaperWidth === '58mm' ? 200 : 260,
              fontFamily: f.receiptLanguage === 'si' ? "'Noto Sans Sinhala', monospace" : "'Courier New', monospace",
              fontSize: 11,
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '12px 10px',
              background: '#fff',
              boxShadow: '2px 2px 8px rgba(0,0,0,0.08)',
              color: '#000',
              lineHeight: 1.5,
            }}
          >
            {f.receiptShowLogo && settings.logoUrl && (
              <div style={{ textAlign: 'center', marginBottom: 4 }}>
                <img src={settings.logoUrl} alt="logo" style={{ height: 32, objectFit: 'contain' }}
                  onError={e => (e.currentTarget.style.display = 'none')} />
              </div>
            )}
            <p style={{ textAlign: 'center', fontWeight: 700, fontSize: 13 }}>{bizName}</p>
            {settings.businessAddress && <p style={{ textAlign: 'center', fontSize: 9 }}>{settings.businessAddress}</p>}
            {f.receiptTagline && <p style={{ textAlign: 'center', fontSize: 9 }}>{f.receiptTagline}</p>}
            {f.receiptHeaderLine1 && <p style={{ textAlign: 'center', fontSize: 9 }}>{f.receiptHeaderLine1}</p>}
            {f.receiptHeaderLine2 && <p style={{ textAlign: 'center', fontSize: 9 }}>{f.receiptHeaderLine2}</p>}
            <p style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />
            <p style={{ fontSize: 9 }}><span style={{ display: 'inline-block', width: 70 }}>Invoice No.</span> INV-2026-0001</p>
            <p style={{ fontSize: 9 }}><span style={{ display: 'inline-block', width: 70 }}>Date</span> {new Date().toLocaleDateString()}</p>
            <p style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
              <span>Sample Product</span><span>{fmt(150000)}</span>
            </div>
            <p style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 12 }}>
              <span>TOTAL</span><span>{fmt(150000)}</span>
            </div>
            <p style={{ borderTop: '1px dashed #999', margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
              <span>Tendered</span><span>{fmt(160000)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontWeight: 700 }}>
              <span>Change</span><span>{fmt(10000)}</span>
            </div>
            <p style={{ fontSize: 9, margin: '2px 0' }}>Items: 2</p>
            {f.posReceiptFooter && (
              <>
                <p style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />
                <p style={{ textAlign: 'center', fontSize: 9 }}>{f.posReceiptFooter}</p>
              </>
            )}
            {f.returnPolicy && (
              <>
                <p style={{ borderTop: '1px dashed #999', margin: '6px 0' }} />
                <p style={{ textAlign: 'center', fontSize: 9, color: '#555' }}>{f.returnPolicy}</p>
              </>
            )}
          </div>
        </div>
      </div>

      <SectionFooter onSave={handleSave} isPending={isPending} success={success} error={error} readOnly={readOnly} />
    </div>
  );
}

// ─── AlertsPanel ──────────────────────────────────────────────────────────────

function AlertsPanel({ settings, onSave, isPending, readOnly }: {
  settings: AppSettings; onSave: (d: Partial<AppSettings>) => Promise<void>;
  isPending: boolean; readOnly?: boolean;
}) {
  const [f, setF] = useState({
    alertLowStockEnabled: settings.alertLowStockEnabled  ?? true,
    alertExpiryEnabled:   settings.alertExpiryEnabled    ?? true,
    alertExpiryDays:      settings.alertExpiryDays       ?? 30,
    alertLowStockEmail:   settings.alertLowStockEmail    ?? '',
    alertShowInDashboard: settings.alertShowInDashboard  ?? true,
    alertBellEnabled:     settings.alertBellEnabled      ?? true,
  });
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const watch = <K extends keyof typeof f>(key: K) => f[key];

  const handleSave = async () => {
    setSuccess(false); setError(null);
    try {
      await onSave({
        alertLowStockEnabled: f.alertLowStockEnabled,
        alertExpiryEnabled:   f.alertExpiryEnabled,
        alertExpiryDays:      f.alertExpiryDays,
        alertLowStockEmail:   f.alertLowStockEmail || null,
        alertShowInDashboard: f.alertShowInDashboard,
        alertBellEnabled:     f.alertBellEnabled,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Save failed');
    }
  };

  return (
    <div className="space-y-5">
      {/* Low Stock */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Low Stock Alerts</p>
        <div className="space-y-1">
          <Toggle label="Enable low stock alerts" checked={f.alertLowStockEnabled}
            onChange={v => setF(p => ({ ...p, alertLowStockEnabled: v }))} disabled={readOnly} />
          {f.alertLowStockEnabled && (
            <p className="text-xs text-slate-400 pl-1">Alert when stock falls below a product's reorder level.</p>
          )}
        </div>
      </div>

      {/* Expiry */}
      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Expiry Alerts</p>
        <div className="space-y-3">
          <Toggle label="Enable expiry alerts" checked={f.alertExpiryEnabled}
            onChange={v => setF(p => ({ ...p, alertExpiryEnabled: v }))} disabled={readOnly} />
          {watch('alertExpiryEnabled') && (
            <Field label={`Alert window (${f.alertExpiryDays} days before expiry)`}>
              <input disabled={readOnly} className={inp(readOnly)} type="number" min={1} max={365}
                value={f.alertExpiryDays}
                onChange={e => setF(p => ({ ...p, alertExpiryDays: parseInt(e.target.value) || 30 }))} />
              <p className="text-xs text-slate-400 mt-1">Products expiring within this window will show as warnings.</p>
            </Field>
          )}
        </div>
      </div>

      {/* Notifications */}
      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Notifications</p>
        <div className="space-y-1 mb-3">
          <Toggle label="Show alerts on dashboard" checked={f.alertShowInDashboard}
            onChange={v => setF(p => ({ ...p, alertShowInDashboard: v }))} disabled={readOnly} />
          <Toggle label="Show notification bell in sidebar" checked={f.alertBellEnabled}
            onChange={v => setF(p => ({ ...p, alertBellEnabled: v }))} disabled={readOnly} />
        </div>
        <Field label="Alert Email (optional)">
          <input disabled={readOnly} className={inp(readOnly)} type="email"
            value={f.alertLowStockEmail}
            onChange={e => setF(p => ({ ...p, alertLowStockEmail: e.target.value }))}
            placeholder="manager@business.com" />
          <p className="text-xs text-slate-400 mt-1">Email delivery requires SMTP configuration.</p>
        </Field>
      </div>

      {/* Info box */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-xs text-indigo-700 flex gap-2">
        <span>ℹ️</span>
        <span>Alerts are generated automatically when you view the Alerts page or Dashboard. No scheduled jobs required.</span>
      </div>

      <SectionFooter onSave={handleSave} isPending={isPending} success={success} error={error} readOnly={readOnly} />
    </div>
  );
}

// ─── WhatsApp panel ──────────────────────────────────────────────────────────

function WhatsAppPanel({ settings, onSave, isPending, readOnly }: {
  settings: AppSettings; onSave: (d: Partial<AppSettings>) => Promise<void>;
  isPending: boolean; readOnly?: boolean;
}) {
  const [f, setF] = useState({
    whatsappEnabled:       settings.whatsappEnabled       ?? false,
    whatsappPhone:         settings.whatsappPhone         ?? '',
    waReceiptTemplate:     settings.waReceiptTemplate     ?? DEFAULT_RECEIPT_TEMPLATE,
    waOutstandingTemplate: settings.waOutstandingTemplate ?? DEFAULT_OUTSTANDING_TEMPLATE,
    waPayableTemplate:     settings.waPayableTemplate     ?? DEFAULT_PAYABLE_TEMPLATE,
    waOfferTemplate:       settings.waOfferTemplate       ?? DEFAULT_OFFER_TEMPLATE,
    whatsappOpenMode:      (settings.whatsappOpenMode ?? 'app') as 'app' | 'browser',
  });
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const handleSave = async () => {
    setSuccess(false); setError(null);
    try {
      await onSave({
        whatsappEnabled:       f.whatsappEnabled,
        whatsappPhone:         f.whatsappPhone || null,
        waReceiptTemplate:     f.waReceiptTemplate || null,
        waOutstandingTemplate: f.waOutstandingTemplate || null,
        waPayableTemplate:     f.waPayableTemplate || null,
        waOfferTemplate:       f.waOfferTemplate || null,
        whatsappOpenMode:      f.whatsappOpenMode,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Save failed');
    }
  };

  const hint = 'text-xs text-slate-400 mt-1';

  return (
    <div className="space-y-5">
      <div>
        <p className="text-base font-semibold text-slate-800 mb-1">💬 WhatsApp Messaging</p>
        <p className="text-sm text-slate-500">Send receipts, reminders and offers to customers over WhatsApp.</p>
      </div>

      {/* Enable + number */}
      <div className="border-t border-slate-100 pt-4 space-y-3">
        <Toggle label="Enable WhatsApp messaging" checked={f.whatsappEnabled}
          onChange={v => setF(p => ({ ...p, whatsappEnabled: v }))} disabled={readOnly} />
        <Field label="Business WhatsApp number">
          <input disabled={readOnly} className={inp(readOnly)} type="tel" maxLength={20}
            value={f.whatsappPhone}
            onChange={e => setF(p => ({ ...p, whatsappPhone: e.target.value.replace(/[^\d+]/g, '') }))}
            placeholder="+94771234567" />
          <p className={hint}>Country code + number, e.g. +94771234567. Digits and a leading + only. Reserved for future use (e.g. receipt footer / automated sending) — messages today are sent from whichever WhatsApp account is logged in on this PC.</p>
        </Field>

        <Field label="Open WhatsApp in">
          <p className={hint + ' !mt-0 mb-2'}>Where the Send buttons open a chat.</p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { value: 'app',     title: 'Desktop app', desc: 'Opens WhatsApp Desktop directly' },
              { value: 'browser', title: 'Browser',     desc: 'Opens WhatsApp Web (wa.me)' },
            ] as const).map(opt => (
              <label
                key={opt.value}
                className={`flex items-start gap-2 rounded-lg border p-3 cursor-pointer transition ${
                  f.whatsappOpenMode === opt.value ? 'border-green-500 bg-green-50' : 'border-slate-200 hover:border-slate-300'
                } ${readOnly ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <input
                  type="radio"
                  name="whatsappOpenMode"
                  className="mt-0.5"
                  checked={f.whatsappOpenMode === opt.value}
                  onChange={() => !readOnly && setF(p => ({ ...p, whatsappOpenMode: opt.value }))}
                  disabled={readOnly}
                />
                <span>
                  <span className="block text-sm font-medium text-slate-700">{opt.title}</span>
                  <span className="block text-xs text-slate-400">{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>
          <p className={hint}>Desktop app requires WhatsApp Desktop installed on this PC.</p>
        </Field>
      </div>

      {/* Receipt template */}
      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Receipt Message</p>
        <textarea disabled={readOnly} className={inp(readOnly) + ' resize-none font-mono'} rows={6}
          value={f.waReceiptTemplate}
          onChange={e => setF(p => ({ ...p, waReceiptTemplate: e.target.value }))} />
        <p className={hint}>Variables: {'{customerName}'} {'{businessName}'} {'{invoiceNumber}'} {'{date}'} {'{items}'} {'{total}'}</p>
      </div>

      {/* Outstanding template — customer direction */}
      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Customer Outstanding Reminder</p>
        <textarea disabled={readOnly} className={inp(readOnly) + ' resize-none font-mono'} rows={4}
          value={f.waOutstandingTemplate}
          onChange={e => setF(p => ({ ...p, waOutstandingTemplate: e.target.value }))} />
        <p className={hint}>Variables: {'{customerName}'} {'{businessName}'} {'{outstanding}'}</p>
      </div>

      {/* Payable template — supplier direction */}
      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Supplier Payable Reminder</p>
        <textarea disabled={readOnly} className={inp(readOnly) + ' resize-none font-mono'} rows={4}
          value={f.waPayableTemplate}
          onChange={e => setF(p => ({ ...p, waPayableTemplate: e.target.value }))} />
        <p className={hint}>Variables: {'{supplierName}'} {'{businessName}'} {'{outstanding}'}</p>
      </div>

      {/* Offer template */}
      <div className="border-t border-slate-100 pt-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Promotional Offer</p>
        <textarea disabled={readOnly} className={inp(readOnly) + ' resize-none font-mono'} rows={4}
          value={f.waOfferTemplate}
          onChange={e => setF(p => ({ ...p, waOfferTemplate: e.target.value }))} />
        <p className={hint}>Variables: {'{customerName}'} {'{businessName}'} {'{offer}'}</p>
      </div>

      <SectionFooter onSave={handleSave} isPending={isPending} success={success} error={error} readOnly={readOnly} />
    </div>
  );
}

// ─── Section config ────────────────────────────────────────────────────────────

// ─── Modules panel ───────────────────────────────────────────────────────────

function ModulesPanel({ settings, readOnly }: {
  settings: AppSettings; readOnly?: boolean;
}) {
  const qc = useQueryClient();
  const [flags, setFlags] = useState<Record<string, boolean>>({ ...(settings.moduleFlags ?? {}) });
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (fl: Record<string, boolean>) => settingsApi.updateModules(fl),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['app-settings'] }); setSuccess(true); setTimeout(() => setSuccess(false), 3000); },
    onError: (e: unknown) => setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Save failed'),
  });

  const handleSave = () => { setSuccess(false); setError(null); mutation.mutate(flags); };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-base font-semibold text-slate-800 mb-1">🛡️ Optional Modules — Super Admin</p>
        <p className="text-sm text-slate-500">Enable or disable optional features for this client. Disabled features are hidden throughout the app and blocked on the server.</p>
      </div>

      <div className="border-t border-slate-100 pt-4 space-y-3">
        {OPTIONAL_MODULES.map((key) => {
          const meta = MODULE_META[key];
          const Icon = meta.icon;
          const on   = flags[key] === true;
          return (
            <div key={key} className={`flex items-center gap-3 rounded-lg border p-3 transition ${on ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200'}`}>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${on ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                <Icon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">{meta.label}</p>
                <p className="text-xs text-slate-400">{meta.description}</p>
              </div>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => setFlags(p => ({ ...p, [key]: !on }))}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${on ? 'bg-indigo-600' : 'bg-slate-200'} ${readOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                aria-label={`Toggle ${meta.label}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-1'}`} />
              </button>
            </div>
          );
        })}
      </div>

      <SectionFooter onSave={handleSave} isPending={mutation.isPending} success={success} error={error} readOnly={readOnly} />
    </div>
  );
}

type SectionKey = 'company' | 'tax' | 'pos' | 'invoice' | 'receipt' | 'alerts' | 'whatsapp' | 'modules' | 'permissions' | 'security';

const SECTIONS: { key: SectionKey; label: string; icon: React.ElementType; description: string }[] = [
  { key: 'company',     label: 'Company',        icon: Building2,   description: 'Business name, address, logo' },
  { key: 'modules',     label: 'Modules',        icon: LayoutGrid,  description: 'Turn optional features on or off' },
  { key: 'tax',         label: 'Tax & Currency',  icon: Percent,     description: 'Currency symbol, tax rates' },
  { key: 'pos',         label: 'POS',             icon: ShoppingCart,description: 'Shift, discounts, print' },
  { key: 'invoice',     label: 'Invoice',         icon: FileText,    description: 'Prefixes, due dates, footer' },
  { key: 'receipt',     label: 'Receipt',         icon: Printer,     description: 'Paper, language, layout, footer' },
  { key: 'alerts',      label: 'Alerts',          icon: Bell,        description: 'Low stock and expiry alert settings' },
  { key: 'whatsapp',    label: 'WhatsApp',        icon: MessageCircle, description: 'Messaging number and templates' },
  { key: 'permissions', label: 'Permissions',     icon: Eye,         description: 'Role permission matrix' },
  { key: 'security',    label: 'Security',        icon: ShieldCheck, description: 'Session timeout' },
];

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { user }  = useAuthStore();
  const qc        = useQueryClient();

  const readOnly = user?.role === 'CASHIER' || user?.role === 'STAFF';

  // Module on/off is super-admin only — hide the Modules tab from everyone else.
  const canManageModules = user?.role === 'SUPER_ADMIN' || (user?.permissions?.includes('manage_modules') ?? false);
  // WhatsApp config tab only when the WhatsApp module is enabled (super-admin bypasses).
  const waModule = useModule('whatsapp');
  const visibleSections = SECTIONS.filter(s =>
    (s.key !== 'modules'  || canManageModules) &&
    (s.key !== 'whatsapp' || waModule),
  );

  const activeKey: SectionKey = (() => {
    const hash = location.hash.replace('#', '') as SectionKey;
    return visibleSections.find(s => s.key === hash) ? hash : 'company';
  })();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['app-settings'],
    queryFn:  settingsApi.get,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: settingsApi.update,
    onSuccess: (updated) => {
      qc.setQueryData(['app-settings'], updated);
    },
  });

  // Propagate save errors to the panel via thrown promise
  const handleSave = (data: Partial<AppSettings>): Promise<void> =>
    mutation.mutateAsync(data).then(() => undefined);

  const activeSection = visibleSections.find(s => s.key === activeKey)!;
  const ActiveIcon    = activeSection.icon;

  // Skeleton while loading
  if (isLoading) {
    return (
      <div className="flex h-full bg-slate-50 items-center justify-center">
        <div className="text-slate-400 text-sm flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin" />
          Loading settings…
        </div>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="flex h-full bg-slate-50">
      {/* ── Left sidebar ── */}
      <aside className="w-56 bg-white border-r border-slate-200 shrink-0 overflow-y-auto">
        <div className="px-4 py-4 border-b border-slate-200">
          <h1 className="text-base font-bold text-slate-800">Settings</h1>
          <p className="text-xs text-slate-400 mt-0.5">System configuration</p>
        </div>
        {readOnly && (
          <div className="mx-3 mt-3 px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-1.5 text-xs text-amber-700">
            <Lock size={11} /> Read-only access
          </div>
        )}
        <nav className="p-2 space-y-0.5">
          {visibleSections.map(s => {
            const Icon   = s.icon;
            const active = activeKey === s.key;
            return (
              <button
                key={s.key}
                onClick={() => navigate(`/settings#${s.key}`)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors ${active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'}`}
              >
                <Icon size={15} className="shrink-0" />
                <span className="flex-1 text-sm font-medium">{s.label}</span>
                {active && <ChevronRight size={13} className="text-indigo-400" />}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* ── Right content ── */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl">
          {/* Read-only banner */}
          {readOnly && (
            <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
              <Lock size={15} />
              You have read-only access to settings. Contact an admin to make changes.
            </div>
          )}

          {/* Section header */}
          <div className="mb-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
              <ActiveIcon size={20} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">{activeSection.label}</h2>
              <p className="text-sm text-slate-500">{activeSection.description}</p>
            </div>
          </div>

          {/* Panel card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            {activeKey === 'company'     && <CompanyPanel     settings={settings} onSave={handleSave} isPending={mutation.isPending} readOnly={readOnly} />}
            {activeKey === 'tax'         && <TaxPanel         settings={settings} onSave={handleSave} isPending={mutation.isPending} readOnly={readOnly} />}
            {activeKey === 'pos'         && <PosPanel         settings={settings} onSave={handleSave} isPending={mutation.isPending} readOnly={readOnly} />}
            {activeKey === 'invoice'     && <InvoicePanel     settings={settings} onSave={handleSave} isPending={mutation.isPending} readOnly={readOnly} />}
            {activeKey === 'receipt'     && <ReceiptPanel     settings={settings} onSave={handleSave} isPending={mutation.isPending} readOnly={readOnly} />}
            {activeKey === 'alerts'      && <AlertsPanel      settings={settings} onSave={handleSave} isPending={mutation.isPending} readOnly={readOnly} />}
            {activeKey === 'whatsapp'    && <WhatsAppPanel    settings={settings} onSave={handleSave} isPending={mutation.isPending} readOnly={readOnly} />}
            {activeKey === 'modules'     && <ModulesPanel     settings={settings} readOnly={readOnly} />}
            {activeKey === 'permissions' && <PermissionsPanel />}
            {activeKey === 'security'    && <SecurityPanel    settings={settings} onSave={handleSave} isPending={mutation.isPending} readOnly={readOnly} />}
          </div>
        </div>
      </main>
    </div>
  );
}
