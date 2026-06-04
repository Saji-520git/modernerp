import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Plus, Search } from 'lucide-react';

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  onAddNew?: () => void;
  addNewLabel?: string;
  className?: string;
}

/**
 * Lightweight searchable dropdown (combobox) — native-select replacement.
 *
 * Renders the open list as `position: absolute; z-50` inside a
 * `position: relative` wrapper so it is NOT clipped inside table rows.
 */
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  onAddNew,
  addNewLabel = 'Add New',
  className = '',
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? '',
    [options, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus the search box when opening
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const choose = (val: string) => {
    onChange(val);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    } else if (e.key === 'Enter') {
      e.preventDefault(); // avoid submitting the surrounding form
      if (filtered.length > 0) choose(filtered[0].value);
    }
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60 disabled:cursor-not-allowed bg-white"
      >
        <span className={selectedLabel ? 'text-slate-700 truncate' : 'text-slate-400 truncate'}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-slate-100">
            <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-2 py-1.5">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search…"
                className="w-full text-sm focus:outline-none bg-transparent"
              />
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-400">No results found</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => choose(o.value)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 transition ${
                    o.value === value ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-700'
                  }`}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>

          {onAddNew && (
            <div className="border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setQuery('');
                  onAddNew();
                }}
                className="w-full flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-50 transition"
              >
                <Plus className="w-4 h-4" /> {addNewLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
