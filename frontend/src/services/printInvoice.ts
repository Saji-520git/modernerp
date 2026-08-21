// ─── Printing a sale after the fact ───────────────────────────────────────────
//
// Until now an invoice could only be printed at the moment of the POS sale, from
// the receipt modal. Anything printed later had to be downloaded as a PDF first
// and printed from a PDF reader. These two functions close that gap from the
// Sales list.
//
// Both go through the popup path in utils/printWindow.ts, where the document
// prints and closes ITSELF. Neither calls win.print()/win.close() — doing that
// from the opener is the Electron bug documented there.

import { api } from './api';
import { settingsApi, type AppSettings } from './settings';
import { posApi } from './pos';
import type { Sale } from './sales';
import { useAuthStore } from '../store/authStore';
import { openPrintWindow, writePrintDocument } from '../utils/printWindow';
import { generateInvoiceHtml } from '../utils/generateInvoiceHtml';
import { generateReceiptHtml } from '../utils/generateReceiptHtml';

/**
 * The logo is served behind auth, so a bare <img src="/uploads/..."> inside the
 * popup would 401 — the popup is a separate document and carries no header.
 * Fetch it here with the token and inline it as a data URI.
 */
async function fetchLogoAsBase64(url: string): Promise<string | null> {
  const token = useAuthStore.getState().accessToken;
  if (!url || !token) return null;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror  = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * The list endpoint returns `_count.lines` but not the lines themselves, so an
 * invoice printed straight from the table would have an empty item table. Same
 * hydration exportSaleInvoice does.
 */
async function hydrate(sale: Sale): Promise<Sale> {
  if (sale.lines?.length) return sale;
  try {
    const full: Sale = await api.get(`/sales/${sale.id}`).then(r => r.data);
    if (full?.lines?.length) return full;
  } catch { /* fall back to what the caller had */ }
  return sale;
}

/**
 * Prints the A4 invoice — the same document "Download PDF" produces.
 *
 * Works for every sale, POS or back-office. Throws with a user-facing message
 * when the popup is blocked, so the caller can surface it as a toast rather than
 * failing silently.
 */
export async function printSaleInvoice(sale: Sale): Promise<void> {
  // Opened FIRST, before any await: browsers only allow window.open while the
  // click gesture is still on the stack, and the settings fetch below ends it.
  const win = openPrintWindow('invoice');
  if (!win) throw new Error('Print window was blocked — allow pop-ups for this app and try again.');

  try {
    const [settings, fullSale] = await Promise.all([
      settingsApi.get().catch(() => ({} as AppSettings)),
      hydrate(sale),
    ]);

    const logo = (settings.logoUrl && settings.invoiceShowLogo)
      ? await fetchLogoAsBase64(settings.logoUrl)
      : null;

    writePrintDocument(win, generateInvoiceHtml(fullSale, settings, logo));
  } catch (err) {
    win.close();
    throw err;
  }
}

/**
 * Reprints the 80mm/58mm till receipt for a POS sale.
 *
 * POS only: GET /pos/receipt/:id filters `isPos: true`, so a back-office invoice
 * 404s here — callers must gate on `sale.isPos`.
 *
 * Change is passed as null, not 0: the cash handed over is not stored on the
 * sale, so this slip drops the Tendered/Change block and marks itself REPRINT
 * rather than inventing figures that contradict the customer's original.
 */
export async function printPosReceipt(sale: Sale): Promise<void> {
  const win = openPrintWindow('receipt', 420, 640);
  if (!win) throw new Error('Print window was blocked — allow pop-ups for this app and try again.');

  try {
    // Settings are NOT optional here, unlike the A4 invoice above: paper width,
    // language and the header all come from them, and a receipt printed at the
    // wrong width on a thermal printer is waste, not a degraded result. Same
    // stance the POS receipt modal takes.
    const [settings, receipt] = await Promise.all([
      settingsApi.get(),
      posApi.getReceipt(sale.id),
    ]);

    const logo = (settings.logoUrl && settings.receiptShowLogo)
      ? await fetchLogoAsBase64(settings.logoUrl)
      : null;

    writePrintDocument(win, generateReceiptHtml(receipt, settings, null, logo));
  } catch (err) {
    win.close();
    throw err;
  }
}
