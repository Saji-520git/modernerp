import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, CalendarOff, Check, Ban } from 'lucide-react';
import { hrService } from '../../services/hrService';
import type { Leave, LeaveType, ApplyLeaveDto } from '../../types/hr';

const LEAVE_TYPES: LeaveType[] = ['ANNUAL', 'SICK', 'CASUAL', 'MATERNITY', 'UNPAID', 'OTHER'];

const TYPE_LABELS: Record<string, string> = {
  ANNUAL: 'Annual', SICK: 'Sick', CASUAL: 'Casual', MATERNITY: 'Maternity', UNPAID: 'Unpaid', OTHER: 'Other',
};

const STATUS_STYLE: Record<string, string> = {
  PENDING:  'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};

const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

// ─── New Leave Modal ──────────────────────────────────────────────────────────

function LeaveModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [staffId, setStaffId] = useState('');
  const [leaveType, setLeaveType] = useState<LeaveType>('ANNUAL');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const { data: staff } = useQuery({
    queryKey: ['staff', { isActive: true }],
    queryFn:  () => hrService.getAllStaff({ isActive: true }),
  });

  const mutation = useMutation({
    mutationFn: (body: ApplyLeaveDto) => hrService.applyLeave(body),
    onSuccess: onSaved,
    onError: (err: unknown) => setError((err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to apply'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!staffId) { setError('Please select a staff member.'); return; }
    mutation.mutate({ staffId, leaveType, startDate, endDate, reason: reason || null });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">New Leave Request</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Staff *</label>
            <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={inputCls}>
              <option value="">— Select staff —</option>
              {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.employeeId})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Leave Type</label>
            <select value={leaveType} onChange={(e) => setLeaveType(e.target.value as LeaveType)} className={inputCls}>
              {LEAVE_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Start Date *</label>
              <input required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">End Date *</label>
              <input required type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Reason</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={mutation.isPending} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
              {mutation.isPending ? 'Saving…' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type StatusTab = 'all' | 'PENDING' | 'APPROVED' | 'REJECTED';

export default function LeavePage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<StatusTab>('PENDING');
  const [showModal, setShowModal] = useState(false);

  const { data: leaves, isLoading } = useQuery({
    queryKey: ['leave', tab],
    queryFn:  () => hrService.getLeaves(tab === 'all' ? undefined : { status: tab }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['leave'] });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      hrService.updateLeaveStatus(id, status),
    onSuccess: invalidate,
  });

  const tabs: { key: StatusTab; label: string }[] = [
    { key: 'PENDING', label: 'Pending' },
    { key: 'APPROVED', label: 'Approved' },
    { key: 'REJECTED', label: 'Rejected' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Leave</h1>
          <p className="text-sm text-slate-500 mt-0.5">Review and manage staff leave requests</p>
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus size={16} /> New Leave
        </button>
      </div>

      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{t.label}</button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Employee</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Type</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Period</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Days</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Reason</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Status</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={7} className="text-center py-12 text-slate-400">Loading…</td></tr>}
            {!isLoading && (leaves?.length ?? 0) === 0 && (
              <tr><td colSpan={7} className="px-4 py-12 text-center">
                <CalendarOff size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 font-medium">No leave requests</p>
              </td></tr>
            )}
            {(leaves ?? []).map((l: Leave) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{l.staff?.fullName ?? '—'}</div>
                  <div className="text-xs text-slate-400 font-mono">{l.staff?.employeeId ?? ''}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">{TYPE_LABELS[l.leaveType] ?? l.leaveType}</td>
                <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{l.startDate.slice(0, 10)} → {l.endDate.slice(0, 10)}</td>
                <td className="px-4 py-3 text-center font-medium text-slate-800">{l.days}</td>
                <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate" title={l.reason ?? ''}>{l.reason ?? '—'}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[l.status] ?? 'bg-slate-100 text-slate-500'}`}>{l.status}</span>
                </td>
                <td className="px-4 py-3">
                  {l.status === 'PENDING' ? (
                    <div className="flex items-center justify-center gap-1.5">
                      <button onClick={() => statusMutation.mutate({ id: l.id, status: 'APPROVED' })} disabled={statusMutation.isPending} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"><Check size={13} /> Approve</button>
                      <button onClick={() => statusMutation.mutate({ id: l.id, status: 'REJECTED' })} disabled={statusMutation.isPending} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"><Ban size={13} /> Reject</button>
                    </div>
                  ) : (
                    <div className="text-center text-xs text-slate-400">{l.approvedAt ? l.approvedAt.slice(0, 10) : '—'}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <LeaveModal onClose={() => setShowModal(false)} onSaved={() => { invalidate(); setShowModal(false); }} />
      )}
    </div>
  );
}
