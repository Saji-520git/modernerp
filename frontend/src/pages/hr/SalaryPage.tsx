import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet, Play, X, Calculator } from 'lucide-react';
import { hrService, formatCents, rupeesToCents, centsToRupees } from '../../services/hrService';
import type { Salary, SalaryCalc, PayrollResult } from '../../types/hr';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

// ─── Process Salary Modal ─────────────────────────────────────────────────────

function ProcessModal({
  calc, month, year, onClose, onProcessed,
}: {
  calc: SalaryCalc;
  month: number;
  year: number;
  onClose: () => void;
  onProcessed: () => void;
}) {
  const [allowances, setAllowances] = useState(centsToRupees(calc.allowancesCents));
  const [extraDeductions, setExtraDeductions] = useState('0.00');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const allowancesCents = rupeesToCents(allowances || '0');
  const extraDeductionsCents = rupeesToCents(extraDeductions || '0');
  const totalDeductions = calc.deductionsCents + extraDeductionsCents;
  const net = Math.max(0, calc.basicCents + allowancesCents - totalDeductions);

  const mutation = useMutation({
    mutationFn: () => hrService.processSalary(calc.staffId, month, year, {
      allowancesCents,
      deductionsCents: extraDeductionsCents,
      notes: notes || null,
    }),
    onSuccess: onProcessed,
    onError: (err: unknown) => setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to process'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">Process Salary — {calc.fullName}</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-3 text-sm bg-slate-50 rounded-lg p-4">
            <div><span className="text-slate-400 text-xs block">Working Days</span>{calc.workingDays}</div>
            <div><span className="text-slate-400 text-xs block">Present</span>{calc.presentDays}</div>
            <div><span className="text-slate-400 text-xs block">Absent</span>{calc.absentDays}</div>
            <div><span className="text-slate-400 text-xs block">Half Days</span>{calc.halfDays}</div>
            <div><span className="text-slate-400 text-xs block">Per Day</span>{formatCents(calc.perDayCents)}</div>
            <div><span className="text-slate-400 text-xs block">Attendance Deduction</span>{formatCents(calc.deductionsCents)}</div>
          </div>

          <div className="flex items-center justify-between text-sm border-b border-slate-100 pb-2">
            <span className="text-slate-600">Basic Salary</span>
            <span className="font-medium text-slate-800">{formatCents(calc.basicCents)}</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Allowances (Rs.)</label>
            <input type="number" min="0" step="0.01" value={allowances} onChange={(e) => setAllowances(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Extra Deductions (Rs.)</label>
            <input type="number" min="0" step="0.01" value={extraDeductions} onChange={(e) => setExtraDeductions(e.target.value)} className={inputCls} />
            <p className="text-xs text-slate-400 mt-1">Added on top of the {formatCents(calc.deductionsCents)} attendance deduction.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
          </div>

          <div className="flex items-center justify-between bg-blue-50 rounded-lg px-4 py-3">
            <span className="text-sm font-semibold text-blue-800">Net Pay</span>
            <span className="text-lg font-bold text-blue-700">{formatCents(net)}</span>
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button onClick={() => { setError(''); mutation.mutate(); }} disabled={mutation.isPending} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
              {mutation.isPending ? 'Processing…' : 'Process & Mark Paid'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Individual Tab ───────────────────────────────────────────────────────────

function IndividualTab({ month, year }: { month: number; year: number }) {
  const qc = useQueryClient();
  const [calc, setCalc] = useState<SalaryCalc | null>(null);

  const { data: salaries, isLoading } = useQuery({
    queryKey: ['salary', month, year],
    queryFn:  () => hrService.getMonthlySalary(month, year),
  });

  const { data: staff } = useQuery({
    queryKey: ['staff', { isActive: true }],
    queryFn:  () => hrService.getAllStaff({ isActive: true }),
  });

  const calcMutation = useMutation({
    mutationFn: (staffId: string) => hrService.calculateSalary(staffId, month, year),
    onSuccess: (data) => setCalc(data),
  });

  const salaryByStaff = useMemo(() => {
    const map = new Map<string, Salary>();
    (salaries ?? []).forEach((s) => map.set(s.staffId, s));
    return map;
  }, [salaries]);

  const onProcessed = () => {
    setCalc(null);
    qc.invalidateQueries({ queryKey: ['salary'] });
  };

  return (
    <div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Employee</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Department</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Basic</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Net Pay</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Status</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={6} className="text-center py-12 text-slate-400">Loading…</td></tr>}
            {!isLoading && (staff?.length ?? 0) === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No active staff</td></tr>
            )}
            {(staff ?? []).map((s) => {
              const sal = salaryByStaff.get(s.id);
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{s.fullName}</div>
                    <div className="text-xs text-slate-400 font-mono">{s.employeeId}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{s.department ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">{formatCents(s.basicSalaryCents)}</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-800 whitespace-nowrap">{sal ? formatCents(sal.netCents) : '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {sal ? (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sal.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{sal.status}</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">Not processed</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => calcMutation.mutate(s.id)}
                      disabled={calcMutation.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                    >
                      <Calculator size={13} /> {sal?.status === 'PAID' ? 'Re-process' : 'Calculate'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {calc && (
        <ProcessModal calc={calc} month={month} year={year} onClose={() => setCalc(null)} onProcessed={onProcessed} />
      )}
    </div>
  );
}

// ─── Process Payroll Tab ──────────────────────────────────────────────────────

function PayrollTab({ month, year }: { month: number; year: number }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<PayrollResult | null>(null);

  const mutation = useMutation({
    mutationFn: () => hrService.processPayroll(month, year),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['salary'] });
    },
  });

  return (
    <div className="max-w-xl">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h3 className="text-base font-semibold text-slate-800 mb-1">Run Payroll for {MONTHS[month - 1]} {year}</h3>
        <p className="text-sm text-slate-500 mb-5">
          Processes salary for all active staff who have not yet been paid this month. Already-paid records are skipped.
        </p>
        <button
          onClick={() => { setResult(null); mutation.mutate(); }}
          disabled={mutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
        >
          <Play size={16} /> {mutation.isPending ? 'Running…' : 'Run Payroll'}
        </button>

        {mutation.isError && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">Payroll run failed. Please try again.</div>
        )}

        {result && (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="bg-green-50 rounded-lg p-4 text-center"><p className="text-2xl font-bold text-green-700">{result.processed}</p><p className="text-xs text-green-600">Processed</p></div>
            <div className="bg-amber-50 rounded-lg p-4 text-center"><p className="text-2xl font-bold text-amber-700">{result.skipped}</p><p className="text-xs text-amber-600">Skipped (already paid)</p></div>
            <div className="bg-slate-50 rounded-lg p-4 text-center"><p className="text-2xl font-bold text-slate-700">{result.totalStaff}</p><p className="text-xs text-slate-500">Total Staff</p></div>
            <div className="bg-blue-50 rounded-lg p-4 text-center"><p className="text-xl font-bold text-blue-700">{formatCents(result.totalPaidCents)}</p><p className="text-xs text-blue-600">Total Paid</p></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'individual' | 'payroll';

export default function SalaryPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [tab, setTab] = useState<Tab>('individual');

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: salaries } = useQuery({
    queryKey: ['salary', month, year],
    queryFn:  () => hrService.getMonthlySalary(month, year),
  });

  const totals = useMemo(() => {
    const rows = salaries ?? [];
    const net = rows.reduce((sum, s) => sum + s.netCents, 0);
    const paid = rows.filter((s) => s.status === 'PAID').length;
    const pending = rows.filter((s) => s.status === 'PENDING').length;
    return { net, paid, pending, count: rows.length };
  }, [salaries]);

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Salary &amp; Payroll</h1>
          <p className="text-sm text-slate-500 mt-0.5">Calculate, process and pay staff salaries</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1"><Wallet size={15} /><span className="text-xs uppercase tracking-wide">Total Net</span></div>
          <p className="text-xl font-bold text-slate-800">{formatCents(totals.net)}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Processed</p>
          <p className="text-xl font-bold text-slate-800">{totals.count}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs uppercase tracking-wide text-green-600 mb-1">Paid</p>
          <p className="text-xl font-bold text-green-700">{totals.paid}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <p className="text-xs uppercase tracking-wide text-amber-600 mb-1">Pending</p>
          <p className="text-xl font-bold text-amber-700">{totals.pending}</p>
        </div>
      </div>

      <div className="flex gap-1 mb-5 border-b border-slate-200">
        <button onClick={() => setTab('individual')} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'individual' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Individual</button>
        <button onClick={() => setTab('payroll')} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'payroll' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Process Payroll</button>
      </div>

      {tab === 'individual' ? <IndividualTab month={month} year={year} /> : <PayrollTab month={month} year={year} />}
    </div>
  );
}
