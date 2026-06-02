import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Pencil, Trash2, Eye, X, Users } from 'lucide-react';
import { hrService, formatCents, rupeesToCents, centsToRupees } from '../../services/hrService';
import { usersApi } from '../../services/users';
import type { Staff, CreateStaffDto } from '../../types/hr';

const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'DAILY'];
const SALARY_TYPES = ['MONTHLY', 'DAILY', 'HOURLY'];

const TYPE_LABELS: Record<string, string> = {
  FULL_TIME: 'Full Time', PART_TIME: 'Part Time', CONTRACT: 'Contract', DAILY: 'Daily',
  MONTHLY: 'Monthly', HOURLY: 'Hourly',
};

const inputCls = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

// ─── Staff Modal ──────────────────────────────────────────────────────────────

function StaffModal({
  title, initial, onSave, onClose, loading, error,
}: {
  title: string;
  initial?: Staff;
  onSave: (body: CreateStaffDto) => void;
  onClose: () => void;
  loading: boolean;
  error: string;
}) {
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName]   = useState(initial?.lastName ?? '');
  const [phone, setPhone]         = useState(initial?.phone ?? '');
  const [email, setEmail]         = useState(initial?.email ?? '');
  const [address, setAddress]     = useState(initial?.address ?? '');
  const [designation, setDesignation] = useState(initial?.designation ?? '');
  const [department, setDepartment]   = useState(initial?.department ?? '');
  const [employmentType, setEmploymentType] = useState(initial?.employmentType ?? 'FULL_TIME');
  const [joinDate, setJoinDate]   = useState(initial?.joinDate ? initial.joinDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [salaryType, setSalaryType] = useState(initial?.salaryType ?? 'MONTHLY');
  const [basicSalary, setBasicSalary] = useState(initial ? centsToRupees(initial.basicSalaryCents) : '');
  const [userId, setUserId] = useState(initial?.userId ?? '');

  const { data: usersResp } = useQuery({
    queryKey: ['users', 'for-staff-link'],
    queryFn:  () => usersApi.list({ pageSize: 200, isActive: true }),
    staleTime: 60_000,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      firstName, lastName,
      phone: phone || null,
      email: email || null,
      address: address || null,
      designation: designation || null,
      department: department || null,
      employmentType,
      joinDate,
      salaryType,
      basicSalaryCents: rupeesToCents(basicSalary || '0'),
      userId: userId || null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

          {/* Personal Info */}
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Personal Info</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">First Name *</label>
                <input required value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Last Name *</label>
                <input required value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="+94 77 000 0000" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="staff@example.com" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">Address</label>
                <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className={`${inputCls} resize-none`} />
              </div>
            </div>
          </section>

          {/* Employment */}
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Employment</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Designation</label>
                <input value={designation} onChange={(e) => setDesignation(e.target.value)} className={inputCls} placeholder="e.g. Cashier" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Department</label>
                <input value={department} onChange={(e) => setDepartment(e.target.value)} className={inputCls} placeholder="e.g. Sales" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Employment Type</label>
                <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} className={inputCls}>
                  {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Join Date *</label>
                <input required type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} className={inputCls} />
              </div>
            </div>
          </section>

          {/* Salary */}
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Salary</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Salary Type</label>
                <select value={salaryType} onChange={(e) => setSalaryType(e.target.value)} className={inputCls}>
                  {SALARY_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Basic Salary (Rs.)</label>
                <input type="number" min="0" step="0.01" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} className={inputCls} placeholder="0.00" />
              </div>
            </div>
          </section>

          {/* System Access */}
          <section>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">System Access (optional)</h3>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Link to User Account</label>
              <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls}>
                <option value="">— Not linked —</option>
                {(usersResp?.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">If linked, this staff member maps to a login account for POS shifts.</p>
            </div>
          </section>

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
              {loading ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Staff Detail Panel ─────────────────────────────────────────────────────

function StaffDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['staff', id],
    queryFn:  () => hrService.getStaffById(id),
  });

  const now = new Date();
  const monthAttendance = useMemo(() => {
    if (!data) return { present: 0, absent: 0, late: 0 };
    const m = now.getUTCMonth(); const y = now.getUTCFullYear();
    let present = 0, absent = 0, late = 0;
    for (const a of data.attendances) {
      const d = new Date(a.date);
      if (d.getUTCMonth() === m && d.getUTCFullYear() === y) {
        if (a.status === 'PRESENT') present++;
        else if (a.status === 'ABSENT') absent++;
        else if (a.status === 'LATE') late++;
      }
    }
    return { present, absent, late };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-end z-50">
      <div className="bg-white w-full max-w-md h-full shadow-xl overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
          <h2 className="text-base font-semibold text-slate-800">Staff Details</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        {isLoading || !data ? (
          <div className="p-8 text-center text-slate-400 text-sm">Loading…</div>
        ) : (
          <div className="p-6 space-y-6">
            <div>
              <p className="text-lg font-bold text-slate-800">{data.fullName}</p>
              <p className="text-sm text-slate-500">{data.employeeId} · {data.designation ?? '—'}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-slate-400 text-xs block">Department</span>{data.department ?? '—'}</div>
              <div><span className="text-slate-400 text-xs block">Type</span>{TYPE_LABELS[data.employmentType] ?? data.employmentType}</div>
              <div><span className="text-slate-400 text-xs block">Phone</span>{data.phone ?? '—'}</div>
              <div><span className="text-slate-400 text-xs block">Email</span>{data.email ?? '—'}</div>
              <div><span className="text-slate-400 text-xs block">Join Date</span>{data.joinDate.slice(0, 10)}</div>
              <div><span className="text-slate-400 text-xs block">Basic Salary</span>{formatCents(data.basicSalaryCents)}</div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">This Month Attendance</h3>
              <div className="flex gap-3">
                <div className="flex-1 bg-green-50 rounded-lg p-3 text-center"><p className="text-lg font-bold text-green-700">{monthAttendance.present}</p><p className="text-xs text-green-600">Present</p></div>
                <div className="flex-1 bg-amber-50 rounded-lg p-3 text-center"><p className="text-lg font-bold text-amber-700">{monthAttendance.late}</p><p className="text-xs text-amber-600">Late</p></div>
                <div className="flex-1 bg-red-50 rounded-lg p-3 text-center"><p className="text-lg font-bold text-red-700">{monthAttendance.absent}</p><p className="text-xs text-red-600">Absent</p></div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Recent Salary</h3>
              {data.salaries.length === 0 ? <p className="text-sm text-slate-400">No salary records.</p> : (
                <div className="space-y-1.5">
                  {data.salaries.slice(0, 3).map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-1.5">
                      <span className="text-slate-600">{s.month}/{s.year}</span>
                      <span className="font-medium text-slate-800">{formatCents(s.netCents)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{s.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Pending Leaves</h3>
              {data.leaves.filter((l) => l.status === 'PENDING').length === 0 ? <p className="text-sm text-slate-400">No pending leaves.</p> : (
                <div className="space-y-1.5">
                  {data.leaves.filter((l) => l.status === 'PENDING').map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-1.5">
                      <span className="text-slate-600">{l.leaveType}</span>
                      <span className="text-slate-500 text-xs">{l.startDate.slice(0, 10)} → {l.endDate.slice(0, 10)}</span>
                      <span className="font-medium">{l.days}d</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'inactive';

export default function StaffPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [deptFilter, setDeptFilter] = useState('');
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; item: Staff } | null>(null);
  const [modalError, setModalError] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const filters = {
    isActive: statusFilter === 'all' ? undefined : statusFilter === 'active',
    department: deptFilter || undefined,
    search: search || undefined,
  };

  const { data: staff, isLoading } = useQuery({
    queryKey: ['staff', filters],
    queryFn:  () => hrService.getAllStaff(filters),
  });

  const departments = useMemo(() => {
    const set = new Set<string>();
    (staff ?? []).forEach((s) => { if (s.department) set.add(s.department); });
    return Array.from(set).sort();
  }, [staff]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['staff'] });

  const createMutation = useMutation({
    mutationFn: hrService.createStaff,
    onSuccess: () => { invalidate(); setModal(null); setModalError(''); },
    onError: (err: unknown) => setModalError((err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.error ?? 'Failed to save'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreateStaffDto }) => hrService.updateStaff(id, body),
    onSuccess: () => { invalidate(); setModal(null); setModalError(''); },
    onError: (err: unknown) => setModalError((err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.error ?? 'Failed to save'),
  });

  const deleteMutation = useMutation({ mutationFn: hrService.deleteStaff, onSuccess: invalidate });

  const handleSave = (body: CreateStaffDto) => {
    setModalError('');
    if (modal?.mode === 'create') createMutation.mutate(body);
    else if (modal?.mode === 'edit') updateMutation.mutate({ id: modal.item.id, body });
  };

  const handleDelete = (item: Staff) => {
    if (window.confirm(`Delete ${item.fullName}? This deactivates the record.`)) deleteMutation.mutate(item.id);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Staff</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage employees, salaries and system access</p>
        </div>
        <button onClick={() => { setModal({ mode: 'create' }); setModalError(''); }} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus size={16} /> Add Staff
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" placeholder="Search by name, ID or phone…" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
          <option value="">All Departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Employee ID</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Full Name</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Designation</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Department</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Type</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Basic Salary</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Status</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={8} className="text-center py-12 text-slate-400">Loading…</td></tr>}
            {!isLoading && (staff?.length ?? 0) === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center">
                <Users size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 font-medium">No staff found</p>
                <p className="text-slate-400 text-xs mt-1">Add your first employee to get started</p>
              </td></tr>
            )}
            {(staff ?? []).map((item) => (
              <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${!item.isActive ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.employeeId}</td>
                <td className="px-4 py-3">
                  <button onClick={() => setDetailId(item.id)} className="font-medium text-slate-800 hover:text-blue-600 hover:underline text-left">{item.fullName}</button>
                  <div className="text-xs text-slate-400 mt-0.5">{item.phone ?? '—'}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">{item.designation ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{item.department ?? '—'}</td>
                <td className="px-4 py-3 text-slate-600">{TYPE_LABELS[item.employmentType] ?? item.employmentType}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-800 whitespace-nowrap">{formatCents(item.basicSalaryCents)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{item.isActive ? 'Active' : 'Inactive'}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => setDetailId(item.id)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-blue-600" title="View"><Eye size={14} /></button>
                    <button onClick={() => { setModal({ mode: 'edit', item }); setModalError(''); }} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600" title="Edit"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(item)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-600" title="Delete"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <StaffModal
          title={modal.mode === 'create' ? 'New Staff' : 'Edit Staff'}
          initial={modal.mode === 'edit' ? modal.item : undefined}
          onSave={handleSave}
          onClose={() => setModal(null)}
          loading={isSaving}
          error={modalError}
        />
      )}

      {detailId && <StaffDetailPanel id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
