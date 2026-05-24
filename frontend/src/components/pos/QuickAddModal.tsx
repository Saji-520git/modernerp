import { useState, useRef, useEffect } from 'react';
import { X, Zap } from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { categoriesApi, unitsApi } from '../../services/masterData';
import { productsApi, type Product } from '../../services/products';

interface Props {
  barcode: string;
  onSuccess: (product: Product) => void;
  onCancel: () => void;
}

export default function QuickAddModal({ barcode, onSuccess, onCancel }: Props) {
  const [name, setName]             = useState('');
  const [price, setPrice]           = useState('');
  const [unitId, setUnitId]         = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [error, setError]           = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  const { data: units = [] } = useQuery({
    queryKey: ['master-units'],
    queryFn: unitsApi.list,
    staleTime: 5 * 60_000,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.list,
    staleTime: 5 * 60_000,
  });

  // Default to first unit once loaded
  useEffect(() => {
    if (units.length > 0 && !unitId) setUnitId(units[0].id);
  }, [units, unitId]);

  // Auto-focus name field
  useEffect(() => {
    setTimeout(() => nameRef.current?.focus(), 60);
  }, []);

  // Escape → cancel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onCancel]);

  const mutation = useMutation({
    mutationFn: () =>
      productsApi.create({
        name: name.trim(),
        barcode: barcode || null,
        priceCents: Math.round(parseFloat(price) * 100),
        costCents: 0,
        unitId,
        categoryId: categoryId || null,
        taxPercent: 0,
        reorderLevel: 0,
        isActive: true,
      }),
    onSuccess: (product) => {
      onSuccess(product);
    },
    onError: (err: unknown) => {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
          ?? 'Failed to create product',
      );
    },
  });

  function handleSubmit() {
    setError('');
    if (!name.trim()) { setError('Product name is required'); return; }
    const p = parseFloat(price);
    if (isNaN(p) || p <= 0) { setError('Selling price must be greater than 0'); return; }
    if (!unitId) { setError('Please select a unit'); return; }
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Zap size={14} className="text-indigo-600" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">New Product</h3>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 transition">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">

          {/* Barcode (read-only display) */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Barcode</label>
            <div className="px-3 py-2 bg-slate-100 rounded-lg font-mono text-sm text-slate-700 select-all tracking-wider">
              {barcode}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Product Name <span className="text-red-500">*</span>
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="e.g. Cola Can 330ml"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          {/* Price + Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Selling Price <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">Rs.</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
                  placeholder="0.00"
                  className="w-full pl-8 border border-slate-200 rounded-lg py-2 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Unit</label>
              <select
                value={unitId}
                onChange={e => setUnitId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {units.map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.shortCode})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Category <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <select
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="">— None —</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <p className="text-xs text-slate-400 flex items-start gap-1.5">
            <span className="shrink-0 text-slate-300">ℹ</span>
            Complete cost, reorder level and other details later in the Products page.
          </p>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="flex-1 px-3 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition flex items-center justify-center gap-1.5"
          >
            {mutation.isPending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Adding…
              </>
            ) : (
              '✓ Add & Sell'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
