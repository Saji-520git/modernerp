import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, FileText, Edit, Trash2, Copy, Send, CheckCircle, XCircle,
  Clock, ShoppingCart, AlertCircle, Receipt, Truck,
} from 'lucide-react';
import axios from 'axios';
import { quotationService } from '../../services/quotationService';
import WhatsAppButton from '../../components/WhatsAppButton';
import { openWhatsApp } from '../../utils/whatsappHelper';
import { useModules } from '../../hooks/useModules';
import DeliveryFormModal from '../delivery/DeliveryFormModal';
import {
  QUOTATION_STATUS_COLORS, type Quotation, type QuotationStatus,
} from '../../types/quotation';

const money = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isModuleEnabled } = useModules();
  const [error, setError] = useState<string | null>(null);
  const [waLoading, setWaLoading] = useState(false);
  const [waMsg, setWaMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showDelivery, setShowDelivery] = useState(false);

  const { data: q, isLoading } = useQuery<Quotation>({
    queryKey: ['quotation', id],
    queryFn: () => quotationService.get(id!),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['quotation', id] });
    queryClient.invalidateQueries({ queryKey: ['quotations'] });
    queryClient.invalidateQueries({ queryKey: ['quotation-stats'] });
  };

  const onErr = (err: any) => {
    setError(err?.response?.data?.message ?? 'Action failed');
    setTimeout(() => setError(null), 4000);
  };

  const statusMut = useMutation({
    mutationFn: (status: QuotationStatus) => quotationService.setStatus(id!, status),
    onSuccess: invalidate,
    onError: onErr,
  });
  const convertMut = useMutation({
    mutationFn: () => quotationService.convert(id!),
    onSuccess: (res) => { invalidate(); navigate(`/sales`); void res; },
    onError: onErr,
  });
  const duplicateMut = useMutation({
    mutationFn: () => quotationService.duplicate(id!),
    onSuccess: (dup) => { invalidate(); navigate(`/quotations/${dup.id}`); },
    onError: onErr,
  });
  const deleteMut = useMutation({
    mutationFn: () => quotationService.remove(id!),
    onSuccess: () => { invalidate(); navigate('/quotations'); },
    onError: onErr,
  });

  const handleSendWhatsApp = async () => {
    setWaLoading(true);
    setWaMsg(null);
    try {
      const result = await quotationService.sendWhatsApp(id!);
      if (result.mode === 'WEB' && result.waLink) {
        openWhatsApp(result.waLink);
        setWaMsg({ ok: true, text: 'WhatsApp opened with the quote.' });
      } else if (result.success) {
        setWaMsg({ ok: true, text: 'Quote sent via WhatsApp.' });
      } else {
        setWaMsg({ ok: false, text: result.error ?? 'Failed to send.' });
      }
    } catch (err) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.message : null;
      setWaMsg({ ok: false, text: msg ?? 'Could not send quote.' });
    } finally {
      setWaLoading(false);
    }
  };

  if (isLoading) return <div className="p-6 text-slate-400 text-sm">Loading…</div>;
  if (!q) return <div className="p-6 text-slate-400 text-sm">Quotation not found.</div>;

  const isDraft = q.status === 'DRAFT';
  const isSent = q.status === 'SENT';
  const isAccepted = q.status === 'ACCEPTED';

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/quotations')} className="p-1.5 hover:bg-slate-100 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-slate-500" />
          </button>
          <div className="p-2 rounded-lg bg-indigo-50"><FileText className="w-4 h-4 text-indigo-600" /></div>
          <div>
            <h1 className="font-bold text-slate-800">{q.number}</h1>
            <p className="text-xs text-slate-400">
              {q.title ?? 'Quotation'} · {new Date(q.createdAt).toLocaleDateString('en-GB')}
            </p>
          </div>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${QUOTATION_STATUS_COLORS[q.status]}`}>
          {q.status.charAt(0) + q.status.slice(1).toLowerCase()}
        </span>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
        </div>
      )}

      {/* Converted banner */}
      {q.convertedToSale && (
        <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm flex items-center justify-between">
          <span className="flex items-center gap-2 text-purple-700">
            <Receipt className="w-4 h-4" /> Converted to sale <strong>{q.convertedToSale.number}</strong>
          </span>
          <button onClick={() => navigate('/sales')} className="text-xs text-purple-700 font-medium hover:underline">View sale</button>
        </div>
      )}

      {/* Info */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-3 gap-4 text-sm">
        <div><p className="text-xs text-slate-400 mb-0.5">Customer</p><p className="font-medium text-slate-800">{q.customer?.name ?? 'Walk-in'}</p></div>
        <div><p className="text-xs text-slate-400 mb-0.5">Phone</p><p className="font-medium text-slate-800">{q.customer?.phone ?? '—'}</p></div>
        <div><p className="text-xs text-slate-400 mb-0.5">Valid Until</p><p className="font-medium text-slate-800">{q.validUntil ? new Date(q.validUntil).toLocaleDateString('en-GB') : '—'}</p></div>
        <div><p className="text-xs text-slate-400 mb-0.5">Prepared by</p><p className="font-medium text-slate-800">{q.createdBy?.fullName ?? '—'}</p></div>
        {q.note && <div className="col-span-2"><p className="text-xs text-slate-400 mb-0.5">Note</p><p className="font-medium text-slate-800">{q.note}</p></div>}
      </div>

      {/* Lines */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Description</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Qty</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Unit Price</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.lines?.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <p className="font-medium text-slate-800">{l.description}</p>
                  {l.product && <p className="text-xs text-slate-400">{l.product.name}</p>}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-700">{Number(l.qty)} {l.unitLabel}</td>
                <td className="px-4 py-2.5 text-right text-slate-700">{money(l.unitPriceCents)}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{money(l.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="bg-slate-50 px-4 py-3 flex justify-end">
          <div className="w-56 space-y-1 text-sm">
            <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{money(q.subtotalCents)}</span></div>
            {q.discountCents > 0 && <div className="flex justify-between text-slate-500"><span>Discount</span><span>− {money(q.discountCents)}</span></div>}
            <div className="flex justify-between font-bold text-base pt-1 border-t border-slate-200 text-slate-800"><span>Total</span><span>{money(q.totalCents)}</span></div>
          </div>
        </div>
      </div>

      {q.termsConditions && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Terms &amp; Conditions</p>
          <p className="text-sm text-slate-600 whitespace-pre-wrap">{q.termsConditions}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {isDraft && (
          <>
            <button onClick={() => navigate(`/quotations/${q.id}/edit`)}
              className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition">
              <Edit className="w-4 h-4" /> Edit
            </button>
            <button onClick={() => statusMut.mutate('SENT')} disabled={statusMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 transition">
              <Send className="w-4 h-4" /> Mark as Sent
            </button>
            <button onClick={() => statusMut.mutate('REJECTED')} disabled={statusMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition">
              <XCircle className="w-4 h-4" /> Reject
            </button>
          </>
        )}
        {isSent && (
          <>
            <button onClick={() => statusMut.mutate('ACCEPTED')} disabled={statusMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-60 transition">
              <CheckCircle className="w-4 h-4" /> Accept
            </button>
            <button onClick={() => statusMut.mutate('REJECTED')} disabled={statusMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition">
              <XCircle className="w-4 h-4" /> Reject
            </button>
            <button onClick={() => statusMut.mutate('EXPIRED')} disabled={statusMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition">
              <Clock className="w-4 h-4" /> Expire
            </button>
          </>
        )}
        {isAccepted && (
          <button onClick={() => { if (window.confirm('Convert this quotation to a confirmed sale?')) convertMut.mutate(); }}
            disabled={convertMut.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition">
            <ShoppingCart className="w-4 h-4" /> Convert to Sale
          </button>
        )}
        <button onClick={() => duplicateMut.mutate()} disabled={duplicateMut.isPending}
          className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition">
          <Copy className="w-4 h-4" /> Duplicate
        </button>
        {isModuleEnabled('delivery') && (
          <button onClick={() => setShowDelivery(true)}
            className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition">
            <Truck className="w-4 h-4" /> Create Delivery
          </button>
        )}
        {isDraft && (
          <button onClick={() => { if (window.confirm('Delete this draft quotation?')) deleteMut.mutate(); }}
            disabled={deleteMut.isPending}
            className="flex items-center gap-1.5 px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 transition">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        )}
      </div>

      {/* WhatsApp */}
      {q.customer?.phone && (
        <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
          <WhatsAppButton label="Send Quote via WhatsApp" onClick={handleSendWhatsApp} isLoading={waLoading} />
          {waMsg && <span className={`text-xs ${waMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{waMsg.text}</span>}
        </div>
      )}

      {showDelivery && (
        <DeliveryFormModal
          prefill={{
            quotationId: q.id,
            customerId: q.customerId,
            contactName: q.customer?.name ?? null,
            contactPhone: q.customer?.phone ?? null,
          }}
          onClose={() => setShowDelivery(false)}
        />
      )}
    </div>
  );
}
