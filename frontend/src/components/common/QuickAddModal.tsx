import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  label: string;
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<{ id: string; name: string }>;
  onCreated: (newItem: { id: string; name: string }) => void;
}

export default function QuickAddModal({ label, isOpen, onClose, onCreate, onCreated }: Props) {
  const [name,    setName]    = useState('');
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState('');

  if (!isOpen) return null;

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLoading(true);
    setErr('');
    try {
      const result = await onCreate(trimmed);
      onCreated(result);
      setName('');
      onClose();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? (e as { message?: string })?.message ?? 'Failed to create';
      setErr(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-6 w-80">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-800">Add New {label}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>
        <input
          autoFocus
          type="text"
          placeholder={`${label} name`}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) handleAdd(); if (e.key === 'Escape') onClose(); }}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400 mb-3"
        />
        {err && <p className="text-xs text-red-600 mb-3">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!name.trim() || loading}
            className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
