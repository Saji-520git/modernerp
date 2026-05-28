import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Sale, SaleLine } from './sales';
import type { SaleReturn, SaleReturnLine } from './sales';

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

function formatMoney(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Brand colours (indigo palette)
const BRAND_COLOR: [number, number, number] = [79, 70, 229];   // indigo-600
const HEADER_BG: [number, number, number]   = [238, 242, 255]; // indigo-50
const LABEL_COLOR: [number, number, number] = [100, 116, 139]; // slate-500
const TEXT_COLOR: [number, number, number]  = [30, 41, 59];    // slate-800

/** Draw a consistent page header and return the y position after it */
function drawPageHeader(
  doc: jsPDF,
  docNumber: string,
  docType: string,
  dateLabel: string,
  leftInfo: string[],
  rightInfo: { label: string; value: string }[],
): number {
  const pageW = doc.internal.pageSize.getWidth();

  // ── Top colour bar ──────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND_COLOR);
  doc.rect(0, 0, pageW, 18, 'F');

  // Company name (left)
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Brocode ERP', 14, 12);

  // Doc type (right)
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(docType, pageW - 14, 12, { align: 'right' });

  // ── Document number + date ──────────────────────────────────────────────────
  doc.setTextColor(...TEXT_COLOR);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(docNumber, 14, 30);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...LABEL_COLOR);
  doc.text(dateLabel, 14, 37);

  // ── Left info block ─────────────────────────────────────────────────────────
  let y = 46;
  leftInfo.forEach((line) => {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_COLOR);
    doc.text(line, 14, y);
    y += 5.5;
  });

  // ── Right key/value block ───────────────────────────────────────────────────
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

  // Divider
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(14, Math.max(y, ry) + 2, pageW - 14, Math.max(y, ry) + 2);

  return Math.max(y, ry) + 8;
}

/** Draw totals block, returns final y */
function drawTotals(
  doc: jsPDF,
  startY: number,
  rows: { label: string; value: string; bold?: boolean }[],
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const colX = pageW - 80;
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

// ─── 1. Sales Invoice ─────────────────────────────────────────────────────────

export function exportSaleInvoice(sale: Sale): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  const paymentMethods: Record<string, string> = {
    CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank Transfer', WALLET: 'Wallet', OTHER: 'Other',
  };

  const balance = sale.totalCents - sale.paidCents;

  const startY = drawPageHeader(
    doc,
    sale.number,
    'SALES INVOICE',
    `Date: ${formatDate(sale.date)}`,
    [
      `Bill To: ${sale.customer?.name ?? 'Walk-in Customer'}`,
      `Warehouse: ${sale.warehouse.name} (${sale.warehouse.code})`,
      `Prepared by: ${sale.createdBy.fullName}`,
      ...(sale.note ? [`Note: ${sale.note}`] : []),
    ],
    [
      { label: 'STATUS', value: sale.status },
      { label: 'PAYMENT', value: paymentMethods[sale.paymentMethod] ?? sale.paymentMethod },
    ],
  );

  // Lines table
  const lines = (sale.lines as SaleLine[]) ?? [];
  autoTable(doc, {
    startY,
    head: [['Product', 'SKU', 'Qty', 'Unit Price', 'Tax %', 'Discount', 'Total']],
    body: lines.map((l) => [
      l.product.name,
      l.product.sku,
      `${Number(l.qty)} ${l.product.unit?.shortCode ?? ''}`.trim(),
      formatMoney(l.unitPriceCents),
      `${l.taxPercent}%`,
      l.discountCents > 0 ? formatMoney(l.discountCents) : '—',
      formatMoney(l.lineTotalCents),
    ]),
    headStyles: {
      fillColor: BRAND_COLOR,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8.5, textColor: TEXT_COLOR },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 50 },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
    theme: 'plain',
  });

  // Totals
  const afterTable = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  const totalsRows: { label: string; value: string; bold?: boolean }[] = [
    { label: 'Subtotal', value: formatMoney(sale.subtotalCents) },
    { label: 'Tax', value: formatMoney(sale.taxCents) },
    ...(sale.discountCents > 0
      ? [{ label: 'Discount', value: `− ${formatMoney(sale.discountCents)}` }]
      : []),
    { label: 'TOTAL', value: formatMoney(sale.totalCents), bold: true },
    ...(sale.status === 'CONFIRMED'
      ? [
          { label: `Paid (${paymentMethods[sale.paymentMethod] ?? ''})`, value: formatMoney(sale.paidCents) },
          {
            label: balance > 0 ? 'Balance Due' : 'Fully Paid',
            value: balance > 0 ? formatMoney(balance) : '✓',
            bold: true,
          },
        ]
      : []),
  ];
  drawTotals(doc, afterTable, totalsRows);

  // Footer
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...LABEL_COLOR);
  doc.text('Thank you for your business.', pageW / 2, pageH - 10, { align: 'center' });
  doc.text(`Generated by Brocode ERP · ${new Date().toLocaleString()}`, pageW / 2, pageH - 6, { align: 'center' });

  doc.save(`${sale.number}.pdf`);
}

// ─── 2. Purchase Order ────────────────────────────────────────────────────────

export function exportPurchaseOrder(po: PdfPurchase): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  const startY = drawPageHeader(
    doc,
    po.number,
    'PURCHASE ORDER',
    `Date: ${formatDate(po.date)}`,
    [
      `Supplier: ${po.supplier.name}`,
      ...(po.supplier.phone ? [`Phone: ${po.supplier.phone}`] : []),
      ...(po.supplier.email ? [`Email: ${po.supplier.email}`] : []),
      `Receive to: ${po.warehouse.name} (${po.warehouse.code})`,
      `Ordered by: ${po.createdBy.fullName}`,
      ...(po.note ? [`Note: ${po.note}`] : []),
    ],
    [
      { label: 'STATUS', value: po.status },
    ],
  );

  const lines = (po.lines as PdfPurchaseLine[]) ?? [];
  autoTable(doc, {
    startY,
    head: [['Product', 'SKU', 'Qty', 'Unit Cost', 'Tax %', 'Line Total']],
    body: lines.map((l) => [
      l.product.name,
      l.product.sku,
      `${Number(l.qty)} ${l.product.unit?.shortCode ?? ''}`.trim(),
      formatMoney(l.unitCostCents),
      `${l.taxPercent}%`,
      formatMoney(l.lineTotalCents),
    ]),
    headStyles: {
      fillColor: BRAND_COLOR,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8.5, textColor: TEXT_COLOR },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 60 },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
    theme: 'plain',
  });

  const afterTable = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  drawTotals(doc, afterTable, [
    { label: 'Subtotal', value: formatMoney(po.subtotalCents) },
    { label: 'Tax', value: formatMoney(po.taxCents) },
    { label: 'TOTAL', value: formatMoney(po.totalCents), bold: true },
  ]);

  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...LABEL_COLOR);
  doc.text(`Generated by Brocode ERP · ${new Date().toLocaleString()}`, pageW / 2, pageH - 6, { align: 'center' });

  doc.save(`${po.number}.pdf`);
}

// ─── 3. Credit Return Note ────────────────────────────────────────────────────

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
      fillColor: [234, 88, 12],   // orange-600
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8.5, textColor: TEXT_COLOR },
    alternateRowStyles: { fillColor: [248, 250, 252] },
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
