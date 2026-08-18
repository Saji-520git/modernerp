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
