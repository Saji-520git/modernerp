import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, X, AlertCircle, ArrowLeft, FileText } from 'lucide-react';
import { quotationService } from '../../services/quotationService';
import { salesApi, type SaleProduct, type SaleCustomer } from '../../services/sales';
import type { Quotation, CreateQuotationDto } from '../../types/quotation';

const money = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

interface LineForm {
  key: number;
  productId: string;
  description: string;
  qty: string;
  unitLabel: string;
  unitPrice: string;     // rupees string
  discountCents: string; // rupees string
}

const blankLine = (key: number): LineForm => ({
  key, productId: '', description: '', qty: '1', unitLabel: 'pcs', unitPrice: '', discountCents: '0',
});

export default function QuotationFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: customers = [] } = useQuery<SaleCustomer[]>({
    queryKey: ['customers-for-quote'],
    queryFn: () => salesApi.listCustomers(),
  });
  const { data: products = [] } = useQuery<SaleProduct[]>({
    queryKey: ['products-for-quote'],
    queryFn: () => salesApi.listProducts(),
  });

  // Existing quotation (edit mode)
  const { data: existing, isLoading: loadingExisting } = useQuery<Quotation>({
    queryKey: ['quotation', id],
    queryFn: () => quotationService.get(id!),
    enabled: isEdit,
  });

  const [customerId, setCustomerId] = useState('');
  const [title, setTitle] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [note, setNote] = useState('');
  const [terms, setTerms] = useState('');
  const [lines, setLines] = useState<LineForm[]>([blankLine(0)]);
  const [error, setError] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // Hydrate form once the existing quotation loads.
  if (isEdit && existing && !hydrated) {
    setCustomerId(existing.customerId ?? '');
    setTitle(existing.title ?? '');
    setValidUntil(existing.validUntil ? existing.validUntil.slice(0, 10) : '');
    setNote(existing.note ?? '');
    setTerms(existing.termsConditions ?? '');
    setLines(
      (existing.lines ?? []).map((l, i) => ({
        key: i,
        productId: l.productId ?? '',
        description: l.description,
        qty: String(l.qty),
        unitLabel: l.unitLabel,
        unitPrice: (l.unitPriceCents / 100).toFixed(2),
        discountCents: (l.discountCents / 100).toFixed(2),
      })),
    );
    setHydrated(true);
  }

  const addLine = () => setLines((p) => [...p, blankLine(Date.now())]);
  const removeLine = (key: number) => setLines((p) => (p.length > 1 ? p.filter((l) => l.key !== key) : p));
  const updateLine = (key: number, field: keyof LineForm, value: string) =>
    setLines((p) => p.map((l) => {
      if (l.key !== key) return l;
      const next = { ...l, [field]: value };
      if (field === 'productId' && value) {
        const pr = products.find((x) => x.id === value);
        if (pr) {
          next.description = next.description || pr.name;
          next.unitPrice = (pr.priceCents / 100).toFixed(2);
          next.unitLabel = pr.unit?.shortCode || next.unitLabel;
        }
      }
      return next;
    }));

  const lineTotal = (l: LineForm) => {
    const qty = parseFloat(l.qty) || 0;
    const price = parseFloat(l.unitPrice) || 0;
    const discount = Math.round((parseFloat(l.discountCents) || 0) * 100);
    return Math.max(0, Math.round(qty * price * 100) - discount);
  };
  const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  const buildPayload = (): CreateQuotationDto => ({
    customerId: customerId || null,
    title: title || null,
    validUntil: validUntil ? new Date(validUntil).toISOString() : null,
    note: note || null,
    termsConditions: terms || null,
    lines: lines
      .filter((l) => l.description.trim())
      .map((l, idx) => ({
        productId: l.productId || null,
        description: l.description.trim(),
        qty: parseFloat(l.qty) || 1,
        unitLabel: l.unitLabel || 'pcs',
        unitPriceCents: Math.round((parseFloat(l.unitPrice) || 0) * 100),
        discountCents: Math.round((parseFloat(l.discountCents) || 0) * 100),
        sortOrder: idx,
      })),
  });

  const createMut = useMutation({
    mutationFn: () => quotationService.create(buildPayload()),
    onSuccess: (q) => {
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      navigate(`/quotations/${q.id}`);
    },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'Failed to create quotation'),
  });

  const updateMut = useMutation({
    mutationFn: () => quotationService.update(id!, buildPayload()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotations'] });
      queryClient.invalidateQueries({ queryKey: ['quotation', id] });
      navigate(`/quotations/${id}`);
    },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'Failed to update quotation'),
  });

  const mutation = isEdit ? updateMut : createMut;
  const canSubmit = lines.some((l) => l.description.trim());

  if (isEdit && loadingExisting) {
    return <div className="p-6 text-slate-400 text-sm">Loading…</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-slate-500" />
        </button>
        <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-600" />
          {isEdit ? `Edit Quotation — ${existing?.number ?? ''}` : 'New Quotation'}
        </h1>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Customer</label>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
            <option value="">Walk-in Customer</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Office furniture quote"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Valid Until</label>
          <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Note</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note…"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-600 mb-1">Terms &amp; Conditions</label>
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} placeholder="Optional terms…"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
      </div>

      {/* Lines */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Line Items</p>
          <button onClick={addLine} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
            <Plus className="w-3.5 h-3.5" /> Add Line
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-3">
                <select value={l.productId} onChange={(e) => updateLine(l.key, 'productId', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                  <option value="">— Custom —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="col-span-3">
                <input placeholder="Description" value={l.description} onChange={(e) => updateLine(l.key, 'description', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div className="col-span-1">
                <input type="number" min="0.01" step="0.01" placeholder="Qty" value={l.qty} onChange={(e) => updateLine(l.key, 'qty', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div className="col-span-2">
                <input type="number" min="0" step="0.01" placeholder="Price" value={l.unitPrice} onChange={(e) => updateLine(l.key, 'unitPrice', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div className="col-span-2 text-right text-sm font-semibold text-slate-700">
                {money(lineTotal(l))}
              </div>
              <div className="col-span-1 flex justify-end">
                {lines.length > 1 && (
                  <button onClick={() => removeLine(l.key)} className="p-1 text-slate-300 hover:text-red-400 transition"><Trash2 className="w-3.5 h-3.5" /></button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="text-right text-base font-bold text-slate-800 mt-4 pt-3 border-t border-slate-200">
          Grand Total: <span className="text-indigo-600">{money(grandTotal)}</span>
        </div>
      </div>

      <div className="flex gap-3 justify-end">
        <button onClick={() => navigate(-1)}
          className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
          <X className="w-4 h-4" /> Cancel
        </button>
        <button onClick={() => { setError(''); mutation.mutate(); }} disabled={!canSubmit || mutation.isPending}
          className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition">
          {mutation.isPending ? 'Saving…' : isEdit ? 'Update Quotation' : 'Create Quotation'}
        </button>
      </div>
    </div>
  );
}
