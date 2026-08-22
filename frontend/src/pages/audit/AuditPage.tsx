import { useState, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, ChevronDown, ChevronRight, ShieldCheck, RefreshCw } from 'lucide-react';
import { auditApi, actionTone, type AuditEntry } from '../../services/audit';

// ─── Audit trail ──────────────────────────────────────────────────────────────
//
// Read-only, deliberately. There is no edit and no delete here, and none should
// be added: a trail that can be changed from inside the app answers no question
// worth asking. The API exposes no write either — this is not merely a UI
// omission.

function timeOf(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function Row({ e }: { e: AuditEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetail = e.meta != null && Object.keys(e.meta as object).length > 0;

  return (
    <Fragment>
      <tr className="border-b border-slate-100 hover:bg-slate-50">
        <td className="px-2 py-2.5 align-top">
          {hasDetail && (
            <button onClick={() => setOpen((o) => !o)} className="text-slate-400 hover:text-slate-600">
              {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          )}
        </td>
        <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap align-top">{timeOf(e.at)}</td>
        <td className="px-3 py-2.5 align-top">
          <div className="text-sm font-medium text-slate-800">{e.userName}</div>
          <div className="text-xs text-slate-400">{e.userRole}</div>
        </td>
        <td className="px-3 py-2.5 align-top">
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${actionTone(e.action)}`}>
            {e.action}
          </span>
        </td>
        <td className="px-3 py-2.5 text-sm text-slate-700 align-top">{e.entity}</td>
        <td className="px-3 py-2.5 align-top">
          <div className="text-xs font-mono text-slate-500 break-all">{e.path}</div>
          {e.entityId && <div className="text-[11px] font-mono text-slate-400 break-all">{e.entityId}</div>}
        </td>
        <td className="px-3 py-2.5 text-right align-top">
          {/* A recorded 5xx means the request failed after possibly writing —
              worth seeing at a glance, which is why it is kept at all. */}
          <span className={`text-xs font-semibold ${e.status >= 500 ? 'text-red-600' : 'text-slate-400'}`}>
            {e.status}
          </span>
        </td>
      </tr>
      {open && hasDetail && (
        <tr className="bg-slate-50 border-b border-slate-100">
          <td colSpan={7} className="px-6 py-3">
            <pre className="text-[11px] text-slate-600 whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
              {JSON.stringify(e.meta, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export default function AuditPage() {
  const [search, setSearch]   = useState('');
  const [entity, setEntity]   = useState('');
  const [action, setAction]   = useState('');
  const [userId, setUserId]   = useState('');
  const [page,   setPage]     = useState(1);
  const pageSize = 50;

  const { data: facets } = useQuery({ queryKey: ['audit-facets'], queryFn: auditApi.facets });

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['audit', search, entity, action, userId, page],
    queryFn: () => auditApi.list({
      search: search || undefined,
      entity: entity || undefined,
      action: action || undefined,
      userId: userId || undefined,
      page, pageSize,
    }),
  });

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const reset = () => { setSearch(''); setEntity(''); setAction(''); setUserId(''); setPage(1); };

  const sel = 'border border-slate-200 rounded-lg px-2.5 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200';

  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck size={18} className="text-slate-500" />
        <h1 className="text-xl font-bold text-slate-800">Audit Trail</h1>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        Every change made through the system — who made it, when, and what they sent.
        Records cannot be edited or removed.
      </p>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search user, record or path…"
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>

          <select value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }} className={sel}>
            <option value="">All users</option>
            {facets?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>

          <select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} className={sel}>
            <option value="">All areas</option>
            {facets?.entities.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>

          <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className={sel}>
            <option value="">All actions</option>
            {facets?.actions.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>

          <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-700 px-2">Clear</button>
          <button
            onClick={() => refetch()}
            className="p-2 text-slate-400 hover:text-slate-600"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="px-2 py-2 w-8" />
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Area</th>
                <th className="px-3 py-2 font-medium">Record</th>
                <th className="px-3 py-2 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {data?.data.map((e) => <Row key={e.id} e={e} />)}
            </tbody>
          </table>

          {data && data.data.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm font-medium text-slate-500">Nothing recorded yet</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Entries appear as soon as someone changes something.
              </p>
            </div>
          )}
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-sm text-slate-500">
              <span className="font-semibold text-slate-700">{total.toLocaleString()}</span>{' '}
              {total === 1 ? 'entry' : 'entries'}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-sm text-slate-500">{page} / {pages}</span>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
