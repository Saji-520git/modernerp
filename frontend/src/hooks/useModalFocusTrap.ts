import { useEffect } from 'react';

// ─── Global modal focus trap ──────────────────────────────────────────────────
//
// Keeps Tab / Shift+Tab inside the open dialog. Without it, tabbing out of a
// popup lands on the page behind it — on a till that means the cashier is typing
// into the product search while a payment dialog is still open.
//
// Deliberately global rather than per-modal: the app has ~65 dialogs across 28
// files, all built as a full-screen overlay. Wiring each one individually would
// guarantee the next new dialog is forgotten. This finds the topmost overlay at
// keypress time, so it covers every existing dialog and every future one for
// free.
//
// Two rules keep it from fighting the code already there:
//   * it listens in the BUBBLE phase, so a component's own onKeyDown runs first
//   * it does nothing if that handler already called preventDefault
// POS relies on this — its payment dialog cycles Tab between specific buttons,
// and that bespoke behaviour still wins.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function isVisible(el: HTMLElement): boolean {
  const s = getComputedStyle(el);
  if (s.display === 'none' || s.visibility === 'hidden' || s.pointerEvents === 'none') return false;
  return el.getClientRects().length > 0;
}

// The dialog currently on top: a visible full-screen overlay that actually
// contains something focusable. Toasts and pointer-events-none layers are
// excluded by isVisible, so they never capture the keyboard.
function topmostOverlay(): HTMLElement | null {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('.fixed.inset-0'))
    .filter((el) => isVisible(el) && el.querySelector(FOCUSABLE));
  if (overlays.length === 0) return null;
  return overlays.reduce((best, el) => {
    const z    = Number.parseInt(getComputedStyle(el).zIndex, 10) || 0;
    const bestZ = Number.parseInt(getComputedStyle(best).zIndex, 10) || 0;
    return z >= bestZ ? el : best;   // ties break toward later DOM order
  });
}

export function useModalFocusTrap(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return;

      const overlay = topmostOverlay();
      if (!overlay) return;

      const items = Array.from(overlay.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
      if (items.length === 0) return;

      const first  = items[0];
      const last   = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;

      // Focus escaped the dialog (or never entered it) — pull it back in.
      if (!active || !overlay.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      // Wrap around at either end so focus never leaves the dialog.
      if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
