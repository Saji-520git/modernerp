import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, FileBarChart } from 'lucide-react';
import { hrService, formatCents } from '../../services/hrService';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ─── Attendance Report ────────────────────────────────────────────────────────

function AttendanceReport({ month, year }: { month: number; year: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'attendance', month, year],
    queryFn:  () => hrService.getAttendanceReport(month, year),
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto print:border-0 print:shadow-none">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Employee</th>
            <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Department</th>
            <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Present</th>
            <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Late</th>
            <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Half</th>
            <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Leave</th>
            <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Absent</th>
            <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Total</th>
            <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Attendance %</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {isLoading && <tr><td colSpan={9} className="text-center py-12 text-slate-400">Loading…</td></tr>}
          {!isLoading && (data?.length ?? 0) === 0 && (
            <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-400">No attendance data for this period</td></tr>
          )}
          {(data ?? []).map((r) => (
            <tr key={r.staffId} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-800">{r.fullName}</div>
                <div className="text-xs text-slate-400 font-mono">{r.employeeId}</div>
              </td>
              <td className="px-4 py-3 text-slate-600">{r.department ?? '—'}</td>
              <td className="px-4 py-3 text-center text-green-700">{r.present}</td>
              <td className="px-4 py-3 text-center text-amber-700">{r.late}</td>
              <td className="px-4 py-3 text-center text-blue-700">{r.halfDay}</td>
              <td className="px-4 py-3 text-center text-slate-600">{r.leave}</td>
              <td className="px-4 py-3 text-center text-red-700">{r.absent}</td>
              <td className="px-4 py-3 text-center text-slate-600">{r.totalDays}</td>
              <td className="px-4 py-3 text-right font-medium text-slate-800">{r.attendancePct.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Payroll Report ───────────────────────────────────────────────────────────

function PayrollReport({ month, year }: { month: number; year: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'payroll', month, year],
    queryFn:  () => hrService.getPayrollReport(month, year),
  });

  const departments = useMemo(() => Object.keys(data?.departmentTotals ?? {}).sort(), [data]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto print:border-0 print:shadow-none">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Employee</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Department</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Basic</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Allowances</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Deductions</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Net</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={7} className="text-center py-12 text-slate-400">Loading…</td></tr>}
            {!isLoading && (data?.rows.length ?? 0) === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">No payroll data for this period</td></tr>
            )}
            {(data?.rows ?? []).map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{s.staff?.fullName ?? '—'}</div>
                  <div className="text-xs text-slate-400 font-mono">{s.staff?.employeeId ?? ''}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">{s.staff?.department ?? '—'}</td>
                <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">{formatCents(s.basicCents)}</td>
                <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">{formatCents(s.allowancesCents)}</td>
                <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">{formatCents(s.deductionsCents)}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-800 whitespace-nowrap">{formatCents(s.netCents)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{s.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
          {data && data.rows.length > 0 && (
            <tfoot className="bg-slate-50 border-t-2 border-slate-200 font-semibold text-slate-800">
              <tr>
                <td className="px-4 py-3" colSpan={2}>Grand Total</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{formatCents(data.grandTotal.basicCents)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{formatCents(data.grandTotal.allowancesCents)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{formatCents(data.grandTotal.deductionsCents)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{formatCents(data.grandTotal.netCents)}</td>
                <td className="px-4 py-3"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {departments.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto print:border-0 print:shadow-none">
          <div className="px-4 py-3 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">Department Totals</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Department</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Basic</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Allowances</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Deductions</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {departments.map((d) => {
                const t = data!.departmentTotals[d];
                return (
                  <tr key={d} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700">{d}</td>
                    <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">{formatCents(t.basicCents)}</td>
                    <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">{formatCents(t.allowancesCents)}</td>
                    <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">{formatCents(t.deductionsCents)}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800 whitespace-nowrap">{formatCents(t.netCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'attendance' | 'payroll';

export default function HRReportsPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [tab, setTab] = useState<Tab>('attendance');

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6 print:p-0">
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 1.5cm; } }`}</style>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">HR Reports</h1>
          <p className="text-sm text-slate-500 mt-0.5 no-print">Attendance and payroll summaries — {MONTHS[month - 1]} {year}</p>
          <p className="text-sm text-slate-500 mt-0.5 hidden print:block">{tab === 'attendance' ? 'Attendance' : 'Payroll'} Report — {MONTHS[month - 1]} {year}</p>
        </div>
        <div className="flex items-center gap-2 no-print">
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            <Printer size={16} /> Print
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-5 border-b border-slate-200 no-print">
        <button onClick={() => setTab('attendance')} className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'attendance' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}><FileBarChart size={15} /> Attendance</button>
        <button onClick={() => setTab('payroll')} className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'payroll' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}><FileBarChart size={15} /> Payroll</button>
      </div>

      {tab === 'attendance' ? <AttendanceReport month={month} year={year} /> : <PayrollReport month={month} year={year} />}
    </div>
  );
}
