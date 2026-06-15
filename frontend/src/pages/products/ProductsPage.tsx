import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, X, ChevronLeft, ChevronRight, Edit2,
  AlertTriangle, Clock, Package, ExternalLink, Tag,
  CheckCircle, XCircle, Barcode, Eye, RefreshCw,
  Trash2, Loader2, RotateCcw,
} from 'lucide-react';
import axios from 'axios';
import {
  productsApi,
  formatCents,
  totalStock,
  marginPct,
  type Product,
  type CreateProductPayload,
} from '../../services/products';
import {
  unitsApi,
  type ConversionLinePayload,
} from '../../services/units';
import { inventoryApi, type BatchDetail } from '../../services/inventory';
import { purchasesApi } from '../../services/purchases';
import { daysUntilExpiry } from '../../services/pos';
import { categoriesApi, brandsApi } from '../../services/masterData';
import SearchableSelect from '../../components/common/SearchableSelect';

// v1.0.44 — localStorage key for the in-progress product-form draft. Lets a
// half-filled form survive a session expiry / reload so the user can recover it.
const PRODUCT_DRAFT_KEY = 'brocode_product_draft';

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterActive = 'true' | 'false' | 'all';

type BarcodeCheckState =
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'taken'; product: Product };

interface FormState {
  name: string;
  sku: string;
  barcode: string;
  description: string;
  categoryId: string;
  brandId: string;
  unitId: string;
  baseUnitId: string;
  purchaseUnitId: string;
  salesUnitId: string;
  receiptName: string;
  cost: string;
  price: string;
  defaultDiscount: string;
  serviceCharge: string;
  serviceChargeLabel: string;
  serviceChargeMode: string;
  taxPercent: string;
  reorderLevel: string;
  reorderQty: string;
  expiryDate: string;
  expiryAlertDays: string;
  isBatchTracked: boolean;
  defaultSupplierId: string;
  isActive: boolean;
}

interface ConversionLine {
  key: number;
  fromUnitId: string;
  toUnitId: string;
  conversionQty: string;
  priceCents: string;
  barcode: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyForm(): FormState {
  return {
    name: '', sku: '', barcode: '', description: '',
    categoryId: '', brandId: '',
    unitId: '', baseUnitId: '', purchaseUnitId: '', salesUnitId: '',
    receiptName: '',
    cost: '', price: '', defaultDiscount: '', serviceCharge: '', serviceChargeLabel: '', serviceChargeMode: 'per_unit', taxPercent: '0',
    reorderLevel: '0', reorderQty: '0',
    expiryDate: '', expiryAlertDays: '30',
    isBatchTracked: false,
    defaultSupplierId: '',
    isActive: true,
  };
}

function formFromProduct(p: Product): FormState {
  return {
    name: p.name,
    sku: p.sku,
    barcode: p.barcode ?? '',
    description: p.description ?? '',
    categoryId: p.categoryId ?? '',
    brandId: p.brandId ?? '',
    unitId: p.unit?.id ?? '',
    baseUnitId: p.baseUnitId ?? '',
    purchaseUnitId: p.purchaseUnitId ?? '',
    salesUnitId: p.salesUnitId ?? '',
    receiptName: p.receiptName ?? '',
    cost: (p.costCents / 100).toFixed(2),
    price: (p.priceCents / 100).toFixed(2),
    defaultDiscount: p.defaultDiscountCents > 0 ? (p.defaultDiscountCents / 100).toFixed(2) : '',
    serviceCharge: (p.serviceChargeCents ?? 0) > 0 ? ((p.serviceChargeCents ?? 0) / 100).toFixed(2) : '',
    serviceChargeLabel: p.serviceChargeLabel ?? '',
    serviceChargeMode: p.serviceChargeMode ?? 'per_unit',
    taxPercent: String(p.taxPercent),
    reorderLevel: String(p.reorderLevel),
    reorderQty: String(p.reorderQty),
    expiryDate: p.expiryDate ? p.expiryDate.substring(0, 10) : '',
    expiryAlertDays: String(p.expiryAlertDays),
    isBatchTracked: p.isBatchTracked ?? false,
    defaultSupplierId: p.defaultSupplierId ?? '',
    isActive: p.isActive,
  };
}

function marginColor(pct: number): string {
  if (pct < 0) return 'text-red-600 font-semibold';
  if (pct < 10) return 'text-amber-600';
  if (pct < 20) return 'text-yellow-600';
  return 'text-green-600';
}

function ExpiryBadge({
  expiryDate,
  alertDays,
}: {
  expiryDate: string | null;
  alertDays: number;
}) {
  const days = daysUntilExpiry(expiryDate);
  if (days === null) return <span className="text-slate-300 text-xs">—</span>;
  if (days < 0)
    return (
      <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
        <AlertTriangle size={9} /> Expired
      </span>
    );
  if (days <= alertDays)
    return (
      <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
        <Clock size={9} /> {days}d
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-[10px] px-1.5 py-0.5 rounded-full font-medium">
      <CheckCircle size={9} /> OK
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export default function ProductsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  // ── List filters ──
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [page, setPage] = useState(1);
  // ── Recycle bin: show soft-deleted (inactive) products ──
  const [showDeleted, setShowDeleted] = useState(false);

  // ── Delete confirmation + list-level toast ──
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [listToast, setListToast] = useState<string | null>(null);

  // ── Drawer ──
  const [drawer, setDrawer] = useState<Product | null>(null);

  // ── Modal ──
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formErr, setFormErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Form draft recovery (v1.0.44) ──
  const [draftFound, setDraftFound] = useState<{ form: FormState; savedAt: string } | null>(null);

  // ── Barcode check ──
  const [barcodeCheck, setBarcodeCheck] = useState<BarcodeCheckState | null>(null);
  const checkIdRef = useRef(0);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // ── Unit conversions in modal ──
  const [conversions, setConversions] = useState<ConversionLine[]>([]);
  const convKeyRef = useRef(0);

  // ── Write-off (drawer) ──
  const [writeOffBatch, setWriteOffBatch] = useState<BatchDetail | null>(null);
  const [writeOffQty, setWriteOffQty] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('');
  const [writeOffWarehouseId, setWriteOffWarehouseId] = useState('');
  const [drawerToast, setDrawerToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: productsData, isLoading, refetch } = useQuery({
    queryKey: ['products', search, categoryFilter, brandFilter, page, showDeleted],
    queryFn: () =>
      productsApi.list({
        search: search || undefined,
        isActive: showDeleted ? 'false' : 'true',
        categoryId: categoryFilter || undefined,
        brandId: brandFilter || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    staleTime: 30_000,
  });

  const { data: meta } = useQuery({
    queryKey: ['products-meta'],
    queryFn: productsApi.meta,
    staleTime: 5 * 60_000,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['purchase-suppliers'],
    queryFn:  purchasesApi.listSuppliers,
    staleTime: 5 * 60_000,
  });

  // Per-warehouse batch detail for the open drawer
  const { data: allBatches = [], refetch: refetchBatches } = useQuery({
    queryKey: ['product-batches', drawer?.id],
    queryFn: async () => {
      if (!drawer) return [];
      const rows: Array<{ warehouseId: string; warehouseName: string; batches: BatchDetail[] }> = [];
      for (const s of drawer.stock) {
        const batches = await inventoryApi.getBatchDetail(drawer.id, s.warehouseId);
        if (batches.length > 0) rows.push({ warehouseId: s.warehouseId, warehouseName: s.warehouse.name, batches });
      }
      return rows;
    },
    enabled: !!drawer,
    staleTime: 0,
  });

  const allUnits = meta?.units ?? [];
  const products = productsData?.data ?? [];
  const total = productsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Load existing conversions when editing a product
  useEffect(() => {
    if (!editingProduct) return;
    unitsApi
      .getConversions(editingProduct.id)
      .then((rows) => {
        setConversions(
          rows.map((r) => ({
            key: ++convKeyRef.current,
            fromUnitId: r.fromUnitId,
            toUnitId: r.toUnitId,
            conversionQty: String(r.conversionQty),
            priceCents: r.priceCents != null ? (r.priceCents / 100).toFixed(2) : '',
            barcode: r.barcode ?? '',
          }))
        );
      })
      .catch(() => {/* no conversions yet */});
  }, [editingProduct]);

  // v1.0.44 — auto-save the in-progress form to localStorage (debounced 1s).
  // Only while the modal is open and a name has been entered.
  useEffect(() => {
    if (!modalOpen) return;
    if (!form.name?.trim()) return;

    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          PRODUCT_DRAFT_KEY,
          JSON.stringify({ form, savedAt: new Date().toISOString() }),
        );
      } catch {
        // localStorage full — ignore
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [form, modalOpen]);

  // v1.0.44 — on mount, surface any saved draft so the user can recover it.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRODUCT_DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft?.form?.name?.trim()) {
        setDraftFound(draft);
      }
    } catch {
      localStorage.removeItem(PRODUCT_DRAFT_KEY);
    }
  }, []);

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (payload: CreateProductPayload) => productsApi.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products-meta'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<CreateProductPayload> }) =>
      productsApi.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => {
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['products'] });
      setListToast('Product deleted');
      setTimeout(() => setListToast(null), 3000);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Delete failed';
      setListToast(msg);
      setTimeout(() => setListToast(null), 4000);
    },
  });

  // Restore (reactivate) a soft-deleted product via the existing toggle-active endpoint.
  const restoreMutation = useMutation({
    mutationFn: (id: string) => productsApi.toggleActive(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      setListToast('Product restored');
      setTimeout(() => setListToast(null), 3000);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Restore failed';
      setListToast(msg);
      setTimeout(() => setListToast(null), 4000);
    },
  });

  const writeOffMutation = useMutation({
    mutationFn: (payload: { batchId: string; warehouseId: string; qty: number; reason: string }) =>
      inventoryApi.writeOff(payload),
    onSuccess: (result) => {
      setWriteOffBatch(null);
      setWriteOffQty('');
      setWriteOffReason('');
      setWriteOffWarehouseId('');
      refetchBatches();
      qc.invalidateQueries({ queryKey: ['products'] });
      setDrawerToast({ msg: `Written off ${result.qty} unit(s). Loss: ${(result.lossCents / 100).toFixed(2)}`, ok: true });
      setTimeout(() => setDrawerToast(null), 4000);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Write-off failed';
      setDrawerToast({ msg, ok: false });
      setTimeout(() => setDrawerToast(null), 4000);
    },
  });

  // ── checkBarcode ──────────────────────────────────────────────────────────────
  // Fixed: stale-check guard + 5-second timeout so "Checking..." never gets stuck.

  async function checkBarcode(value: string) {
    const trimmed = value.trim();

    // Clear state if empty
    if (!trimmed) {
      setBarcodeCheck(null);
      return;
    }

    // Increment check ID to detect stale calls
    const thisCheck = ++checkIdRef.current;
    setBarcodeCheck({ state: 'checking' });

    // Timeout guard — max 5 seconds
    const timeout = setTimeout(() => {
      if (checkIdRef.current === thisCheck) {
        setBarcodeCheck(null);
      }
    }, 5000);

    try {
      const found = await productsApi.getByBarcode(trimmed);

      clearTimeout(timeout);
      if (checkIdRef.current !== thisCheck) return; // stale, ignore

      // Same product (editing mode) → still available
      if (found.id === editingProduct?.id) {
        setBarcodeCheck({ state: 'available' });
      } else {
        setBarcodeCheck({ state: 'taken', product: found });
      }
    } catch (err: unknown) {
      clearTimeout(timeout);
      if (checkIdRef.current !== thisCheck) return; // stale, ignore

      if (axios.isAxiosError(err) && err.response?.status === 404) {
        // Available
        setBarcodeCheck({ state: 'available' });
        // Auto-focus name if empty
        if (!form.name) {
          nameInputRef.current?.focus();
        }
        // Clear "available" after 2 s
        setTimeout(() => {
          setBarcodeCheck(null);
        }, 2000);
      } else {
        // Network error — clear silently
        setBarcodeCheck(null);
      }
    }
  }

  function handleBarcodeChange(value: string) {
    setForm((f) => ({ ...f, barcode: value }));
  }

  // ── Open modal helpers ────────────────────────────────────────────────────────

  function openNew() {
    setEditingProduct(null);
    setForm(emptyForm());
    setConversions([]);
    setBarcodeCheck(null);
    checkIdRef.current++;
    setFormErr(null);
    setModalOpen(true);
  }

  function openEdit(p: Product) {
    setEditingProduct(p);
    setForm(formFromProduct(p));
    setConversions([]);
    setBarcodeCheck(null);
    checkIdRef.current++;
    setFormErr(null);
    setModalOpen(true);
  }

  function closeModal() {
    localStorage.removeItem(PRODUCT_DRAFT_KEY); // v1.0.44 — discard draft on cancel/close
    setModalOpen(false);
    checkIdRef.current++; // cancel any in-flight barcode check
    setBarcodeCheck(null);
  }

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormErr(null);

    if (!form.name.trim()) { setFormErr('Product name is required'); return; }
    if (!form.unitId && !form.baseUnitId) { setFormErr('Select at least a display unit or base unit'); return; }

    const costCents            = Math.round(parseFloat(form.cost  || '0') * 100);
    const priceCents           = Math.round(parseFloat(form.price || '0') * 100);
    const defaultDiscountCents = Math.round(parseFloat(form.defaultDiscount || '0') * 100);
    const serviceChargeCents   = Math.round(parseFloat(form.serviceCharge || '0') * 100);
    if (isNaN(costCents) || isNaN(priceCents)) {
      setFormErr('Enter valid cost and price');
      return;
    }

    const payload: CreateProductPayload = {
      name:        form.name.trim(),
      sku:         form.sku.trim() || undefined,
      barcode:     form.barcode.trim() || null,
      description: form.description.trim() || null,
      categoryId:  form.categoryId || null,
      brandId:     form.brandId || null,
      unitId:      form.unitId || (form.baseUnitId as string),
      baseUnitId:     form.baseUnitId || null,
      purchaseUnitId: form.purchaseUnitId || null,
      salesUnitId:    form.salesUnitId || null,
      receiptName:   form.receiptName.trim() || null,
      costCents,
      priceCents,
      defaultDiscountCents,
      serviceChargeCents,
      serviceChargeLabel: form.serviceChargeLabel.trim() || null,
      serviceChargeMode: form.serviceChargeMode || 'per_unit',
      taxPercent:   parseFloat(form.taxPercent) || 0,
      reorderLevel: parseInt(form.reorderLevel) || 0,
      reorderQty:   parseInt(form.reorderQty) || 0,
      expiryDate:        form.expiryDate || null,
      expiryAlertDays:   parseInt(form.expiryAlertDays) || 30,
      isBatchTracked:    form.isBatchTracked,
      defaultSupplierId: form.defaultSupplierId || null,
      isActive:          form.isActive,
    };

    // Build conversions payload
    const convPayload: ConversionLinePayload[] = conversions
      .filter((c) => c.fromUnitId && c.toUnitId && c.conversionQty)
      .map((c) => ({
        fromUnitId:    c.fromUnitId,
        toUnitId:      c.toUnitId,
        conversionQty: parseFloat(c.conversionQty),
        priceCents:    c.priceCents ? Math.round(parseFloat(c.priceCents) * 100) : null,
        barcode:       c.barcode.trim() || null,
      }));

    // v1.0.45 — unit validation.
    const effectiveBase = form.baseUnitId || form.unitId || '';

    // PURCHASE UNIT — hard block.
    // Purchase unit needs a conversion FROM it TO the base unit so stock math
    // works correctly on purchase confirm.
    if (form.purchaseUnitId && form.purchaseUnitId !== effectiveBase) {
      const hasPurchaseConv = conversions.some((c) => c.fromUnitId === form.purchaseUnitId);
      if (!hasPurchaseConv) {
        setFormErr(
          'Purchase Unit differs from Base Unit. Add a conversion: ' +
          '1 [Purchase Unit] = X [Base Unit] (e.g. 1 Bottle = 5000 Gram).',
        );
        return;
      }
    }

    // SALES UNIT — warning only, do NOT block save (handled via hint text in UI).

    setSaving(true);
    try {
      if (editingProduct) {
        await updateMutation.mutateAsync({ id: editingProduct.id, payload });
        if (convPayload.length > 0 || conversions.length === 0) {
          await unitsApi.setConversions(editingProduct.id, convPayload);
        }
      } else {
        const created = await createMutation.mutateAsync(payload);
        if (convPayload.length > 0) {
          await unitsApi.setConversions(created.id, convPayload);
        }
      }
      localStorage.removeItem(PRODUCT_DRAFT_KEY); // v1.0.44 — saved successfully, drop draft
      setDraftFound(null);
      closeModal();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message ?? 'Save failed';
      setFormErr(msg);
    } finally {
      setSaving(false);
    }
  }

  // ── Conversion row helpers ────────────────────────────────────────────────────

  function addConversionRow() {
    setConversions((prev) => [
      ...prev,
      { key: ++convKeyRef.current, fromUnitId: '', toUnitId: '', conversionQty: '', priceCents: '', barcode: '' },
    ]);
  }

  function updateConvRow(key: number, patch: Partial<ConversionLine>) {
    setConversions((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function removeConvRow(key: number) {
    setConversions((prev) => prev.filter((r) => r.key !== key));
  }

  // ── Computed margin preview ───────────────────────────────────────────────────

  const previewMargin = (() => {
    const c = parseFloat(form.cost || '0');
    const p = parseFloat(form.price || '0');
    if (!p) return null;
    return Math.round(((p - c) / p) * 1000) / 10;
  })();

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Package size={20} className="text-indigo-600" /> Products
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {total.toLocaleString()} product{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/barcode-labels')}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition"
          >
            <Barcode size={14} /> Labels
          </button>
          <button
            type="button"
            onClick={() => { setShowDeleted((d) => !d); setPage(1); }}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition ${
              showDeleted
                ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
            }`}
          >
            <Trash2 size={14} />
            {showDeleted ? 'Hide Deleted' : 'Recently Deleted'}
          </button>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition shadow-sm"
          >
            <Plus size={15} /> New Product
          </button>
        </div>
      </div>

      {/* ── Recycle-bin banner ──────────────────────────────────────────────── */}
      {showDeleted && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-2 text-sm text-red-700 flex items-center gap-2 shrink-0">
          <AlertTriangle size={15} />
          Showing deleted products. These are hidden from POS and reports. Click Restore to reactivate.
        </div>
      )}

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-100 px-6 py-2.5 flex flex-wrap items-center gap-3 shrink-0">
        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search name, SKU…"
            className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 w-52"
          />
        </div>

        {/* Category filter */}
        {(meta?.categories ?? []).length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-slate-600"
          >
            <option value="">All categories</option>
            {(meta?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}

        {/* Brand filter */}
        {(meta?.brands ?? []).length > 0 && (
          <select
            value={brandFilter}
            onChange={(e) => { setBrandFilter(e.target.value); setPage(1); }}
            className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-slate-600"
          >
            <option value="">All brands</option>
            {(meta?.brands ?? []).map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}

        {/* Clear filters */}
        {(search || categoryFilter || brandFilter) && (
          <button
            onClick={() => { setSearch(''); setCategoryFilter(''); setBrandFilter(''); setPage(1); }}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition"
          >
            <X size={12} /> Clear
          </button>
        )}

        <button
          onClick={() => refetch()}
          className="ml-auto p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* ── Draft recovery banner (v1.0.44) ─────────────────────────────────── */}
      {draftFound && (
        <div className="mx-6 mb-4 mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center justify-between shrink-0">
          <div>
            <p className="text-sm font-medium text-amber-800">
              Unsaved product draft found
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              "{draftFound.form.name}" — saved at{' '}
              {new Date(draftFound.savedAt).toLocaleTimeString()}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setForm(draftFound.form);
                setModalOpen(true);
                setDraftFound(null);
              }}
              className="px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 transition"
            >
              Continue editing
            </button>
            <button
              onClick={() => {
                localStorage.removeItem(PRODUCT_DRAFT_KEY);
                setDraftFound(null);
              }}
              className="px-3 py-1.5 bg-white text-amber-700 text-xs font-medium rounded-lg border border-amber-300 hover:bg-amber-50 transition"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-slate-400 text-sm gap-2">
            <div className="w-4 h-4 border-2 border-slate-200 border-t-indigo-400 rounded-full animate-spin" />
            Loading products…
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
            <Package size={40} className="text-slate-200" />
            <p className="text-sm">No products found</p>
            <button onClick={openNew} className="text-indigo-600 text-sm hover:underline">Add your first product</button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-8"></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Product</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Category / Brand</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Cost</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Price</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Margin</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Stock</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Expiry</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => {
                const stock  = totalStock(p);
                const margin = marginPct(p);
                const isLow  = stock <= p.reorderLevel;
                return (
                  <tr key={p.id} className="hover:bg-slate-50 transition group">
                    {/* Avatar */}
                    <td className="px-4 py-3">
                      <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 font-bold text-xs flex items-center justify-center uppercase">
                        {p.name.charAt(0)}
                      </div>
                    </td>

                    {/* Name + SKU */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setDrawer(p)}
                        className="text-left hover:text-indigo-600 transition"
                      >
                        <p className="font-medium text-slate-800 truncate max-w-[200px]">{p.name}</p>
                        <p className="text-xs text-slate-400 font-mono">{p.sku}</p>
                        {p.barcode && (
                          <p className="text-[10px] text-slate-300 font-mono">{String(p.barcode)}</p>
                        )}
                      </button>
                    </td>

                    {/* Category / Brand */}
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        {p.category && (
                          <span className="inline-flex items-center px-2 py-0.5 bg-violet-100 text-violet-700 text-[10px] rounded-full font-medium w-fit">
                            {p.category.name}
                          </span>
                        )}
                        {p.brand && (
                          <span className="inline-flex items-center px-2 py-0.5 bg-sky-100 text-sky-700 text-[10px] rounded-full font-medium w-fit">
                            {p.brand.name}
                          </span>
                        )}
                        {!p.category && !p.brand && (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </div>
                    </td>

                    {/* Cost */}
                    <td className="px-4 py-3 text-right text-slate-600 text-xs">
                      {formatCents(p.costCents)}
                    </td>

                    {/* Price */}
                    <td className="px-4 py-3 text-right font-semibold text-slate-800 text-xs">
                      {formatCents(p.priceCents)}
                    </td>

                    {/* Margin */}
                    <td className={`px-4 py-3 text-right text-xs ${marginColor(margin)}`}>
                      {margin.toFixed(1)}%
                    </td>

                    {/* Stock */}
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        stock === 0
                          ? 'bg-red-100 text-red-600'
                          : isLow
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {stock === 0 && <XCircle size={10} />}
                        {stock > 0 && isLow && <AlertTriangle size={10} />}
                        {stock > 0 && !isLow && <CheckCircle size={10} />}
                        {Number.isInteger(stock) ? stock.toLocaleString() : stock.toFixed(2)}
                        <span className="font-normal opacity-70">{p.unit?.shortCode}</span>
                      </span>
                    </td>

                    {/* Expiry */}
                    <td className="px-4 py-3 text-center">
                      <ExpiryBadge expiryDate={p.expiryDate} alertDays={p.expiryAlertDays} />
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      {showDeleted ? (
                        <div className="flex items-center justify-center">
                          <button
                            onClick={() => restoreMutation.mutate(p.id)}
                            disabled={restoreMutation.isPending}
                            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition"
                          >
                            <RotateCcw size={13} /> Restore
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition">
                          <button
                            onClick={() => setDrawer(p)}
                            title="View stock"
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => openEdit(p)}
                            title="Edit"
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => navigate(`/barcode-labels?sku=${encodeURIComponent(p.sku)}`)}
                            title="Print labels"
                            className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded transition"
                          >
                            <Tag size={14} />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(p)}
                            title="Delete"
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-between text-sm shrink-0">
          <span className="text-slate-500 text-xs">
            {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40 transition"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 py-1 text-slate-600 text-xs">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-40 transition"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          STOCK DRAWER
      ════════════════════════════════════════════════════════════════════════ */}
      {drawer && (
        <div className="fixed inset-0 z-40 flex" onClick={() => setDrawer(null)}>
          <div className="flex-1" />
          <div
            className="relative w-96 bg-white shadow-2xl border-l border-slate-200 flex flex-col h-full overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer header */}
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-slate-800">{drawer.name}</h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{drawer.sku}</p>
              </div>
              <button onClick={() => setDrawer(null)} className="p-1 text-slate-400 hover:text-slate-600 rounded">
                <X size={16} />
              </button>
            </div>

            {/* Product details */}
            <div className="px-5 py-4 border-b border-slate-100 space-y-2">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Cost</p>
                  <p className="font-medium text-slate-700">{formatCents(drawer.costCents)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Price</p>
                  <p className="font-semibold text-slate-800">{formatCents(drawer.priceCents)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Margin</p>
                  <p className={`font-medium ${marginColor(marginPct(drawer))}`}>
                    {marginPct(drawer).toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Reorder at</p>
                  <p className="font-medium text-slate-700">{drawer.reorderLevel} {drawer.unit?.shortCode}</p>
                </div>
              </div>

              {drawer.expiryDate && (
                <div className="flex items-center gap-2 mt-1">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide">Expiry:</p>
                  <ExpiryBadge expiryDate={drawer.expiryDate} alertDays={drawer.expiryAlertDays} />
                  <span className="text-xs text-slate-500">
                    {new Date(drawer.expiryDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              )}
            </div>

            {/* Stock by warehouse */}
            <div className="px-5 py-4 flex-1">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Stock by Warehouse
              </p>
              {drawer.stock.length === 0 ? (
                <p className="text-sm text-slate-400">No stock records</p>
              ) : (
                <div className="space-y-2">
                  {drawer.stock.map((s) => {
                    const qty = Number(s.qty);
                    const low = qty <= drawer.reorderLevel;
                    return (
                      <div key={s.warehouseId} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                        <div>
                          <p className="text-sm font-medium text-slate-700">{s.warehouse.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{s.warehouse.code}</p>
                        </div>
                        <span className={`text-sm font-semibold ${qty === 0 ? 'text-red-500' : low ? 'text-amber-600' : 'text-green-600'}`}>
                          {Number.isInteger(qty) ? qty.toLocaleString() : qty.toFixed(2)}
                          <span className="ml-1 text-xs font-normal text-slate-400">{drawer.unit?.shortCode}</span>
                        </span>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-slate-200">
                    <p className="text-xs font-semibold text-slate-500">Total</p>
                    <p className="text-sm font-bold text-slate-800">
                      {totalStock(drawer).toLocaleString()}
                      <span className="ml-1 text-xs font-normal text-slate-400">{drawer.unit?.shortCode}</span>
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* ── Expiry & Batches ─────────────────────────────────────────── */}
            {allBatches.length > 0 && (
              <div className="px-5 py-4 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Batches &amp; Expiry
                </p>
                <div className="space-y-4">
                  {allBatches.map(({ warehouseId, warehouseName, batches }) => (
                    <div key={warehouseId}>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">{warehouseName}</p>
                      <div className="space-y-1.5">
                        {batches.map((b) => {
                          const statusColors: Record<string, string> = {
                            expired: 'bg-red-100 text-red-700',
                            expiring_soon: 'bg-amber-100 text-amber-700',
                            ok: 'bg-green-100 text-green-700',
                            no_expiry: 'bg-slate-100 text-slate-500',
                          };
                          const statusLabel: Record<string, string> = {
                            expired: 'Expired',
                            expiring_soon: 'Expiring soon',
                            ok: 'OK',
                            no_expiry: 'No expiry',
                          };
                          return (
                            <div key={b.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-mono text-slate-500 text-[10px]">{b.id.slice(-8)}</span>
                                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusColors[b.status] ?? 'bg-slate-100 text-slate-500'}`}>
                                    {statusLabel[b.status] ?? b.status}
                                  </span>
                                </div>
                                <div className="text-slate-500 mt-0.5">
                                  {b.expiryDate
                                    ? new Date(b.expiryDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
                                    : 'No expiry'}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                                <span className="font-semibold text-slate-700">{Number(b.qty)}</span>
                                <button
                                  onClick={() => {
                                    setWriteOffBatch(b);
                                    setWriteOffWarehouseId(warehouseId);
                                    setWriteOffQty('');
                                    setWriteOffReason('');
                                  }}
                                  className="px-2 py-1 text-[10px] font-medium bg-red-50 text-red-600 rounded hover:bg-red-100 transition"
                                  title="Write off this batch"
                                >
                                  Write-off
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Write-Off modal (inline) ─────────────────────────────────── */}
            {writeOffBatch && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setWriteOffBatch(null)}>
                <div className="bg-white rounded-xl shadow-2xl w-80 p-5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-slate-800">Write-Off Batch</h3>
                    <button onClick={() => setWriteOffBatch(null)} className="p-1 text-slate-400 hover:text-slate-600 rounded">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="bg-slate-50 rounded-lg p-3 text-xs space-y-1">
                      <p><span className="text-slate-400">Batch ID:</span> <span className="font-mono">{writeOffBatch.id.slice(-12)}</span></p>
                      <p><span className="text-slate-400">Available qty:</span> <span className="font-semibold">{Number(writeOffBatch.qty)}</span></p>
                      {writeOffBatch.expiryDate && (
                        <p><span className="text-slate-400">Expiry:</span> {new Date(writeOffBatch.expiryDate).toLocaleDateString()}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Quantity to write off *</label>
                      <input
                        type="number"
                        min={1}
                        max={Number(writeOffBatch.qty)}
                        value={writeOffQty}
                        onChange={(e) => setWriteOffQty(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                        placeholder={`Max ${Number(writeOffBatch.qty)}`}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Reason *</label>
                      <input
                        type="text"
                        value={writeOffReason}
                        onChange={(e) => setWriteOffReason(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                        placeholder="e.g. Expired, damaged..."
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => setWriteOffBatch(null)}
                      className="flex-1 py-2 text-sm border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition"
                    >
                      Cancel
                    </button>
                    <button
                      disabled={
                        writeOffMutation.isPending ||
                        !writeOffQty ||
                        Number(writeOffQty) <= 0 ||
                        Number(writeOffQty) > Number(writeOffBatch.qty) ||
                        writeOffReason.trim().length < 3
                      }
                      onClick={() => {
                        if (!writeOffBatch || !writeOffWarehouseId) return;
                        writeOffMutation.mutate({
                          batchId: writeOffBatch.id,
                          warehouseId: writeOffWarehouseId,
                          qty: Number(writeOffQty),
                          reason: writeOffReason.trim(),
                        });
                      }}
                      className="flex-1 py-2 text-sm bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      {writeOffMutation.isPending ? 'Writing off…' : 'Confirm Write-Off'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Toast ──────────────────────────────────────────────────────── */}
            {drawerToast && (
              <div className={`absolute bottom-20 left-4 right-4 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg text-white ${drawerToast.ok ? 'bg-green-600' : 'bg-red-600'}`}>
                {drawerToast.msg}
              </div>
            )}

            {/* Drawer actions */}
            <div className="px-5 py-4 border-t border-slate-100 flex gap-2">
              <button
                onClick={() => { openEdit(drawer); setDrawer(null); }}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition"
              >
                <Edit2 size={13} /> Edit Product
              </button>
              <button
                onClick={() => navigate(`/barcode-labels?sku=${encodeURIComponent(drawer.sku)}`)}
                className="px-3 py-2 border border-slate-200 text-slate-600 text-sm rounded-lg hover:bg-slate-50 transition"
                title="Print labels"
              >
                <ExternalLink size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          CREATE / EDIT MODAL
      ════════════════════════════════════════════════════════════════════════ */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-6">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">
                {editingProduct ? 'Edit Product' : 'New Product'}
              </h2>
              <button onClick={closeModal} className="p-1.5 text-slate-400 hover:text-slate-600 rounded">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">

              {/* ── Basic Info ──────────────────────────────────────────── */}
              <section>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Basic Info</p>
                <div className="space-y-3">
                  {/* Name */}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      ref={nameInputRef}
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="Product name"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      required
                    />
                  </div>

                  {/* Receipt Name */}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Receipt Name</label>
                    <input
                      type="text"
                      value={form.receiptName}
                      onChange={(e) => setForm((f) => ({ ...f, receiptName: e.target.value }))}
                      placeholder="Printed on receipt (leave blank to use product name)"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {/* SKU */}
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">SKU</label>
                      <input
                        type="text"
                        value={form.sku}
                        onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                        placeholder="Auto-generated if blank"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono"
                      />
                    </div>

                    {/* Barcode */}
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Barcode</label>
                      <div className="relative">
                        <input
                          type="text"
                          value={form.barcode}
                          onChange={(e) => handleBarcodeChange(e.target.value)}
                          placeholder="Scan or type barcode"
                          className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 font-mono pr-8 ${
                            barcodeCheck?.state === 'taken'
                              ? 'border-red-300 focus:ring-red-400 bg-red-50'
                              : barcodeCheck?.state === 'available'
                              ? 'border-green-300 focus:ring-green-400 bg-green-50'
                              : 'border-slate-200 focus:ring-indigo-400'
                          }`}
                        />
                        {barcodeCheck?.state === 'checking' && (
                          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-slate-200 border-t-indigo-400 rounded-full animate-spin" />
                        )}
                        {barcodeCheck?.state === 'available' && (
                          <CheckCircle size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-green-500" />
                        )}
                        {barcodeCheck?.state === 'taken' && (
                          <XCircle size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-red-500" />
                        )}
                      </div>
                      {barcodeCheck?.state === 'taken' && (
                        <p className="text-[10px] text-red-500 mt-0.5">
                          Already used by <span className="font-semibold">{barcodeCheck.product.name}</span> ({barcodeCheck.product.sku})
                        </p>
                      )}
                      {barcodeCheck?.state === 'available' && (
                        <p className="text-[10px] text-green-600 mt-0.5">Barcode available ✓</p>
                      )}
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      placeholder="Optional description"
                      rows={2}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                    />
                  </div>
                </div>
              </section>

              {/* ── Category & Brand ────────────────────────────────────── */}
              <section>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Classification</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                    <SearchableSelect
                      value={form.categoryId ?? ''}
                      onChange={(id) => setForm((f) => ({ ...f, categoryId: id }))}
                      options={(meta?.categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
                      placeholder="Search or add category…"
                      addNewLabel="+ Add new category"
                      onAddNew={async (name) => {
                        const n = name.trim();
                        if (!n) return;
                        try {
                          const created = await categoriesApi.create(n);
                          await qc.invalidateQueries({ queryKey: ['products-meta'] });
                          setForm((f) => ({ ...f, categoryId: created.id }));
                        } catch (err) {
                          setFormErr(
                            (err as { response?: { data?: { message?: string } } })?.response?.data?.message
                              ?? 'Failed to add category',
                          );
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Brand</label>
                    <SearchableSelect
                      value={form.brandId ?? ''}
                      onChange={(id) => setForm((f) => ({ ...f, brandId: id }))}
                      options={(meta?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))}
                      placeholder="Search or add brand…"
                      addNewLabel="+ Add new brand"
                      onAddNew={async (name) => {
                        const n = name.trim();
                        if (!n) return;
                        try {
                          const created = await brandsApi.create(n);
                          await qc.invalidateQueries({ queryKey: ['products-meta'] });
                          setForm((f) => ({ ...f, brandId: created.id }));
                        } catch (err) {
                          setFormErr(
                            (err as { response?: { data?: { message?: string } } })?.response?.data?.message
                              ?? 'Failed to add brand',
                          );
                        }
                      }}
                    />
                  </div>
                </div>
              </section>

              {/* ── Pricing ─────────────────────────────────────────────── */}
              <section>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Pricing</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Cost (Rs.)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.cost}
                      onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                      placeholder="0.00"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Price (Rs.)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.price}
                      onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                      placeholder="0.00"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Tax %</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={form.taxPercent}
                      onChange={(e) => setForm((f) => ({ ...f, taxPercent: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                </div>

                {/* Margin preview */}
                {previewMargin !== null && (
                  <div className={`mt-2 text-sm font-medium ${marginColor(previewMargin)}`}>
                    Margin preview: {previewMargin.toFixed(1)}%
                    {form.cost && form.price && (
                      <span className="ml-2 text-slate-400 font-normal text-xs">
                        (Rs. {(parseFloat(form.price) - parseFloat(form.cost)).toFixed(2)} profit per unit)
                      </span>
                    )}
                  </div>
                )}

                {/* Default Discount */}
                <div className="mt-3">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Default Discount (Rs.)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.defaultDiscount}
                    onChange={(e) => setForm((f) => ({ ...f, defaultDiscount: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    placeholder="0.00"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Auto-applied at POS checkout. Cashier can override.
                  </p>
                </div>

                {/* Service Charge */}
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Service Charge</p>
                  <div className="mb-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Charge Mode</label>
                    <div className="flex flex-wrap gap-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="serviceChargeMode"
                          value="per_unit"
                          checked={form.serviceChargeMode === 'per_unit' || form.serviceChargeMode === 'per_item' || !form.serviceChargeMode}
                          onChange={() => setForm((f) => ({ ...f, serviceChargeMode: 'per_unit' }))}
                        />
                        <span className="text-sm text-slate-700">
                          Per unit / qty
                          <span className="text-xs text-slate-500 ml-1">(Rs.X × qty sold)</span>
                        </span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="serviceChargeMode"
                          value="per_transaction"
                          checked={form.serviceChargeMode === 'per_transaction'}
                          onChange={() => setForm((f) => ({ ...f, serviceChargeMode: 'per_transaction' }))}
                        />
                        <span className="text-sm text-slate-700">
                          Per transaction
                          <span className="text-xs text-slate-500 ml-1">(flat Rs.X once per sale)</span>
                        </span>
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Amount (Rs.)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.serviceCharge}
                        onChange={(e) => setForm((f) => ({ ...f, serviceCharge: e.target.value }))}
                        className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Label</label>
                      <input
                        type="text"
                        value={form.serviceChargeLabel}
                        onChange={(e) => setForm((f) => ({ ...f, serviceChargeLabel: e.target.value }))}
                        className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                        placeholder="e.g. Delivery, Service"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-amber-700">Added as a separate line in the POS cart per item.</p>
                </div>
              </section>

              {/* ── Unit Roles ──────────────────────────────────────────── */}
              <section>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Unit Roles</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Display Unit</label>
                    <select
                      value={form.unitId}
                      onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-slate-700"
                    >
                      <option value="">— select —</option>
                      {allUnits.map((u) => (
                        <option key={u.id} value={u.id}>{u.name} ({u.shortCode})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Base / Stock Unit</label>
                    <select
                      value={form.baseUnitId}
                      onChange={(e) => setForm((f) => ({ ...f, baseUnitId: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-slate-700"
                    >
                      <option value="">Same as display</option>
                      {allUnits.map((u) => (
                        <option key={u.id} value={u.id}>{u.name} ({u.shortCode})</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      Stock is always counted in this unit. For loose items sold by weight, use the smallest unit here (e.g. Gram, not Bottle).
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Purchase Unit</label>
                    <select
                      value={form.purchaseUnitId}
                      onChange={(e) => setForm((f) => ({ ...f, purchaseUnitId: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-slate-700"
                    >
                      <option value="">Same as base</option>
                      {allUnits.map((u) => (
                        <option key={u.id} value={u.id}>{u.name} ({u.shortCode})</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      If different from base unit, add a conversion rule below.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Sales / POS Unit</label>
                    <select
                      value={form.salesUnitId}
                      onChange={(e) => setForm((f) => ({ ...f, salesUnitId: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-slate-700"
                    >
                      <option value="">Same as base</option>
                      {allUnits.map((u) => (
                        <option key={u.id} value={u.id}>{u.name} ({u.shortCode})</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      For best results, match this to the Base Unit. Mismatches may affect stock deduction accuracy.
                    </p>
                  </div>
                </div>
              </section>

              {/* ── Unit Conversions ────────────────────────────────────── */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Unit Conversions</p>
                  <button
                    type="button"
                    onClick={addConversionRow}
                    className="text-xs text-indigo-600 hover:underline font-medium flex items-center gap-1"
                  >
                    <Plus size={11} /> Add row
                  </button>
                </div>

                {conversions.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">
                    No conversions configured. Click "Add row" to add e.g. Box→Piece.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {/* Header */}
                    <div className="grid grid-cols-[1fr_1fr_80px_80px_80px_32px] gap-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide px-1">
                      <span>From Unit</span>
                      <span>To Unit</span>
                      <span>Qty</span>
                      <span>Price (Rs.)</span>
                      <span>Barcode</span>
                      <span />
                    </div>
                    {conversions.map((row) => {
                      const fromU = allUnits.find((u) => u.id === row.fromUnitId);
                      const toU   = allUnits.find((u) => u.id === row.toUnitId);
                      const preview =
                        fromU && toU && row.conversionQty
                          ? `1 ${fromU.shortCode} = ${row.conversionQty} ${toU.shortCode}`
                          : null;
                      return (
                        <div key={row.key}>
                          <div className="grid grid-cols-[1fr_1fr_80px_80px_80px_32px] gap-2 items-center">
                            <select
                              value={row.fromUnitId}
                              onChange={(e) => updateConvRow(row.key, { fromUnitId: e.target.value })}
                              className="px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                            >
                              <option value="">From…</option>
                              {allUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                            <select
                              value={row.toUnitId}
                              onChange={(e) => updateConvRow(row.key, { toUnitId: e.target.value })}
                              className="px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                            >
                              <option value="">To…</option>
                              {allUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.conversionQty}
                              onChange={(e) => updateConvRow(row.key, { conversionQty: e.target.value })}
                              placeholder="e.g. 12"
                              className="px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={row.priceCents}
                              onChange={(e) => updateConvRow(row.key, { priceCents: e.target.value })}
                              placeholder="opt."
                              className="px-2 py-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
                            />
                            <input
                              type="text"
                              value={row.barcode}
                              onChange={(e) => updateConvRow(row.key, { barcode: e.target.value })}
                              placeholder="opt."
                              className="px-2 py-1.5 border border-slate-200 rounded text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
                            />
                            <button
                              type="button"
                              onClick={() => removeConvRow(row.key)}
                              className="p-1 text-slate-400 hover:text-red-500 rounded transition"
                            >
                              <X size={13} />
                            </button>
                          </div>
                          {preview && (
                            <p className="text-[10px] text-indigo-500 mt-0.5 pl-1">{preview}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* ── Stock & Expiry ──────────────────────────────────────── */}
              <section>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Stock & Expiry</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Reorder Level</label>
                    <input
                      type="number"
                      min="0"
                      value={form.reorderLevel}
                      onChange={(e) => setForm((f) => ({ ...f, reorderLevel: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Reorder Qty</label>
                    <input
                      type="number"
                      min="0"
                      value={form.reorderQty}
                      onChange={(e) => setForm((f) => ({ ...f, reorderQty: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Expiry Date</label>
                    <input
                      type="date"
                      value={form.expiryDate}
                      onChange={(e) => setForm((f) => ({ ...f, expiryDate: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Expiry Alert Days</label>
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={form.expiryAlertDays}
                      onChange={(e) => setForm((f) => ({ ...f, expiryAlertDays: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                </div>
              </section>

              {/* ── Batch tracking + Default Supplier ──────────────────── */}
              <section>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Purchasing</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, isBatchTracked: !f.isBatchTracked }))}
                      className={`relative w-10 h-5 rounded-full transition ${form.isBatchTracked ? 'bg-indigo-600' : 'bg-slate-200'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${form.isBatchTracked ? 'left-5' : 'left-0.5'}`} />
                    </button>
                    <div>
                      <span className="text-sm text-slate-700 font-medium">Batch / Expiry Tracking</span>
                      <p className="text-xs text-slate-400">Require batch # on each delivery</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Default Supplier</label>
                    <select
                      value={form.defaultSupplierId}
                      onChange={(e) => setForm((f) => ({ ...f, defaultSupplierId: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                      <option value="">No default supplier</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              {/* ── Active toggle ───────────────────────────────────────── */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                  className={`relative w-10 h-5 rounded-full transition ${form.isActive ? 'bg-indigo-600' : 'bg-slate-200'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${form.isActive ? 'left-5' : 'left-0.5'}`} />
                </button>
                <span className="text-sm text-slate-600">{form.isActive ? 'Active' : 'Inactive'}</span>
              </div>

              {/* ── Error & Submit ──────────────────────────────────────── */}
              {formErr && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertTriangle size={14} /> {formErr}
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || barcodeCheck?.state === 'taken'}
                  className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition"
                >
                  {saving ? 'Saving…' : editingProduct ? 'Save Changes' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete confirmation (stock-aware — v1.0.62a) ────────────────────── */}
      {deleteTarget && (() => {
        const stockQty   = totalStock(deleteTarget);
        const unitLabel  = deleteTarget.unit?.shortCode ?? 'units';
        const hasStock   = stockQty > 0;
        const stockLabel = Number.isInteger(stockQty)
          ? stockQty.toLocaleString()
          : stockQty.toFixed(2);

        return (
          <div
            className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={() => { if (!deleteMutation.isPending) setDeleteTarget(null); }}
          >
            <div
              className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  hasStock ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600'
                }`}>
                  <Trash2 size={18} />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-800">
                    {hasStock ? 'Cannot Delete' : 'Delete Product'}
                  </h3>
                  <p className="text-xs text-slate-500">{deleteTarget.name}</p>
                </div>
              </div>

              {hasStock ? (
                <>
                  <p className="text-sm text-slate-600 mb-5">
                    This product has <strong>{stockLabel} {unitLabel}</strong> still in
                    stock. Write off the stock first to record the loss, then delete.
                  </p>
                  <div className="flex">
                    <button
                      onClick={() => setDeleteTarget(null)}
                      className="flex-1 py-2 text-sm font-medium border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 transition"
                    >
                      Close
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-600 mb-5">
                    <strong>{deleteTarget.name}</strong> will be removed. If it has sales or
                    purchase history it will be moved to Recently Deleted and can be restored;
                    otherwise it will be permanently deleted.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeleteTarget(null)}
                      disabled={deleteMutation.isPending}
                      className="flex-1 py-2 text-sm font-medium border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 transition disabled:opacity-60"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(deleteTarget.id)}
                      disabled={deleteMutation.isPending}
                      className="flex-1 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-60 flex items-center justify-center gap-1.5"
                    >
                      {deleteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── List toast ──────────────────────────────────────────────────────── */}
      {listToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {listToast}
        </div>
      )}
    </div>
  );
}
