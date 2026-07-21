import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { settingsApi, type AppSettings } from './settings';

// ─────────────────────────────────────────────────────────────────────────────
// Shared professional PDF layer for every report export.
//
// One look for all reports: branded letterhead (logo + business identity pulled
// from Settings), a KPI summary band, professionally styled tables (brand header,
// zebra striping, bold totals row), and a per-page footer with page numbers and a
// generated-on timestamp. Mirrors the invoice/PO document styling in pdfExport.ts.
// Presentation only — callers pass the same numbers they already display.
// ─────────────────────────────────────────────────────────────────────────────

export type RGB = [number, number, number];

export const BRAND:        RGB = [79, 70, 229];
export const SLATE:        RGB = [30, 41, 59];
export const MUTED:        RGB = [100, 116, 139];
export const FAINT:        RGB = [148, 163, 184];
export const HAIRLINE:     RGB = [226, 232, 240];
export const ZEBRA:        RGB = [248, 250, 252];
export const KPI_BG:       RGB = [248, 250, 252];
export const ACCENT_BG:    RGB = [238, 242, 255];
export const ACCENT_BORDER:RGB = [199, 210, 254];
export const ACCENT_TEXT:  RGB = [55, 48, 163];

const MARGIN = 12; // mm — left/right page margin, matches invoices

type Branding = { settings: AppSettings; logo: string | null };

/** Fetch a logo URL as a base64 data URI (same approach as pdfExport). */
async function fetchLogoBase64(url: string): Promise<string | null> {
  try {
    const res  = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload  = () => resolve(fr.result as string);
      fr.onerror = () => reject(new Error('read error'));
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function logoImgFormat(b64: string): 'PNG' | 'JPEG' | 'GIF' {
  if (b64.includes('image/png')) return 'PNG';
  if (b64.includes('image/gif')) return 'GIF';
  return 'JPEG';
}

/** Load business identity + logo once per export. Never throws. */
export async function loadReportBranding(): Promise<Branding> {
  const settings = await settingsApi.get().catch(() => ({} as AppSettings));
  let logo: string | null = null;
  if (settings.logoUrl) logo = await fetchLogoBase64(settings.logoUrl);
  return { settings, logo };
}

/** Currency formatter honouring the client's currency symbol + position. */
export function money(cents: number, s?: Pick<AppSettings, 'currencySymbol' | 'currencyPosition'>): string {
  const sym = s?.currencySymbol ?? 'Rs.';
  const pos = s?.currencyPosition ?? 'before';
  const n = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return pos === 'before' ? `${sym} ${n}` : `${n} ${sym}`;
}

export function newReportDoc(orientation: 'portrait' | 'landscape' = 'portrait'): jsPDF {
  return new jsPDF({ unit: 'mm', format: 'a4', orientation });
}

type LastAutoTable = jsPDF & { lastAutoTable: { finalY: number } };
export function lastY(doc: jsPDF): number {
  return (doc as LastAutoTable).lastAutoTable?.finalY ?? 40;
}

/**
 * Draw the branded letterhead on the current page.
 *   Left  — logo (or business name) + address · phone · email
 *   Right — report title + period + generated timestamp
 * Returns the Y (mm) at which body content should start.
 */
export function reportLetterhead(
  doc: jsPDF,
  opts: { settings: AppSettings; logo: string | null; title: string; period?: string },
): number {
  const { settings, logo, title, period } = opts;
  const w = doc.internal.pageSize.getWidth();

  // Thin brand band along the very top edge.
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, w, 2.5, 'F');

  // ── Left: identity ─────────────────────────────────────────────────────────
  let textX = MARGIN;
  if (logo) {
    try {
      doc.addImage(logo, logoImgFormat(logo), MARGIN, 10, 24, 16);
      textX = MARGIN + 28;
    } catch { /* corrupt logo → fall back to name only */ }
  }
  let ly = 15;
  doc.setTextColor(...SLATE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(settings.businessName || 'My Business', textX, ly);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  const idLines: string[] = [];
  if (settings.businessAddress) idLines.push(settings.businessAddress.replace(/\n/g, ', '));
  const contact = [settings.businessPhone, settings.businessEmail].filter(Boolean).join('  ·  ');
  if (contact) idLines.push(contact);
  if (settings.businessRegNo) idLines.push(`Reg: ${settings.businessRegNo}`);
  ly += 5;
  for (const line of idLines) { doc.text(line, textX, ly); ly += 4.2; }

  // ── Right: report title + period + timestamp ────────────────────────────────
  doc.setTextColor(...BRAND);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, w - MARGIN, 15, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  if (period) doc.text(period, w - MARGIN, 21.5, { align: 'right' });

  doc.setFontSize(7.5);
  doc.setTextColor(...FAINT);
  const stamp = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  doc.text(`Generated ${stamp}`, w - MARGIN, 26.5, { align: 'right' });

  // ── Divider ─────────────────────────────────────────────────────────────────
  const dividerY = Math.max(ly + 1, 31);
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, dividerY, w - MARGIN, dividerY);

  return dividerY + 8;
}

export type KpiTile = { label: string; value: string; accent?: boolean };

/** Draw a row of boxed KPI tiles. Returns the Y below the band. */
export function kpiBand(doc: jsPDF, y: number, tiles: KpiTile[]): number {
  if (tiles.length === 0) return y;
  const w = doc.internal.pageSize.getWidth();
  const usable = w - MARGIN * 2;
  const gap = 3;
  const tileW = (usable - gap * (tiles.length - 1)) / tiles.length;
  const tileH = 15;

  tiles.forEach((t, i) => {
    const x = MARGIN + i * (tileW + gap);
    doc.setFillColor(...(t.accent ? ACCENT_BG : KPI_BG));
    doc.setDrawColor(...(t.accent ? ACCENT_BORDER : HAIRLINE));
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, tileW, tileH, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...(t.accent ? ACCENT_TEXT : MUTED));
    doc.text(t.label.toUpperCase(), x + 4, y + 5.5);

    doc.setFontSize(12);
    doc.setTextColor(...(t.accent ? ACCENT_TEXT : SLATE));
    doc.text(t.value, x + 4, y + 12);
  });

  return y + tileH + 7;
}

/** Small left-aligned section heading above a table. Returns Y below it. */
export function sectionTitle(doc: jsPDF, y: number, label: string): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...SLATE);
  doc.text(label, MARGIN, y);
  return y + 3;
}

type Cell = string | number;
type ColStyle = { halign?: 'left' | 'right' | 'center'; cellWidth?: number; fontStyle?: 'normal' | 'bold' };
export type StyledTableOpts = {
  startY: number;
  head?: Cell[][];
  body: Cell[][];
  foot?: Cell[][];
  columnStyles?: Record<number, ColStyle>;
  fontSize?: number;
  theme?: 'striped' | 'plain';
};

/** autoTable wrapper with the shared professional theme. */
export function styledTable(doc: jsPDF, opts: StyledTableOpts): void {
  const fs = opts.fontSize ?? 8;
  const theme = opts.theme ?? 'striped';
  autoTable(doc, {
    startY: opts.startY,
    head: opts.head,
    body: opts.body,
    foot: opts.foot,
    theme,
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: fs, cellPadding: 2, textColor: SLATE, lineColor: HAIRLINE, lineWidth: 0.1 },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: fs, halign: 'left' },
    bodyStyles: { fontSize: fs },
    alternateRowStyles: theme === 'striped' ? { fillColor: ZEBRA } : undefined,
    footStyles: { fillColor: ACCENT_BG, textColor: ACCENT_TEXT, fontStyle: 'bold', fontSize: fs },
    columnStyles: opts.columnStyles,
  });
}

/**
 * Stamp the footer on every page (called once, at the end, so total page count is
 * known): hairline rule + business name · Confidential | BROcode ERP | Page X of Y.
 */
export function finalizeReport(doc: jsPDF, settings: AppSettings): void {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...HAIRLINE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, h - 12, w - MARGIN, h - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...FAINT);
    const name = settings.businessName || 'My Business';
    doc.text(`${name} · Confidential`, MARGIN, h - 7);
    doc.text('BROcode ERP', w / 2, h - 7, { align: 'center' });
    doc.text(`Page ${p} of ${total}`, w - MARGIN, h - 7, { align: 'right' });
  }
}
