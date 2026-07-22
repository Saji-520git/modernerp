import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Pencil, Trash2, X, Check, AlertCircle, ArrowRightCircle } from 'lucide-react';
import {
  quotationsApi, QUOTATION_STATUS_COLORS,
  type Quotation, type QuotationInput, type QuotationStatus,
} from '../../services/quotations';
import { productsApi } from '../../services/products';
import { salesApi } from '../../services/sales';
import { posApi } from '../../services/pos';
import { useAppSettings } from '../../context/SettingsContext';

const toCents = (v: string) => Math.round(parseFloat(v || '0') * 100);
const toRs = (c: number) => (c / 100).toString();

interface EditLine { productId: string | null; description: string; qty: string; unitLabel: string; unitPrice: string; discount: string; }
const blankLine = (): EditLine => ({ productId: null, description: '', qty: '1', unitLabel: 'pcs', unitPrice: '', discount: '0' });

export default function QuotationsPage() {
  const qc = useQueryClient();
  const { formatMoney } = useAppSettings();
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [creating, setCreating] = useState(false);
  const [convertId, setConvertId] = useState<string | null>(null);

  const { data: quotes = [], isLoading } = useQuery({ queryKey: ['quotations'], queryFn: quotationsApi.list });
  const removeMut = useMutation({ mutationFn: (id: string) => quotationsApi.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations'] }) });
  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: QuotationStatus }) => quotationsApi.setStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotations'] }),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center"><FileText size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Quotations</h1>
            <p className="text-sm text-slate-500">Create quotes and convert accepted ones into sales invoices.</p>
          </div>
        </div>
        <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
          <Plus size={16} /> New Quotation
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? <p className="p-8 text-center text-slate-400">Loading…</p>
          : quotes.length === 0 ? (
            <div className="p-10 text-center">
              <FileText size={32} className="mx-auto text-slate-300 mb-2" />
              <p className="text-slate-500 font-medium">No quotations yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    {['Number', 'Customer', 'Title', 'Status', 'Total', 'Valid until', ''].map((h, i) => (
                      <th key={i} className={`px-4 py-3 font-semibold text-slate-500 uppercase text-xs ${i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {quotes.map((q) => (
                    <tr key={q.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-slate-700">{q.number}</td>
                      <td className="px-4 py-3 text-slate-600">{q.customer?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600 truncate max-w-[180px]">{q.title ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${QUOTATION_STATUS_COLORS[q.status]}`}>{q.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatMoney(q.totalCents)}</td>
                      <td className="px-4 py-3 text-slate-500">{q.validUntil ? new Date(q.validUntil).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {q.status !== 'CONVERTED' && (
                            <button onClick={() => setConvertId(q.id)} title="Convert to sale" className="p-1.5 text-slate-400 hover:text-green-600 rounded"><ArrowRightCircle size={16} /></button>
                          )}
                          <button onClick={() => setEditing(q)} title="Edit / view" className="p-1.5 text-slate-400 hover:text-indigo-600 rounded"><Pencil size={15} /></button>
                          <button onClick={() => { if (confirm(`Delete ${q.number}?`)) removeMut.mutate(q.id); }} title="Delete" className="p-1.5 text-slate-400 hover:text-red-600 rounded"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {(creating || editing) && (
        <QuotationModal
          quote={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); qc.invalidateQueries({ queryKey: ['quotations'] }); }}
          onStatus={(status) => editing && statusMut.mutate({ id: editing.id, status })}
        />
      )}
      {convertId && <ConvertModal quotationId={convertId} onClose={() => setConvertId(null)} onDone={() => { setConvertId(null); qc.invalidateQueries({ queryKey: ['quotations'] }); }} />}
    </div>
  );
}

function QuotationModal({ quote, onClose, onSaved, onStatus }: {
  quote: Quotation | null; onClose: () => void; onSaved: () => void; onStatus: (s: QuotationStatus) => void;
}) {
  const isEdit = !!quote;
  const readOnly = quote?.status === 'CONVERTED';
  const { formatMoney } = useAppSettings();
  const { data: customers = [] } = useQuery({ queryKey: ['sale-customers'], queryFn: salesApi.listCustomers });
  const { data: productList } = useQuery({ queryKey: ['quote-products'], queryFn: () => productsApi.list({ pageSize: 500 }) });

  const [customerId, setCustomerId] = useState(quote?.customerId ?? '');
  const [title, setTitle] = useState(quote?.title ?? '');
  const [validUntil, setValidUntil] = useState(quote?.validUntil ? quote.validUntil.slice(0, 10) : '');
  const [note, setNote] = useState(quote?.note ?? '');
  const [terms, setTerms] = useState(quote?.termsConditions ?? '');
  const [discount, setDiscount] = useState(toRs(quote?.discountCents ?? 0));
  const [tax, setTax] = useState(toRs(quote?.taxCents ?? 0));
  const [lines, setLines] = useState<EditLine[]>(
    quote?.lines.length
      ? quote.lines.map((l) => ({ productId: l.productId, description: l.description, qty: String(l.qty), unitLabel: l.unitLabel, unitPrice: toRs(l.unitPriceCents), discount: toRs(l.discountCents) }))
      : [blankLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: (body: QuotationInput) => isEdit ? quotationsApi.update(quote!.id, body) : quotationsApi.create(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['quotations'] }); onSaved(); },
    onError: (e: unknown) => setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Save failed'),
  });

  const lineTotal = (l: EditLine) => Math.max(0, Math.round(parseFloat(l.qty || '0') * toCents(l.unitPrice)) - toCents(l.discount));
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const grandTotal = Math.max(0, subtotal - toCents(discount) + toCents(tax));

  const pickProduct = (idx: number, productId: string) => {
    const p = productList?.data.find((x) => x.id === productId);
    setLines((prev) => prev.map((l, i) => i !== idx ? l : {
      ...l, productId: productId || null,
      description: p ? p.name : l.description,
      unitPrice: p ? toRs(p.priceCents) : l.unitPrice,
      unitLabel: p?.unit?.shortCode ?? l.unitLabel,
    }));
  };

  const submit = () => {
    setError(null);
    const valid = lines.filter((l) => l.description.trim() && parseFloat(l.qty) > 0);
    if (valid.length === 0) { setError('Add at least one line with a description and quantity'); return; }
    const body: QuotationInput = {
      customerId: customerId || null, title: title.trim() || null, validUntil: validUntil ? new Date(validUntil).toISOString() : null,
      discountCents: toCents(discount), taxCents: toCents(tax), note: note.trim() || null, termsConditions: terms.trim() || null,
      lines: valid.map((l) => ({ productId: l.productId, description: l.description.trim(), qty: parseFloat(l.qty), unitLabel: l.unitLabel.trim() || 'pcs', unitPriceCents: toCents(l.unitPrice), discountCents: toCents(l.discount) })),
    };
    save.mutate(body);
  };

  const inp = 'w-full px-2.5 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50';
  const lbl = 'block text-xs font-medium text-slate-600 mb-1';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="text-base font-bold text-slate-800">{isEdit ? `${quote!.number}${readOnly ? ' (converted — read only)' : ''}` : 'New Quotation'}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5" />{error}</div>}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={lbl}>Customer</label>
              <select disabled={readOnly} className={inp} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— None —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Title</label>
              <input disabled={readOnly} className={inp} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Bulk order quote" />
            </div>
            <div>
              <label className={lbl}>Valid until</label>
              <input disabled={readOnly} className={inp} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>

          {/* Line editor */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr className="text-[11px] text-slate-500 uppercase">
                  <th className="text-left px-2 py-2">Product / description</th>
                  <th className="px-2 py-2 w-16">Qty</th>
                  <th className="px-2 py-2 w-16">Unit</th>
                  <th className="px-2 py-2 w-24">Price</th>
                  <th className="px-2 py-2 w-20">Disc</th>
                  <th className="px-2 py-2 w-24 text-right">Total</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5">
                      {!readOnly && (
                        <select className={inp + ' mb-1'} value={l.productId ?? ''} onChange={(e) => pickProduct(i, e.target.value)}>
                          <option value="">Free text…</option>
                          {productList?.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      )}
                      <input disabled={readOnly} className={inp} value={l.description} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} placeholder="Description" />
                    </td>
                    <td className="px-2 py-1.5"><input disabled={readOnly} className={inp} type="number" min="0" step="any" value={l.qty} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} /></td>
                    <td className="px-2 py-1.5"><input disabled={readOnly} className={inp} value={l.unitLabel} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, unitLabel: e.target.value } : x))} /></td>
                    <td className="px-2 py-1.5"><input disabled={readOnly} className={inp} type="number" min="0" step="0.01" value={l.unitPrice} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))} /></td>
                    <td className="px-2 py-1.5"><input disabled={readOnly} className={inp} type="number" min="0" step="0.01" value={l.discount} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, discount: e.target.value } : x))} /></td>
                    <td className="px-2 py-1.5 text-right font-medium text-slate-700">{formatMoney(lineTotal(l))}</td>
                    <td className="px-2 py-1.5 text-center">
                      {!readOnly && lines.length > 1 && <button onClick={() => setLines((p) => p.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X size={14} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!readOnly && (
              <button onClick={() => setLines((p) => [...p, blankLine()])} className="w-full py-2 text-xs text-indigo-600 hover:bg-indigo-50 border-t border-slate-100 flex items-center justify-center gap-1"><Plus size={13} /> Add line</button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div><label className={lbl}>Note</label><textarea disabled={readOnly} rows={2} className={inp} value={note} onChange={(e) => setNote(e.target.value)} /></div>
              <div><label className={lbl}>Terms &amp; conditions</label><textarea disabled={readOnly} rows={2} className={inp} value={terms} onChange={(e) => setTerms(e.target.value)} /></div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span className="font-medium">{formatMoney(subtotal)}</span></div>
              <div className="flex justify-between items-center"><span className="text-slate-500">Discount</span>
                <input disabled={readOnly} className="w-24 px-2 py-1 border border-slate-200 rounded text-right text-sm" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
              <div className="flex justify-between items-center"><span className="text-slate-500">Tax</span>
                <input disabled={readOnly} className="w-24 px-2 py-1 border border-slate-200 rounded text-right text-sm" type="number" min="0" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} /></div>
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-800"><span>Total</span><span>{formatMoney(grandTotal)}</span></div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
          <div className="flex items-center gap-2">
            {isEdit && !readOnly && (['SENT', 'ACCEPTED', 'REJECTED'] as QuotationStatus[]).map((s) => (
              <button key={s} onClick={() => onStatus(s)} className="px-2.5 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50 text-slate-600">Mark {s.toLowerCase()}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Close</button>
            {!readOnly && (
              <button onClick={submit} disabled={save.isPending} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-60">
                <Check size={16} /> {save.isPending ? 'Saving…' : isEdit ? 'Save' : 'Create'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConvertModal({ quotationId, onClose, onDone }: { quotationId: string; onClose: () => void; onDone: () => void }) {
  const { data: warehouses = [] } = useQuery({ queryKey: ['pos-warehouses'], queryFn: posApi.getWarehouses });
  const [warehouseId, setWarehouseId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ saleNumber: string } | null>(null);

  const convert = useMutation({
    mutationFn: () => quotationsApi.convert(quotationId, warehouseId),
    onSuccess: (r) => setResult(r),
    onError: (e: unknown) => setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Convert failed'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-slate-800 mb-3">Convert to sale</h2>
        {result ? (
          <div className="text-sm">
            <p className="flex items-center gap-2 text-green-700 mb-3"><Check size={16} /> Draft invoice <strong>{result.saleNumber}</strong> created.</p>
            <button onClick={onDone} className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">Done</button>
          </div>
        ) : (
          <>
            {error && <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-700 mb-3"><AlertCircle size={14} className="mt-0.5" />{error}</div>}
            <p className="text-xs text-slate-500 mb-2">Creates a DRAFT sales invoice from this quotation. All lines must be product-linked.</p>
            <label className="block text-xs font-medium text-slate-600 mb-1">Warehouse</label>
            <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm mb-4" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Select…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
              <button onClick={() => warehouseId && convert.mutate()} disabled={!warehouseId || convert.isPending} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-60">
                {convert.isPending ? 'Converting…' : 'Convert'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
