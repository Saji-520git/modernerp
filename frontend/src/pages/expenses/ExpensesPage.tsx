import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Pencil, Trash2, X, DollarSign,
  Tag, TrendingDown, TrendingUp, AlertCircle, Palette,
  Download, RefreshCw, RotateCcw, AlertTriangle, CheckCircle,
} from 'lucide-react';
import {
  expensesApi, formatCents, PAYMENT_LABELS, PRESET_COLORS,
  type Expense, type ExpenseCategory, type ExpensePaymentMethod,
  type CreateExpensePayload,
} from '../../services/expenses';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(' ');
}
function todayIso() { return new Date().toISOString().slice(0, 10); }
function nowMonth() { return new Date().toISOString().slice(0, 7); }

// ─── Expense Modal ────────────────────────────────────────────────────────────

function ExpenseModal({
  initial, categories, onSave, onClose, saving, error,
}: {
  initial?: Partial<Expense> & { prefill?: boolean };
  categories: ExpenseCategory[];
  onSave: (p: CreateExpensePayload) => void;
  onClose: () => void;
  saving: boolean;
  error: string;
}) {
  // Prefer categoryId FK; fall back to category.id (joined object) if FK is missing in response
  const [categoryId,    setCategoryId]    = useState(initial?.categoryId ?? initial?.category?.id ?? '');
  const [amount,        setAmount]        = useState(initial?.amount ? (initial.amount / 100).toFixed(2) : '');
  const [description,   setDescription]  = useState(initial?.description ?? '');
  const [date,          setDate]          = useState(initial?.date?.slice(0, 10) ?? todayIso());
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>(initial?.paymentMethod ?? 'CASH');
  const [reference,     setReference]    = useState(initial?.reference ?? '');
  const [isRecurring,   setIsRecurring]  = useState(initial?.isRecurring ?? false);
  const [recurringDay,  setRecurringDay] = useState(String(initial?.recurringDay ?? new Date().getDate()));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents <= 0 || !categoryId || !description.trim() || !date) return;
    onSave({
      categoryId,
      amount: amountCents,
      description: description.trim(),
      date: new Date(date).toISOString(),
      paymentMethod,
      reference: reference.trim() || null,
      isRecurring,
      recurringDay: isRecurring ? (parseInt(recurringDay) || null) : null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-orange-500" />
            {initial && !initial.prefill ? 'Edit Expense' : 'Add Expense'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Date *</label>
              <input type="date" required value={date} onChange={e => setDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Amount (Rs.) *</label>
              <input type="number" min="0.01" step="0.01" required value={amount}
                onChange={e => setAmount(e.target.value)} placeholder="0.00"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Category *</label>
            <select required value={categoryId} onChange={e => setCategoryId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
              <option value="">— Select Category —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Description *</label>
            <input type="text" required value={description} onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Monthly office rent"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Payment Method</label>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as ExpensePaymentMethod)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                {(Object.entries(PAYMENT_LABELS) as [ExpensePaymentMethod, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Reference (optional)</label>
              <input type="text" value={reference} onChange={e => setReference(e.target.value)}
                placeholder="Receipt #, Invoice #"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
          </div>

          {/* Recurring toggle */}
          <div className="bg-slate-50 rounded-xl p-3 space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)}
                className="w-4 h-4 accent-orange-500 cursor-pointer" />
              <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5 text-orange-500" /> Recurring monthly
              </span>
            </label>
            {isRecurring && (
              <div className="flex items-center gap-3 pl-7">
                <label className="text-xs text-slate-500">Day of month</label>
                <input type="number" min="1" max="28" value={recurringDay}
                  onChange={e => setRecurringDay(e.target.value)}
                  className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-orange-400" />
                <span className="text-xs text-slate-400">of each month</span>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-[2] py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 disabled:opacity-60 transition">
              {saving ? 'Saving…' : (initial && !initial.prefill) ? 'Update Expense' : 'Add Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Category Modal ───────────────────────────────────────────────────────────

function CategoryModal({
  initial, onSave, onClose, saving, error,
}: {
  initial?: ExpenseCategory;
  onSave: (name: string, color: string, budget: number | null) => void;
  onClose: () => void;
  saving: boolean;
  error?: string;
}) {
  const [name,   setName]   = useState(initial?.name   ?? '');
  const [color,  setColor]  = useState(initial?.color  ?? PRESET_COLORS[0]);
  const [budget, setBudget] = useState(initial?.monthlyBudget ? (initial.monthlyBudget / 100).toFixed(0) : '');

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-xs shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <Tag className="w-4 h-4 text-indigo-500" /> {initial ? 'Edit Category' : 'Add Category'}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4 text-slate-500" /></button>
        </div>
        {error && (
          <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
          </div>
        )}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Name *</label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rent, Utilities…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1">
              <Palette className="w-3 h-3" /> Color
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map(c => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className={cls('w-7 h-7 rounded-full border-2 transition',
                    color === c ? 'border-slate-800 scale-110' : 'border-transparent hover:scale-105')}
                  style={{ background: c }} />
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Monthly Budget (Rs.) <span className="font-normal text-slate-400">optional</span></label>
            <input type="number" min="0" step="100" value={budget} onChange={e => setBudget(e.target.value)}
              placeholder="Leave blank for no limit"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={() => {
              if (!name.trim()) return;
              const budgetCents = budget.trim() ? Math.round(parseFloat(budget) * 100) : null;
              onSave(name.trim(), color, budgetCents);
            }}
            disabled={!name.trim() || saving}
            className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition">
            {saving ? 'Saving…' : initial ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirm ───────────────────────────────────────────────────────────

function DeleteConfirm({ msg, onConfirm, onClose, pending }: {
  msg: string; onConfirm: () => void; onClose: () => void; pending: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-xs shadow-xl p-6 text-center">
        <Trash2 className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <p className="text-sm text-slate-600 mb-5">{msg}</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={onConfirm} disabled={pending}
            className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-60">
            {pending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function thisMonthStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}
function today(): string {
  return new Date().toISOString().split('T')[0];
}

// ─── Expenses Tab ─────────────────────────────────────────────────────────────

function ExpensesTab({ categories }: { categories: ExpenseCategory[] }) {
  const qc = useQueryClient();
  const [search,     setSearch]     = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [from,       setFrom]       = useState(thisMonthStart);
  const [to,         setTo]         = useState(today);
  const [page,       setPage]       = useState(1);
  const [showAdd,    setShowAdd]    = useState(false);
  const [editItem,   setEditItem]   = useState<Expense | null>(null);
  const [deleteId,   setDeleteId]   = useState<string | null>(null);
  const [saveError,  setSaveError]  = useState('');
  const [toast,      setToast]      = useState<string | null>(null);
  const PAGE_SIZE = 25;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const { data: summary } = useQuery({
    queryKey: ['expense-summary'],
    queryFn:  () => expensesApi.getMonthlySummary(),
    staleTime: 0,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', search, categoryId, from, to, page],
    queryFn:  () => expensesApi.listExpenses({ search: search || undefined, categoryId: categoryId || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE }),
    staleTime: 0,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['expenses'] });
    qc.invalidateQueries({ queryKey: ['expense-summary'] });
    qc.invalidateQueries({ queryKey: ['expense-recurring'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const createMutation = useMutation({
    mutationFn: (p: CreateExpensePayload) => expensesApi.createExpense(p),
    onSuccess: () => { invalidate(); setShowAdd(false); setSaveError(''); },
    onError:   (e: any) => setSaveError(e?.response?.data?.message ?? e?.message ?? 'Failed to save'),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, p }: { id: string; p: CreateExpensePayload }) => expensesApi.updateExpense(id, p),
    onSuccess: () => { invalidate(); setEditItem(null); setSaveError(''); },
    onError:   (e: any) => setSaveError(e?.response?.data?.message ?? e?.message ?? 'Failed to update'),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => expensesApi.deleteExpense(id),
    onSuccess: (data: any) => {
      invalidate();
      setDeleteId(null);
      if (data?.warning) showToast(data.warning);
    },
    onError:   (e: any) => setSaveError(e?.response?.data?.message ?? e?.message ?? 'Failed to delete'),
  });

  const expenses   = data?.data ?? [];
  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  // CSV export
  const exportCsv = () => {
    const headers = ['Date','Description','Category','Amount (Rs.)','Payment Method','Reference','Created By'];
    const rows = expenses.map(e => [
      new Date(e.date).toLocaleDateString(),
      `"${e.description.replace(/"/g, '""')}"`,
      e.category.name,
      (e.amount / 100).toFixed(2),
      PAYMENT_LABELS[e.paymentMethod],
      e.reference ?? '',
      e.createdBy.fullName,
    ]);
    const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `expenses-${nowMonth()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'This Month',    value: formatCents(summary?.totalCents ?? 0),     sub: summary?.changePct !== null && summary?.changePct !== undefined ? `${summary.changePct > 0 ? '+' : ''}${summary.changePct}% vs last month` : 'vs last month', icon: DollarSign, trend: summary?.changePct },
          { label: 'Transactions',  value: String(summary?.count ?? 0),              sub: 'this month', icon: Tag },
          { label: 'Over Budget',   value: String(summary?.overBudgetCount ?? 0),    sub: 'categories over limit', icon: AlertTriangle },
          { label: 'Last Month',    value: formatCents(summary?.prevTotalCents ?? 0), sub: 'previous month', icon: TrendingDown },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3 shadow-sm">
            <div className={cls('p-2 rounded-lg shrink-0', k.label === 'Over Budget' && (summary?.overBudgetCount ?? 0) > 0 ? 'bg-red-50' : 'bg-orange-50')}>
              <k.icon className={cls('w-4 h-4', k.label === 'Over Budget' && (summary?.overBudgetCount ?? 0) > 0 ? 'text-red-500' : 'text-orange-500')} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-400 font-medium">{k.label}</p>
              <p className="text-lg font-bold text-slate-800 truncate">{k.value}</p>
              {'sub' in k && k.sub && (
                <p className={cls('text-xs flex items-center gap-0.5', (k as any).trend !== undefined ? ((k as any).trend < 0 ? 'text-green-600' : 'text-red-500') : 'text-slate-400')}>
                  {(k as any).trend !== undefined && ((k as any).trend < 0 ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />)}
                  {k.sub}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Filters + buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search…"
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
        </div>
        <select value={categoryId} onChange={e => { setCategoryId(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
          <option value="">All Categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
        <span className="text-slate-400 text-xs">to</span>
        <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
        <button type="button" onClick={() => { setFrom(thisMonthStart()); setTo(today()); setPage(1); }}
          className="text-xs text-slate-500 hover:text-slate-700 underline">This month</button>
        <button type="button" onClick={() => { setFrom(''); setTo(''); setPage(1); }}
          className="text-xs text-slate-500 hover:text-slate-700 underline">All time</button>
        <div className="ml-auto flex gap-2">
          <button onClick={exportCsv} disabled={expenses.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-40 transition">
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button onClick={() => { setShowAdd(true); setSaveError(''); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 transition">
            <Plus className="w-4 h-4" /> Add Expense
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Date</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Description</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Category</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Payment</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600">Amount</th>
              <th className="px-4 py-3 w-20 text-center font-semibold text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={6} className="text-center py-8 text-slate-400">Loading…</td></tr>}
            {!isLoading && expenses.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-400">No expenses found</td></tr>}
            {expenses.map(e => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                  {new Date(e.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {e.isRecurring && <span className="ml-1 text-orange-400" title="Recurring"><RotateCcw className="w-3 h-3 inline" /></span>}
                </td>
                <td className="px-4 py-3 text-slate-800">
                  <p className="font-medium">{e.description}</p>
                  {e.reference && <p className="text-xs text-slate-400">{e.reference}</p>}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: e.category.color + '22', color: e.category.color }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: e.category.color }} />
                    {e.category.name}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{PAYMENT_LABELS[e.paymentMethod]}</td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800 whitespace-nowrap">{formatCents(e.amount)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => { setEditItem(e); setSaveError(''); }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => setDeleteId(e.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-sm text-slate-500">
            <span>{total} records</span>
            <div className="flex gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border border-slate-200 rounded disabled:opacity-40 hover:bg-slate-50">← Prev</button>
              <span className="px-3 py-1">Page {page} of {totalPages}</span>
              <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border border-slate-200 rounded disabled:opacity-40 hover:bg-slate-50">Next →</button>
            </div>
          </div>
        )}
      </div>

      {showAdd && <ExpenseModal categories={categories} onSave={p => createMutation.mutate(p)} onClose={() => { setShowAdd(false); setSaveError(''); }} saving={createMutation.isPending} error={saveError} />}
      {editItem && <ExpenseModal initial={editItem} categories={categories} onSave={p => updateMutation.mutate({ id: editItem.id, p })} onClose={() => { setEditItem(null); setSaveError(''); }} saving={updateMutation.isPending} error={saveError} />}
      {deleteId && <DeleteConfirm msg="Delete this expense? This cannot be undone." onConfirm={() => deleteMutation.mutate(deleteId!)} onClose={() => setDeleteId(null)} pending={deleteMutation.isPending} />}

      {toast && (
        <div className="fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-[9999] bg-amber-600 text-white max-w-sm">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Categories Tab ───────────────────────────────────────────────────────────

function CategoriesTab({ categories, onRefresh }: { categories: ExpenseCategory[]; onRefresh: () => void }) {
  const qc = useQueryClient();
  const [showAdd,    setShowAdd]    = useState(false);
  const [editCat,    setEditCat]    = useState<ExpenseCategory | null>(null);
  const [deleteCat,  setDeleteCat]  = useState<ExpenseCategory | null>(null);
  const [saveErr,    setSaveErr]    = useState('');

  const invalidateCats = () => { qc.invalidateQueries({ queryKey: ['expense-categories'] }); onRefresh(); };

  const createMut = useMutation({
    mutationFn: ({ name, color, budget }: { name: string; color: string; budget: number | null }) =>
      expensesApi.createCategory({ name, color, monthlyBudget: budget }),
    onSuccess: () => { invalidateCats(); setShowAdd(false); setSaveErr(''); },
    onError:   (e: any) => setSaveErr(e?.response?.data?.message ?? 'Failed to create category'),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, name, color, budget }: { id: string; name: string; color: string; budget: number | null }) =>
      expensesApi.updateCategory(id, { name, color, monthlyBudget: budget }),
    onSuccess: () => { invalidateCats(); setEditCat(null); setSaveErr(''); },
    onError:   (e: any) => setSaveErr(e?.response?.data?.message ?? 'Failed to update category'),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => expensesApi.deleteCategory(id),
    onSuccess: () => { invalidateCats(); setDeleteCat(null); setSaveErr(''); },
    onError: (e: any) => setSaveErr(e?.response?.data?.message ?? 'Delete failed'),
  });

  const { data: summary } = useQuery({ queryKey: ['expense-summary'], queryFn: () => expensesApi.getMonthlySummary(), staleTime: 0 });
  const budgetMap = new Map((summary?.byCategory ?? []).map(c => [c.id, c]));

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{categories.length} categories</p>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition">
          <Plus className="w-4 h-4" /> Add Category
        </button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm divide-y divide-slate-100">
        {categories.length === 0 && <p className="text-center py-8 text-slate-400 text-sm">No categories yet</p>}
        {categories.map(c => {
          const spend = budgetMap.get(c.id);
          const pct   = spend && c.monthlyBudget ? Math.min(100, Math.round((spend.totalCents / c.monthlyBudget) * 100)) : null;
          const over  = spend?.overBudget ?? false;
          return (
            <div key={c.id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-center gap-3">
                <span className="w-4 h-4 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="font-medium text-slate-800 flex-1">{c.name}</span>
                {c.monthlyBudget && spend && (
                  <span className={cls('text-xs font-medium', over ? 'text-red-600' : 'text-slate-500')}>
                    {formatCents(spend.totalCents)} / {formatCents(c.monthlyBudget)}
                  </span>
                )}
                <span className="text-xs text-slate-400">{c._count?.expenses ?? 0} exp.</span>
                <div className="flex gap-1">
                  <button onClick={() => setEditCat(c)} className="p-1 text-slate-400 hover:text-indigo-600 rounded transition"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => { setDeleteCat(c); setSaveErr(''); }} className="p-1 text-slate-400 hover:text-red-600 rounded transition"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              {pct !== null && (
                <div className="ml-7">
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={cls('h-full rounded-full transition-all', over ? 'bg-red-500' : 'bg-green-500')} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAdd && <CategoryModal error={saveErr} onSave={(n, c, b) => createMut.mutate({ name: n, color: c, budget: b })} onClose={() => { setShowAdd(false); setSaveErr(''); }} saving={createMut.isPending} />}
      {editCat  && <CategoryModal error={saveErr} initial={editCat} onSave={(n, c, b) => updateMut.mutate({ id: editCat.id, name: n, color: c, budget: b })} onClose={() => { setEditCat(null); setSaveErr(''); }} saving={updateMut.isPending} />}
      {deleteCat && (
        <DeleteConfirm
          msg={saveErr || ((deleteCat._count?.expenses ?? 0) > 0
            ? `This category has ${deleteCat._count!.expenses} expenses. Cannot delete.`
            : `Delete category "${deleteCat.name}"? This cannot be undone.`)}
          onConfirm={() => (deleteCat._count?.expenses ?? 0) > 0 ? setDeleteCat(null) : deleteMut.mutate(deleteCat.id)}
          onClose={() => { setDeleteCat(null); setSaveErr(''); }}
          pending={deleteMut.isPending}
        />
      )}
    </div>
  );
}

// ─── Recurring Tab ────────────────────────────────────────────────────────────

function RecurringTab({ categories }: { categories: ExpenseCategory[] }) {
  const qc = useQueryClient();
  const [recordItem, setRecordItem] = useState<Expense | null>(null);
  const [saveError,  setSaveError]  = useState('');
  const [toast,      setToast]      = useState<string | null>(null);
  const today = new Date().getDate();

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const { data: recurring = [], isLoading } = useQuery<Expense[]>({
    queryKey: ['expense-recurring'],
    queryFn:  expensesApi.getRecurringDue,
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: (p: CreateExpensePayload) => expensesApi.createExpense(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expense-summary'] });
      qc.invalidateQueries({ queryKey: ['expense-recurring'] });
      setRecordItem(null); setSaveError('');
    },
    onError: (e: any) => setSaveError(e?.response?.data?.message ?? 'Failed'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => expensesApi.deleteRecurringTemplate(id),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expense-recurring'] });
      qc.invalidateQueries({ queryKey: ['expense-summary'] });
      if (data?.deletedOccurrences > 0) {
        showToast(`Deleted recurring template and ${data.deletedOccurrences} recorded expense(s). P&L history updated.`);
      }
    },
    onError: (e: any) => setSaveError(e?.response?.data?.message ?? e?.message ?? 'Failed to delete recurring expense'),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Recurring expenses that repeat monthly. Click <strong>Record Now</strong> to log this month's occurrence.
      </p>
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Description</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Category</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600">Amount</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600">Due Day</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600">Status</th>
              <th className="px-4 py-3 w-40" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={6} className="text-center py-8 text-slate-400">Loading…</td></tr>}
            {!isLoading && recurring.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-400">No recurring expenses set up</td></tr>}
            {recurring.map(e => {
              const isDue = e.recurringDay !== null && e.recurringDay <= today;
              return (
                <tr key={e.id} className={cls('hover:bg-slate-50', isDue && !e.recordedThisMonth ? 'bg-amber-50/40' : '')}>
                  <td className="px-4 py-3 font-medium text-slate-800">{e.description}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
                      style={{ background: e.category.color + '22', color: e.category.color }}>
                      {e.category.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatCents(e.amount)}</td>
                  <td className="px-4 py-3 text-center text-slate-500 text-xs">Day {e.recurringDay ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {e.recordedThisMonth
                      ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Done this month</span>
                      : isDue
                      ? <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Due</span>
                      : <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-medium">Upcoming</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => { if (!e.recordedThisMonth) { setRecordItem(e); setSaveError(''); } }}
                        disabled={e.recordedThisMonth}
                        className={cls(
                          'flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg transition',
                          e.recordedThisMonth
                            ? 'bg-green-100 text-green-700 cursor-not-allowed opacity-80'
                            : 'bg-orange-500 text-white hover:bg-orange-600',
                        )}
                      >
                        {e.recordedThisMonth
                          ? <><CheckCircle className="w-3 h-3" /> Recorded ✓</>
                          : <><RefreshCw className="w-3 h-3" /> Record</>}
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm('Delete this recurring expense? This will also remove all recorded occurrences this month.')) {
                            deleteMut.mutate(e.id);
                          }
                        }}
                        disabled={deleteMut.isPending}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-40"
                        title="Delete recurring template"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {recordItem && (
        <ExpenseModal
          initial={{ ...recordItem, date: todayIso(), isRecurring: false, prefill: true }}
          categories={categories}
          onSave={p => createMutation.mutate({ ...p, isRecurring: false })}
          onClose={() => { setRecordItem(null); setSaveError(''); }}
          saving={createMutation.isPending}
          error={saveError}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-[9999] bg-amber-600 text-white max-w-sm">
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Tab = 'expenses' | 'categories' | 'recurring';

export default function ExpensesPage() {
  const [tab, setTab] = useState<Tab>('expenses');
  const qc = useQueryClient();

  const { data: categories = [], refetch: refetchCats } = useQuery<ExpenseCategory[]>({
    queryKey: ['expense-categories'],
    queryFn:  expensesApi.listCategories,
    staleTime: 60_000,
  });

  const { data: recurring = [] } = useQuery<Expense[]>({
    queryKey: ['expense-recurring'],
    queryFn:  expensesApi.getRecurringDue,
    staleTime: 0,
  });

  const dueCount = (recurring as Expense[]).filter(e => e.isDue && !e.recordedThisMonth).length;

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <TrendingDown className="w-6 h-6 text-orange-500" /> Expenses
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">Track business expenses and overheads</p>
      </div>

      {/* Recurring due alert */}
      {dueCount > 0 && (
        <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-amber-800">
            <strong>{dueCount} recurring expense{dueCount > 1 ? 's' : ''}</strong> due today.
          </p>
          <button onClick={() => setTab('recurring')} className="ml-auto text-xs font-semibold text-amber-700 hover:underline">
            View →
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { key: 'expenses',   label: 'All Expenses' },
          { key: 'categories', label: 'Categories' },
          { key: 'recurring',  label: `Recurring${dueCount > 0 ? ` (${dueCount} due)` : ''}` },
        ] as { key: Tab; label: string }[]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cls('px-4 py-2 text-sm font-medium border-b-2 transition',
              tab === t.key ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'expenses'   && <ExpensesTab categories={categories} />}
      {tab === 'categories' && <CategoriesTab categories={categories} onRefresh={() => { qc.invalidateQueries({ queryKey: ['expense-categories'] }); refetchCats(); }} />}
      {tab === 'recurring'  && <RecurringTab categories={categories} />}
    </div>
  );
}
