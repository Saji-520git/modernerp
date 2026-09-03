import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, ArrowDownCircle, ArrowUpCircle, AlertCircle, CheckCircle2 } from 'lucide-react';
import SearchableSelect from '../common/SearchableSelect';
import { customersApi, suppliersApi } from '../../services/contacts';
import { customerPaymentsApi } from '../../services/customerPayments';
import { supplierPaymentsApi } from '../../services/supplierPayments';
import { todayLocalYMD, ymdToTransactionISO } from '../../utils/local-date';

/**
 * Money that crosses the counter without being a sale.
 *
 * Two things happen at a till that the till could not previously record: a
 * customer walks in to settle what they owe, and a supplier's rep collects on
 * delivery. Both were back-office screens, so the cashier either left the till
 * or the movement went unrecorded — and an unrecorded payout makes the drawer
 * read short by exactly the amount handed over at close.
 *
 * Both directions post through the existing lump-sum endpoints, which allocate
 * oldest-bill-first, and both now carry the open shift, so the close reconciles.
 */

type Direction = 'COLLECT' | 'PAY';

const METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'QR_PAY'] as const;
const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank', QR_PAY: 'QR',
};

function rs(cents: number) {
  return `Rs. ${(cents / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CounterPaymentsModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [dir, setDir]         = useState<Direction>('COLLECT');
  const [partyId, setPartyId] = useState('');
  const [amount, setAmount]   = useState('');
  const [method, setMethod]   = useState<string>('CASH');
  const [reference, setReference] = useState('');
  const [note, setNote]       = useState('');
  const [error, setError]     = useState('');
  const [done, setDone]       = useState<{ allocated: number; leftover: number; count: number } | null>(null);

  // Switching direction must clear the party — a customer id is not a supplier
  // id, and posting one as the other would 404 at best.
  const switchTo = (d: Direction) => {
    if (d === dir) return;
    setDir(d); setPartyId(''); setAmount(''); setError(''); setDone(null);
  };

  const { data: customers } = useQuery({
    queryKey: ['pos-counter-customers'],
    queryFn:  () => customersApi.list({ pageSize: 500 }),
    enabled:  dir === 'COLLECT',
  });
  const { data: suppliers } = useQuery({
    queryKey: ['pos-counter-suppliers'],
    queryFn:  () => suppliersApi.list({ pageSize: 500 }),
    enabled:  dir === 'PAY',
  });

  const parties = (dir === 'COLLECT' ? customers?.data : suppliers?.data) ?? [];

  // The list endpoint does not carry a balance — only the detail does. Reading
  // it per selection is also the right thing on its own: what someone owes is
  // read at the moment they are paying, not from a list loaded minutes ago.
  // Narrowed to the one field both details share — CustomerDetail and
  // SupplierDetail are otherwise different shapes, and a union return type
  // gives the query no single type to infer.
  const { data: detail, isFetching: loadingBalance } = useQuery<{ outstandingBalance: number }>({
    queryKey: ['pos-counter-party', dir, partyId],
    queryFn:  () => (dir === 'COLLECT' ? customersApi.getOne(partyId) : suppliersApi.getOne(partyId)),
    enabled:  !!partyId,
  });
  const owed = Number(detail?.outstandingBalance ?? 0);

  const options = useMemo(
    () => parties.map((p: any) => ({
      value: p.id,
      label: p.name,
      keywords: p.phone ?? '',
    })),
    [parties],
  );

  const amountCents = Math.round((parseFloat(amount) || 0) * 100);

  const mutation = useMutation({
    mutationFn: async () => {
      const common = {
        amountCents,
        paymentMethod: method as any,
        referenceNo: reference.trim() || undefined,
        // The till stamps the real moment, exactly as a sale does.
        paymentDate: ymdToTransactionISO(todayLocalYMD()),
        notes: note.trim() || undefined,
      };
      if (dir === 'COLLECT') {
        return customerPaymentsApi.createLumpSum({ customerId: partyId, ...common } as any);
      }
      return supplierPaymentsApi.createLumpSum({ supplierId: partyId, ...common } as any);
    },
    onSuccess: (res: any) => {
      const allocations = res?.allocations ?? [];
      setDone({
        allocated: allocations.reduce((s: number, a: any) => s + (a.appliedCents ?? 0), 0),
        leftover:  res?.creditAddedCents ?? res?.creditRemainingCents ?? 0,
        count:     allocations.length,
      });
      // The drawer figure and the party's balance both just moved.
      queryClient.invalidateQueries({ queryKey: ['pos-counter-customers'] });
      queryClient.invalidateQueries({ queryKey: ['pos-counter-suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['pos-shift'] });
      queryClient.invalidateQueries({ queryKey: ['shift'] });
    },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'Payment failed'),
  });

  const canSubmit = !!partyId && amountCents > 0 && !mutation.isPending;
  const isIn = dir === 'COLLECT';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <h2 className="font-bold text-slate-800 text-base">Counter Payments</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        {/* Direction. Money in and money out are opposite mistakes to make, so
            they are stated as words and colour, never a quiet dropdown. */}
        <div className="grid grid-cols-2 gap-2 px-5 pt-4">
          <button type="button" onClick={() => switchTo('COLLECT')}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border transition ${
              isIn ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            <ArrowDownCircle className="w-4 h-4" /> Collect from Customer
          </button>
          <button type="button" onClick={() => switchTo('PAY')}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border transition ${
              !isIn ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}>
            <ArrowUpCircle className="w-4 h-4" /> Pay Supplier
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
            </div>
          )}

          {done ? (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 space-y-1">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="w-4 h-4" />
                {isIn ? 'Payment collected' : 'Payment made'}
              </div>
              <div>{rs(done.allocated)} applied across {done.count} {done.count === 1 ? 'bill' : 'bills'}.</div>
              {done.leftover > 0 && (
                <div>{rs(done.leftover)} left {isIn ? 'on the customer’s account' : 'as supplier credit'}.</div>
              )}
              {method === 'CASH' && (
                <div className="pt-1 text-emerald-700">
                  Recorded against this shift, so the drawer will reconcile at close.
                </div>
              )}
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {isIn ? 'Customer' : 'Supplier'} *
                </label>
                <SearchableSelect
                  value={partyId}
                  onChange={(v) => { setPartyId(v); setError(''); }}
                  options={options}
                  placeholder={isIn ? 'Search customer…' : 'Search supplier…'}
                />
                {partyId && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    {loadingBalance
                      ? 'Checking balance…'
                      : owed > 0
                        ? <>Outstanding <span className="font-semibold text-slate-700">{rs(owed)}</span></>
                        : <>Nothing outstanding — anything paid is held {isIn ? 'on account' : 'as credit'}.</>}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Amount *</label>
                  <input type="number" min="0.01" step="0.01" value={amount} inputMode="decimal"
                    onChange={(e) => { setAmount(e.target.value); setError(''); }}
                    placeholder="0.00"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  {owed > 0 && (
                    <button type="button" onClick={() => setAmount((owed / 100).toFixed(2))}
                      className="mt-1 text-[11px] text-indigo-600 hover:text-indigo-700 font-medium">
                      Settle full {rs(owed)}
                    </button>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Method</label>
                  <select value={method} onChange={(e) => setMethod(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
                  </select>
                  {method === 'CASH' && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      {isIn ? 'Goes into' : 'Comes out of'} this drawer.
                    </p>
                  )}
                </div>
              </div>

              {method !== 'CASH' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Reference</label>
                  <input type="text" value={reference} onChange={(e) => setReference(e.target.value)}
                    placeholder="Cheque or transaction no."
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Note</label>
                <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>

              {amountCents > owed && owed >= 0 && amountCents > 0 && (
                <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  {rs(Math.min(amountCents, owed))} clears {isIn ? 'bills' : 'purchases'};{' '}
                  {rs(amountCents - owed)} is held {isIn ? 'on account' : 'as supplier credit'}.
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3.5 border-t flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
            {done ? 'Done' : 'Cancel'}
          </button>
          {!done && (
            <button onClick={() => { setError(''); mutation.mutate(); }} disabled={!canSubmit}
              className={`px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 transition ${
                isIn ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
              {mutation.isPending ? 'Saving…' : isIn ? 'Collect Payment' : 'Pay Supplier'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
