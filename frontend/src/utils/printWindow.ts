// ─── Popup print documents ────────────────────────────────────────────────────
//
// Receipts and labels print by opening a blank popup, writing a standalone HTML
// document into it, and printing that. The opener used to drive the last step:
//
//   setTimeout(() => { win.print(); win.close(); }, 600);
//
// That works in a browser and NOT in Electron. In a browser `window.print()` is
// modal — it blocks until the print dialog is dismissed, so `close()` only runs
// afterwards. In Electron it is routed through webContents and returns
// immediately, so `close()` destroyed the window before the job reached the
// spooler: the popup blinked open and vanished, nothing printed, and no error
// was raised anywhere. The sale had already saved, so it looked like printing
// was simply skipped.
//
// The document therefore prints and closes ITSELF. `afterprint` is the only
// signal that the print dialog is actually done, and it is raised on both
// confirm and cancel.

/**
 * Inline script to embed just before `</body>` of a popup print document.
 *
 * Prints once the document has fully loaded (images included) and closes the
 * window when the print dialog is dismissed. Callers must NOT also call
 * `win.print()` or `win.close()` — that is the bug this exists to avoid.
 *
 * @param fallbackCloseMs Safety net for printer drivers that never fire
 *   `afterprint`, so an orphan window cannot linger forever. Generous on
 *   purpose: closing early is the failure mode that loses the print.
 */
export function autoPrintScript(fallbackCloseMs = 60_000): string {
  return `<script>
(function () {
  var closed = false;
  function done() { if (closed) return; closed = true; window.close(); }
  window.onafterprint = done;
  function go() {
    window.focus();
    window.print();
    setTimeout(done, ${fallbackCloseMs});
  }
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go);
})();
</script>`;
}

// ─── Opening the popup ────────────────────────────────────────────────────────
//
// Two calls, deliberately, because the popup MUST be opened synchronously inside
// the click handler. Browsers only grant `window.open` while a user gesture is
// still on the stack; the first `await` ends that gesture, so opening after the
// settings fetch gets the window blocked. Callers therefore do:
//
//   const win = openPrintWindow();        // sync, inside the handler
//   if (!win) { …tell the user… }
//   const html = await buildDocument();   // now free to await
//   writePrintDocument(win, html);
//
// The placeholder text is what the user sees during that await.

/** Opens the print popup and shows a placeholder. Returns null if blocked. */
export function openPrintWindow(
  label = 'document',
  width = 900,
  height = 720,
): Window | null {
  const win = window.open('', '_blank', `width=${width},height=${height}`);
  if (!win) return null;
  win.document.write(
    `<p style="font-family:system-ui,-apple-system,sans-serif;padding:16px;color:#334155">Preparing ${label}…</p>`,
  );
  return win;
}

/**
 * Writes the finished document into the popup.
 *
 * Does NOT call `win.print()` — the HTML is expected to carry
 * `autoPrintScript()`, for the Electron reason documented above.
 */
export function writePrintDocument(win: Window, html: string): void {
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
}
