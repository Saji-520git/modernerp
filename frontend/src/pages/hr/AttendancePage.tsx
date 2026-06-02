import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Save, Users } from 'lucide-react';
import { hrService } from '../../services/hrService';
import type { AttendanceStatus, MarkAttendanceDto } from '../../types/hr';

const STATUSES: AttendanceStatus[] = ['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE'];

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  PRESENT: 'Present', ABSENT: 'Absent', LATE: 'Late', HALF_DAY: 'Half Day', LEAVE: 'Leave',
};

const STATUS_BTN: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-green-600 text-white border-green-600',
  ABSENT:  'bg-red-600 text-white border-red-600',
  LATE:    'bg-amber-500 text-white border-amber-500',
  HALF_DAY:'bg-blue-600 text-white border-blue-600',
  LEAVE:   'bg-slate-500 text-white border-slate-500',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ─── Daily View ───────────────────────────────────────────────────────────────

function DailyView() {
  const qc = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [saved, setSaved] = useState(false);

  const { data: staff, isLoading } = useQuery({
    queryKey: ['staff', { isActive: true }],
    queryFn:  () => hrService.getAllStaff({ isActive: true }),
  });

  // Default everyone to PRESENT whenever the staff list or date changes.
  useEffect(() => {
    if (!staff) return;
    const next: Record<string, AttendanceStatus> = {};
    for (const s of staff) next[s.id] = 'PRESENT';
    setMarks(next);
    setSaved(false);
  }, [staff, date]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const records: MarkAttendanceDto[] = (staff ?? []).map((s) => ({
        staffId: s.id,
        date,
        status: marks[s.id] ?? 'PRESENT',
      }));
      return hrService.bulkMarkAttendance(date, records);
    },
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
  });

  const setAll = (status: AttendanceStatus) => {
    if (!staff) return;
    const next: Record<string, AttendanceStatus> = {};
    for (const s of staff) next[s.id] = status;
    setMarks(next);
    setSaved(false);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
        </div>
        <div className="flex items-end gap-2 ml-auto">
          <button onClick={() => setAll('PRESENT')} className="px-3 py-2 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Mark all Present</button>
          <button onClick={() => setAll('ABSENT')} className="px-3 py-2 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Mark all Absent</button>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !staff?.length} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
            <Save size={16} /> {saveMutation.isPending ? 'Saving…' : 'Save Attendance'}
          </button>
        </div>
      </div>

      {saved && <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">Attendance saved for {date}.</div>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Employee</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Department</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={3} className="text-center py-12 text-slate-400">Loading…</td></tr>}
            {!isLoading && (staff?.length ?? 0) === 0 && (
              <tr><td colSpan={3} className="px-4 py-12 text-center">
                <Users size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 font-medium">No active staff</p>
              </td></tr>
            )}
            {(staff ?? []).map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{s.fullName}</div>
                  <div className="text-xs text-slate-400 font-mono">{s.employeeId}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">{s.department ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {STATUSES.map((st) => {
                      const active = (marks[s.id] ?? 'PRESENT') === st;
                      return (
                        <button
                          key={st}
                          onClick={() => { setMarks((m) => ({ ...m, [s.id]: st })); setSaved(false); }}
                          className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${active ? STATUS_BTN[st] : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                        >
                          {STATUS_LABELS[st]}
                        </button>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Monthly Summary ──────────────────────────────────────────────────────────

function MonthlySummary() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['attendance', 'summary', month, year],
    queryFn:  () => hrService.getAttendanceSummary(month, year),
  });

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Employee</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Department</th>
              <th className="text-center px-4 py-3 font-medium text-green-600 text-xs uppercase tracking-wide">Present</th>
              <th className="text-center px-4 py-3 font-medium text-amber-600 text-xs uppercase tracking-wide">Late</th>
              <th className="text-center px-4 py-3 font-medium text-blue-600 text-xs uppercase tracking-wide">Half Day</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Leave</th>
              <th className="text-center px-4 py-3 font-medium text-red-600 text-xs uppercase tracking-wide">Absent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={7} className="text-center py-12 text-slate-400">Loading…</td></tr>}
            {!isLoading && (data?.length ?? 0) === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center">
                <CalendarCheck size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 font-medium">No attendance records</p>
                <p className="text-slate-400 text-xs mt-1">for {MONTHS[month - 1]} {year}</p>
              </td></tr>
            )}
            {(data ?? []).map((r) => (
              <tr key={r.staffId} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{r.fullName}</div>
                  <div className="text-xs text-slate-400 font-mono">{r.employeeId}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">{r.department ?? '—'}</td>
                <td className="px-4 py-3 text-center font-medium text-green-700">{r.present}</td>
                <td className="px-4 py-3 text-center text-amber-700">{r.late}</td>
                <td className="px-4 py-3 text-center text-blue-700">{r.halfDay}</td>
                <td className="px-4 py-3 text-center text-slate-600">{r.leave}</td>
                <td className="px-4 py-3 text-center font-medium text-red-700">{r.absent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'daily' | 'summary';

export default function AttendancePage() {
  const [tab, setTab] = useState<Tab>('daily');

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Attendance</h1>
        <p className="text-sm text-slate-500 mt-0.5">Mark daily attendance and review monthly summaries</p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-slate-200">
        <button onClick={() => setTab('daily')} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'daily' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Daily View</button>
        <button onClick={() => setTab('summary')} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === 'summary' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>Monthly Summary</button>
      </div>

      {tab === 'daily' ? <DailyView /> : <MonthlySummary />}
    </div>
  );
}
