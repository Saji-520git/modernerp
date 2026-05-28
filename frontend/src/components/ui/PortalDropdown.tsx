import { useState, useRef, useEffect, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface DropdownItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}

interface PortalDropdownProps {
  items: DropdownItem[];
  width?: number;
  align?: 'left' | 'right';
}

export function PortalDropdown({
  items,
  width = 192,
  align = 'right',
}: PortalDropdownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState({ top: 0, left: 0 });
  const btnRef  = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const place = () => {
      const b = btnRef.current;
      const m = menuRef.current;
      if (!b) return;
      const r  = b.getBoundingClientRect();
      const mh = m?.offsetHeight ?? 160;
      const top =
        window.innerHeight - r.bottom >= mh + 8
          ? r.bottom + 4
          : r.top - mh - 4;
      const left = align === 'right' ? r.right - width : r.left;
      setPos({
        top:  Math.max(8, top),
        left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      });
    };

    place();
    requestAnimationFrame(place);

    const onScroll   = () => place();
    const onResize   = () => place();
    const onOutside  = (e: MouseEvent) => {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, align, width]);

  const visible = items.filter(i => !i.hidden);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap"
      >
        Actions
        <ChevronDown size={12} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width, zIndex: 9999 }}
          className="bg-white rounded-lg shadow-xl border border-slate-200 py-1 text-sm"
        >
          {visible.map(item => (
            <button
              key={item.label}
              onClick={() => { setOpen(false); item.onClick(); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors ${
                item.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
