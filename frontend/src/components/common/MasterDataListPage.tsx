import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';

interface MasterDataItem {
  id: string;
  name: string;
  _count?: { products: number };
}

interface Props {
  title: string;
  singularLabel: string;
  queryKey: string;
  apiList: () => Promise<MasterDataItem[]>;
  apiCreate: (name: string) => Promise<MasterDataItem>;
  apiUpdate: (id: string, name: string) => Promise<MasterDataItem>;
  apiDelete: (id: string) => Promise<unknown>;
}

export default function MasterDataListPage({
  title, singularLabel, queryKey,
  apiList, apiCreate, apiUpdate, apiDelete,
}: Props) {
  const qc = useQueryClient();

  const { data: items = [], isLoading } = useQuery<MasterDataItem[]>({
    queryKey: [queryKey],
    queryFn: apiList,
  });

  const [search,      setSearch]      = useState('');
  const [editId,      setEditId]      = useState<string | null>(null);
  const [editName,    setEditName]    = useState('');
  const [showCreate,  setShowCreate]  = useState(false);
  const [createName,  setCreateName]  = useState('');
  const [err,         setErr]         = useState('');

  const invalidate = () => qc.invalidateQueries({ queryKey: [queryKey] });

  const createMut = useMutation({
    mutationFn: () => apiCreate(createName.trim()),
    onSuccess: () => { invalidate(); setShowCreate(false); setCreateName(''); setErr(''); },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? (e as { message?: string })?.message ?? 'Failed to create';
      setErr(msg);
    },
  });

  const updateMut = useMutation({
    mutationFn: () => apiUpdate(editId!, editName.trim()),
    onSuccess: () => { invalidate(); setEditId(null); setEditName(''); setErr(''); },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? (e as { message?: string })?.message ?? 'Failed to update';
      setErr(msg);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiDelete(id),
    onSuccess: () => { invalidate(); setErr(''); },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? (e as { message?: string })?.message ?? 'Failed to delete';
      setErr(msg);
    },
  });

  const filtered = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-800">{title}</h1>
        <button
          onClick={() => { setShowCreate(true); setErr(''); setCreateName(''); }}
          className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition"
        >
          <Plus size={15} /> New {singularLabel}
        </button>
      </div>

      {/* Error banner */}
      {err && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {err}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Add New {singularLabel}</h3>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>
            <input
              autoFocus
              type="text"
              placeholder={`${singularLabel} name`}
              value={createName}
              onChange={e => setCreateName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && createName.trim()) createMut.mutate(); }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400 mb-4"
            />
            {err && <p className="text-xs text-red-600 mb-3">{err}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCreate(false)} className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
                Cancel
              </button>
              <button
                onClick={() => createMut.mutate()}
                disabled={!createName.trim() || createMut.isPending}
                className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {createMut.isPending ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <input
        type="text"
        placeholder={`Search ${title.toLowerCase()}…`}
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm mb-4 outline-none focus:border-indigo-400"
      />

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-right">Products</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">No {title.toLowerCase()} found</td></tr>
            ) : filtered.map(item => (
              <tr key={item.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                <td className="px-4 py-3">
                  {editId === item.id ? (
                    <input
                      autoFocus
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && editName.trim()) updateMut.mutate();
                        if (e.key === 'Escape') { setEditId(null); setErr(''); }
                      }}
                      className="border border-indigo-300 rounded px-2 py-1 text-sm outline-none w-full max-w-xs"
                    />
                  ) : (
                    <span className="font-medium text-slate-800">{item.name}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-400 text-xs">
                  {item._count?.products ?? 0}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {editId === item.id ? (
                      <>
                        <button
                          onClick={() => updateMut.mutate()}
                          disabled={!editName.trim() || updateMut.isPending}
                          className="p-1.5 rounded-lg bg-green-50 text-green-600 hover:bg-green-100 transition disabled:opacity-50"
                          title="Save"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          onClick={() => { setEditId(null); setErr(''); }}
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition"
                          title="Cancel"
                        >
                          <X size={13} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => { setEditId(item.id); setEditName(item.name); setErr(''); }}
                          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
                          title="Edit"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => {
                            if (!window.confirm(`Delete "${item.name}"?`)) return;
                            deleteMut.mutate(item.id);
                          }}
                          disabled={deleteMut.isPending}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition disabled:opacity-50"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
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
