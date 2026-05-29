import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Sale, SaleLine } from './sales';
import type { SaleReturn, SaleReturnLine } from './sales';
import { settingsApi, type AppSettings } from './settings';
import { api } from './api';

// ─── Types for Purchase (mirrored locally to avoid circular imports) ──────────

export interface PdfPurchase {
  id: string;
  number: string;
  date: string;
  status: string;
  note: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  supplier: { id: string; name: string; phone?: string | null; email?: string | null };
  warehouse: { id: string; name: string; code: string };
  createdBy: { id: string; fullName: string };
  lines?: PdfPurchaseLine[];
  _count?: { lines: number };
}

export interface PdfPurchaseLine {
  id: string;
  productId: string;
  qty: number | string;
  unitCostCents: number;
  taxPercent: number;
  lineTotalCents: number;
  product: { id: string; name: string; sku: string; unit?: { shortCode: string } };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Currency-aware money formatter */
function money(cents: number, s?: Pick<AppSettings, 'currencySymbol' | 'currencyPosition'>): string {
  const sym = s?.currencySymbol ?? 'Rs.';
  const pos = s?.currencyPosition ?? 'before';
  const n = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return pos === 'before' ? `${sym} ${n}` : `${n} ${sym}`;
}

/** Legacy plain formatter used by exportSaleReturn */
function formatMoney(cents: number): string {
  return money(cents);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return formatDate(d.toISOString());
}

async function fetchLogoBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
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

function logoImgFormat(b64: string): string {
  if (b64.includes('image/png'))  return 'PNG';
  if (b64.includes('image/gif'))  return 'GIF';
  if (b64.includes('image/webp')) return 'WEBP';
  return 'JPEG';
}

// ─── Color palette ────────────────────────────────────────────────────────────

// New design (invoice + PO)
const BRAND   : [number,number,number] = [79, 70, 229];    // #4F46E5
const TEXT    : [number,number,number] = [30, 41, 59];     // slate-800
const LABEL   : [number,number,number] = [100, 116, 139];  // slate-500
const GRAY    : [number,number,number] = [248, 249, 250];  // #F8F9FA
const BORD    : [number,number,number] = [229, 231, 235];  // #E5E7EB
const RED_C   : [number,number,number] = [220, 38, 38];    // #DC2626
const GRN_C   : [number,number,number] = [22, 163, 74];    // #16A34A
const TOTAL_BG   : [number,number,number] = [240, 240, 255]; // #F0F0FF
const BAL_RED_BG : [number,number,number] = [254, 242, 242]; // #FEF2F2
const BAL_GRN_BG : [number,number,number] = [240, 253, 244]; // #F0FDF4

// Legacy aliases — used only by drawPageHeader / drawTotals for exportSaleReturn
const BRAND_COLOR : [number,number,number] = BRAND;
const HEADER_BG   : [number,number,number] = [238, 242, 255]; // indigo-50
const LABEL_COLOR : [number,number,number] = LABEL;
const TEXT_COLOR  : [number,number,number] = TEXT;

// ─── Legacy helpers (used ONLY by exportSaleReturn — do not remove) ───────────

function drawPageHeader(
  doc: jsPDF,
  docNumber: string,
  docType: string,
  dateLabel: string,
  leftInfo: string[],
  rightInfo: { label: string; value: string }[],
): number {
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(...BRAND_COLOR);
  doc.rect(0, 0, pageW, 18, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Brocode ERP', 14, 12);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(docType, pageW - 14, 12, { align: 'right' });

  doc.setTextColor(...TEXT_COLOR);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(docNumber, 14, 30);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...LABEL_COLOR);
  doc.text(dateLabel, 14, 37);

  let y = 46;
  leftInfo.forEach((line) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_COLOR);
    doc.text(line, 14, y);
    y += 5.5;
  });

  let ry = 26;
  rightInfo.forEach(({ label, value }) => {
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...LABEL_COLOR);
    doc.text(label, pageW - 14, ry, { align: 'right' });
    ry += 4;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...TEXT_COLOR);
    doc.text(value, pageW - 14, ry, { align: 'right' });
    ry += 7;
  });

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(14, Math.max(y, ry) + 2, pageW - 14, Math.max(y, ry) + 2);

  return Math.max(y, ry) + 8;
}

function drawTotals(
  doc: jsPDF,
  startY: number,
  rows: { label: string; value: string; bold?: boolean }[],
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const colX  = pageW - 80;
  let y = startY;

  rows.forEach(({ label, value, bold }) => {
    if (bold) {
      doc.setFillColor(...HEADER_BG);
      doc.rect(colX - 4, y - 5, 80 + 4, 8, 'F');
    }
    doc.setFontSize(9);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(...(bold ? TEXT_COLOR : LABEL_COLOR));
    doc.text(label, colX, y);
    doc.text(value, pageW - 14, y, { align: 'right' });
    y += 7;
  });

  return y;
}

// ─── New design helpers (invoice + PO) ───────────────────────────────────────

/**
 * Draw the two-column header block:
 *   left  — logo (or company name) + address + phone + email
 *   right — document type (large) + number + date + status
 * Returns y position directly below the brand separator line.
 */
async function drawDocHeader(
  doc: jsPDF,
  settings: AppSettings,
  logoBase64: string | null,
  docType: string,
  docNumber: string,
  docDate: string,
  docStatus: string,
): Promise<number> {
  const W = doc.internal.pageSize.getWidth();
  const L = 14;
  const R = W - 14;

  let leftY  = 14;
  let rightY = 14;

  // ── Left: Logo or company name ────────────────────────────────────────────
  if (logoBase64 && settings.invoiceShowLogo) {
    try {
      doc.addImage(logoBase64, logoImgFormat(logoBase64), L, leftY, 30, 17);
      leftY += 20;
    } catch {
      // Image decode failed — fall back to text name
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...TEXT);
      doc.text(settings.businessName || 'My Business', L, leftY + 6);
      leftY += 10;
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...TEXT);
    doc.text(settings.businessName || 'My Business', L, leftY + 6);
    leftY += 10;
  }

  if (settings.businessAddress) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...LABEL);
    doc.text(settings.businessAddress, L, leftY);
    leftY += 5;
  }

  if (settings.businessPhone) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...LABEL);
    doc.text(settings.businessPhone, L, leftY);
    leftY += 5;
  }

  if (settings.businessEmail) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...LABEL);
    doc.text(settings.businessEmail, L, leftY);
    leftY += 5;
  }

  // ── Right: Document type, number, date, status ────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...BRAND);
  doc.text(docType, R, rightY + 7, { align: 'right' });
  rightY += 12;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...TEXT);
  doc.text(docNumber, R, rightY, { align: 'right' });
  rightY += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...LABEL);
  doc.text(docDate, R, rightY, { align: 'right' });
  rightY += 5;

  const statusRGB: [number,number,number] =
    docStatus === 'CONFIRMED' ? GRN_C :
    docStatus === 'CANCELLED' ? RED_C : LABEL;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...statusRGB);
  doc.text(docStatus, R, rightY, { align: 'right' });
  rightY += 5;

  // ── Brand separator line ──────────────────────────────────────────────────
  const sepY = Math.max(leftY, rightY) + 4;
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.8);
  doc.line(L, sepY, R, sepY);

  return sepY + 5;
}

/**
 * Draw the document meta box (Bill To / Supplier on left, doc details on right).
 * Returns y position below the box.
 */
function drawMetaSection(
  doc: jsPDF,
  startY: number,
  leftTitle: string,
  leftLines: string[],
  rightRows: { label: string; value: string }[],
): number {
  const W = doc.internal.pageSize.getWidth();
  const L = 14;
  const R = W - 14;
  const boxW   = R - L;
  const lineH  = 5;
  const leftH  = leftLines.length  * lineH + 14;
  const rightH = rightRows.length  * 6     + 10;
  const boxH   = Math.max(leftH, rightH, 18);

  // Light gray background + border
  doc.setFillColor(...GRAY);
  doc.rect(L, startY, boxW, boxH, 'F');
  doc.setDrawColor(...BORD);
  doc.setLineWidth(0.3);
  doc.rect(L, startY, boxW, boxH, 'S');

  const pad = 7;
  let lY = startY + pad + 4;

  // Left column header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...LABEL);
  doc.text(leftTitle.toUpperCase(), L + pad, lY);
  lY += 5;

  // Left column lines
  for (const line of leftLines) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT);
    doc.text(line, L + pad, lY);
    lY += lineH;
  }

  // Right column (starts at horizontal midpoint)
  const midX = L + boxW / 2 + 4;
  let rY = startY + pad + 4;

  for (const { label, value } of rightRows) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...LABEL);
    doc.text(`${label}:`, midX, rY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT);
    doc.text(value, R - pad, rY, { align: 'right' });
    rY += 6;
  }

  return startY + boxH + 4;
}

/**
 * Draw the right-aligned totals block.
 * Pass { label: '---', value: '' } to insert a horizontal divider.
 * Returns y position below the last row.
 */
function drawNewTotals(
  doc: jsPDF,
  startY: number,
  rows: {
    label: string;
    value: string;
    bold?: boolean;
    color?: [number,number,number];
    bg?: [number,number,number];
  }[],
): number {
  const W      = doc.internal.pageSize.getWidth();
  const R      = W - 14;
  const labelX = R - 68;
  const rowH   = 7;
  let y = startY;

  for (const { label, value, bold, color, bg } of rows) {
    // Divider row
    if (label === '---') {
      doc.setDrawColor(...BORD);
      doc.setLineWidth(0.3);
      doc.line(labelX - 2, y, R + 2, y);
      y += 4;
      continue;
    }

    // Optional background highlight
    if (bg) {
      doc.setFillColor(...bg);
      doc.rect(labelX - 4, y - 5, R - labelX + 18, rowH, 'F');
    }

    const rgb: [number,number,number] = color ?? (bold ? TEXT : LABEL);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 10 : 9);
    doc.setTextColor(...rgb);
    doc.text(label, labelX, y);
    if (value) doc.text(value, R, y, { align: 'right' });
    y += rowH;
  }

  return y;
}

/**
 * Draw footer: optional return-policy box, separator line,
 * then "Thank you" (left) · contact (center) · BROcode (right).
 */
function drawNewFooter(doc: jsPDF, settings: AppSettings): void {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const L = 14;
  const R = W - 14;

  let footerTop = H - 20;

  // Return policy box sits above the footer line
  if (settings.returnPolicy) {
    const boxH = 12;
    const boxY = footerTop - boxH - 3;
    doc.setFillColor(248, 250, 252);
    doc.rect(L, boxY, R - L, boxH, 'F');
    doc.setDrawColor(...BORD);
    doc.setLineWidth(0.3);
    doc.rect(L, boxY, R - L, boxH, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...LABEL);
    doc.text('Return Policy:', L + 3, boxY + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const policyLines = doc.splitTextToSize(settings.returnPolicy, R - L - 36) as string[];
    doc.text(policyLines[0] ?? '', L + 31, boxY + 5);
    footerTop = boxY - 3;
  }

  // Separator
  doc.setDrawColor(...BORD);
  doc.setLineWidth(0.3);
  doc.line(L, footerTop, R, footerTop);

  const lineY = footerTop + 5;

  // Left: "Thank you for your business!"
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(...LABEL);
  doc.text('Thank you for your business!', L, lineY);

  // Center: phone · email
  const contact = [settings.businessPhone, settings.businessEmail].filter(Boolean).join(' · ');
  if (contact) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...LABEL);
    doc.text(contact, W / 2, lineY, { align: 'center' });
  }

  // Right: "Powered by BROcode ERP"
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...LABEL);
  doc.text('Powered by BROcode ERP', R, lineY, { align: 'right' });
}

// ─── 1. Sales Invoice ─────────────────────────────────────────────────────────

export async function exportSaleInvoice(sale: Sale): Promise<void> {
  // Fetch AppSettings (company info, currency, logo, etc.)
  const settings = await settingsApi.get().catch(() => ({} as AppSettings));

  // ── BUG FIX: list endpoint returns _count.lines but not the lines array.
  // Fetch the full sale document when lines are absent so the table is populated.
  let fullSale: Sale = sale;
  if (!sale.lines?.length) {
    try {
      const fetched: Sale = await api.get(`/sales/${sale.id}`).then(r => r.data);
      if (fetched?.lines?.length) fullSale = fetched;
    } catch { /* fall back to original */ }
  }

  // Logo
  let logoBase64: string | null = null;
  if (settings.logoUrl && settings.invoiceShowLogo) {
    logoBase64 = await fetchLogoBase64(settings.logoUrl);
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const fmt = (c: number) => money(c, settings);

  const PAYMENT_LABELS: Record<string, string> = {
    CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank Transfer',
    WALLET: 'Wallet', QR_PAY: 'QR Pay', CREDIT: 'Credit', OTHER: 'Other',
  };

  // ── Header ────────────────────────────────────────────────────────────────
  let y = await drawDocHeader(
    doc,
    settings,
    logoBase64,
    'SALES INVOICE',
    fullSale.number,
    `Date: ${formatDate(fullSale.date)}`,
    fullSale.status,
  );

  // ── Meta section ──────────────────────────────────────────────────────────
  const dueDate = settings.invoiceDueDays ? addDays(fullSale.date, settings.invoiceDueDays) : null;
  const balance = fullSale.totalCents - fullSale.paidCents;

  y = drawMetaSection(
    doc,
    y,
    'BILL TO',
    [
      fullSale.customer?.name ?? 'Walk-in Customer',
      ...(fullSale.customer?.phone ? [`Tel: ${fullSale.customer.phone}`] : []),
    ],
    [
      { label: 'Invoice No',  value: fullSale.number },
      { label: 'Date',        value: formatDate(fullSale.date) },
      ...(dueDate ? [{ label: 'Due Date',   value: dueDate }] : []),
      { label: 'Payment',     value: PAYMENT_LABELS[fullSale.paymentMethod] ?? fullSale.paymentMethod },
      { label: 'Warehouse',   value: `${fullSale.warehouse.name} (${fullSale.warehouse.code})` },
      { label: 'Prepared by', value: fullSale.createdBy.fullName },
    ],
  );

  // ── Items table ───────────────────────────────────────────────────────────
  const lines: SaleLine[] = fullSale.lines ?? [];

  autoTable(doc, {
    startY: y,
    head: [['Product', 'SKU', 'Qty', 'Unit Price', 'Tax %', 'Discount', 'Total']],
    body: lines.map(l => [
      l.product.name,
      l.product.sku,
      `${Number(l.qty)}${l.product.unit?.shortCode ? ' ' + l.product.unit.shortCode : ''}`,
      fmt(l.unitPriceCents),
      l.taxPercent > 0 ? `${l.taxPercent}%` : '0%',
      l.discountCents > 0 ? fmt(l.discountCents) : '—',
      fmt(l.lineTotalCents),
    ]),
    headStyles: {
      fillColor: BRAND,
      textColor: [255, 255, 255] as [number,number,number],
      fontStyle: 'bold',
      fontSize: 10,
    },
    bodyStyles: {
      fontSize: 9,
      textColor: TEXT,
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251] as [number,number,number],
    },
    styles: {
      lineColor: BORD,
      lineWidth: 0.2,
    },
    columnStyles: {
      0: { cellWidth: 'auto', halign: 'left'   },
      1: { cellWidth: 22,    halign: 'center', fontSize: 8, textColor: LABEL },
      2: { cellWidth: 16,    halign: 'center'  },
      3: { cellWidth: 26,    halign: 'center'  },
      4: { cellWidth: 14,    halign: 'center'  },
      5: { cellWidth: 26,    halign: 'center'  },
      6: { cellWidth: 28,    halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      // Discount column: render in red when an actual discount exists
      if (data.section === 'body' && data.column.index === 5) {
        if ((data.cell.raw as string) !== '—') {
          data.cell.styles.textColor = RED_C as [number,number,number];
        }
      }
    },
    margin: { left: 14, right: 14 },
    theme: 'grid',
  });

  // ── Totals ────────────────────────────────────────────────────────────────
  const afterTable = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

  const totRows: {
    label: string; value: string;
    bold?: boolean; color?: [number,number,number]; bg?: [number,number,number];
  }[] = [
    { label: 'Subtotal', value: fmt(fullSale.subtotalCents) },
    ...(fullSale.taxCents > 0
      ? [{ label: settings.taxLabel || 'Tax', value: fmt(fullSale.taxCents) }]
      : []),
    ...(fullSale.discountCents > 0
      ? [{ label: 'Discount', value: `− ${fmt(fullSale.discountCents)}`, color: RED_C }]
      : []),
    { label: '---',   value: '' },
    { label: 'TOTAL', value: fmt(fullSale.totalCents), bold: true, bg: TOTAL_BG },
  ];

  if (fullSale.status === 'CONFIRMED') {
    totRows.push({
      label: `Paid (${PAYMENT_LABELS[fullSale.paymentMethod] ?? ''})`,
      value: fmt(fullSale.paidCents),
      color: GRN_C,
    });
    if (balance > 0) {
      totRows.push({ label: 'Balance Due', value: fmt(balance), bold: true, color: RED_C, bg: BAL_RED_BG });
    } else {
      totRows.push({ label: 'Fully Paid ✓', value: '', bold: true, color: GRN_C, bg: BAL_GRN_BG });
    }
  }

  drawNewTotals(doc, afterTable, totRows);

  // ── Footer ────────────────────────────────────────────────────────────────
  drawNewFooter(doc, settings);

  doc.save(`${fullSale.number}.pdf`);
}

// ─── 2. Purchase Order ────────────────────────────────────────────────────────

export async function exportPurchaseOrder(po: PdfPurchase): Promise<void> {
  const settings = await settingsApi.get().catch(() => ({} as AppSettings));

  // Fetch full PO with lines when lines are absent
  let fullPO: PdfPurchase = po;
  if (!po.lines?.length) {
    try {
      const fetched: PdfPurchase = await api.get(`/purchases/${po.id}`).then(r => r.data);
      if (fetched?.lines?.length) fullPO = fetched;
    } catch { /* fall back to original */ }
  }

  let logoBase64: string | null = null;
  if (settings.logoUrl && settings.invoiceShowLogo) {
    logoBase64 = await fetchLogoBase64(settings.logoUrl);
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const fmt = (c: number) => money(c, settings);

  // ── Header ────────────────────────────────────────────────────────────────
  let y = await drawDocHeader(
    doc,
    settings,
    logoBase64,
    'PURCHASE ORDER',
    fullPO.number,
    `Date: ${formatDate(fullPO.date)}`,
    fullPO.status,
  );

  // ── Meta section ──────────────────────────────────────────────────────────
  y = drawMetaSection(
    doc,
    y,
    'SUPPLIER',
    [
      fullPO.supplier.name,
      ...(fullPO.supplier.phone ? [`Tel: ${fullPO.supplier.phone}`] : []),
      ...(fullPO.supplier.email ? [`Email: ${fullPO.supplier.email}`] : []),
    ],
    [
      { label: 'PO Number',  value: fullPO.number },
      { label: 'Date',       value: formatDate(fullPO.date) },
      { label: 'Status',     value: fullPO.status },
      { label: 'Warehouse',  value: `${fullPO.warehouse.name} (${fullPO.warehouse.code})` },
      { label: 'Ordered by', value: fullPO.createdBy.fullName },
    ],
  );

  // ── Items table ───────────────────────────────────────────────────────────
  const lines = fullPO.lines ?? [];

  autoTable(doc, {
    startY: y,
    head: [['Product', 'SKU', 'Qty', 'Unit Cost', 'Tax %', 'Line Total']],
    body: lines.map(l => [
      l.product.name,
      l.product.sku,
      `${Number(l.qty)}${l.product.unit?.shortCode ? ' ' + l.product.unit.shortCode : ''}`,
      fmt(l.unitCostCents),
      l.taxPercent > 0 ? `${l.taxPercent}%` : '0%',
      fmt(l.lineTotalCents),
    ]),
    headStyles: {
      fillColor: BRAND,
      textColor: [255, 255, 255] as [number,number,number],
      fontStyle: 'bold',
      fontSize: 10,
    },
    bodyStyles: {
      fontSize: 9,
      textColor: TEXT,
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251] as [number,number,number],
    },
    styles: {
      lineColor: BORD,
      lineWidth: 0.2,
    },
    columnStyles: {
      0: { cellWidth: 'auto', halign: 'left'  },
      1: { cellWidth: 24,    halign: 'center', fontSize: 8, textColor: LABEL },
      2: { cellWidth: 18,    halign: 'center' },
      3: { cellWidth: 30,    halign: 'center' },
      4: { cellWidth: 14,    halign: 'center' },
      5: { cellWidth: 32,    halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
    theme: 'grid',
  });

  // ── Totals ────────────────────────────────────────────────────────────────
  const afterTable = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;

  const poTotRows: {
    label: string; value: string;
    bold?: boolean; color?: [number,number,number]; bg?: [number,number,number];
  }[] = [
    { label: 'Subtotal', value: fmt(fullPO.subtotalCents) },
    ...(fullPO.taxCents > 0
      ? [{ label: settings.taxLabel || 'Tax', value: fmt(fullPO.taxCents) }]
      : []),
    { label: '---',   value: '' },
    { label: 'TOTAL', value: fmt(fullPO.totalCents), bold: true, bg: TOTAL_BG },
  ];

  drawNewTotals(doc, afterTable, poTotRows);

  // ── Footer ────────────────────────────────────────────────────────────────
  drawNewFooter(doc, settings);

  doc.save(`${fullPO.number}.pdf`);
}

// ─── 3. Credit Return Note (unchanged) ───────────────────────────────────────

export function exportSaleReturn(ret: SaleReturn): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  const startY = drawPageHeader(
    doc,
    ret.number,
    'CREDIT RETURN NOTE',
    `Date: ${formatDate(ret.createdAt)}`,
    [
      `Customer: ${ret.sale.customer?.name ?? 'Walk-in Customer'}`,
      `Against Invoice: ${ret.sale.number}`,
      `Warehouse: ${ret.warehouse.name} (${ret.warehouse.code})`,
      `Processed by: ${ret.createdBy.fullName}`,
      ...(ret.reason ? [`Reason: ${ret.reason}`] : []),
    ],
    [],
  );

  const lines = (ret.lines as SaleReturnLine[]) ?? [];
  autoTable(doc, {
    startY,
    head: [['Product', 'SKU', 'Return Qty', 'Unit Price', 'Refund Amount']],
    body: lines.map((l) => [
      l.product.name,
      l.product.sku,
      `${Number(l.qty)} ${l.product.unit?.shortCode ?? ''}`.trim(),
      formatMoney(l.unitPriceCents),
      formatMoney(l.lineTotalCents),
    ]),
    headStyles: {
      fillColor: [234, 88, 12] as [number,number,number],
      textColor: [255, 255, 255] as [number,number,number],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8.5, textColor: TEXT_COLOR },
    alternateRowStyles: { fillColor: [248, 250, 252] as [number,number,number] },
    columnStyles: {
      0: { cellWidth: 60 },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
    theme: 'plain',
  });

  const afterTable = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  drawTotals(doc, afterTable, [
    { label: 'TOTAL REFUND', value: formatMoney(ret.totalCents), bold: true },
  ]);

  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...LABEL_COLOR);
  doc.text(`Generated by Brocode ERP · ${new Date().toLocaleString()}`, pageW / 2, pageH - 6, { align: 'center' });

  doc.save(`${ret.number}.pdf`);
}
