import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, RotateCcw, X, Loader2 } from 'lucide-react';
import { resetDb } from './db';

/**
 * The always-visible "this is a demo" marker, plus the reset control.
 *
 * Rendered from App.tsx behind the same build flag as the adapter, so it cannot
 * appear in a real install. Fixed to the viewport rather than placed in the page
 * flow so it survives the POS's fullscreen mode, where the app shell and all of
 * its chrome are hidden.
 *
 * Styled with the raw slate palette the rest of the app uses, not the semantic
 * tokens — those exist but almost nothing has adopted them yet.
 */
export default function DemoBadge() {
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const queryClient = useQueryClient();

  async function handleReset() {
    setResetting(true);
    resetDb();
    // Every screen reads through TanStack Query, so clearing the cache is what
    // actually puts the re-seeded shop on screen. A reload would do it too, but
    // would also throw away where the visitor was.
    await queryClient.invalidateQueries();
    setResetting(false);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="This is a demo — tap for options"
        className="fixed z-[100] bottom-3 right-3 flex items-center gap-1.5 rounded-full
                   bg-amber-500 px-3 py-2 text-[11px] font-bold uppercase tracking-wide
                   text-white shadow-lg shadow-amber-500/30 transition hover:bg-amber-600
                   active:scale-95 sm:bottom-4 sm:right-4 sm:text-xs"
      >
        <FlaskConical size={14} />
        Demo
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[101] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
                  <FlaskConical size={18} />
                </span>
                <div>
                  <h2 className="text-base font-bold text-slate-800">Demonstration mode</h2>
                  <p className="text-xs text-slate-500">Nothing here is real data</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 text-sm text-slate-600">
              <p>
                This is the full ModernERP interface running entirely in your browser.
                Every product, customer and figure is invented for the demonstration.
              </p>
              <p>
                Anything you do — ringing up a sale, editing a product, taking a payment —
                is saved on <strong className="font-semibold text-slate-800">this device only</strong>,
                and is never sent anywhere.
              </p>
            </div>

            <button
              type="button"
              onClick={handleReset}
              disabled={resetting}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border
                         border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700
                         transition hover:bg-slate-100 disabled:opacity-60"
            >
              {resetting ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
              {resetting ? 'Resetting…' : 'Reset demo data'}
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-400">
              Puts the shop back exactly as it started.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
