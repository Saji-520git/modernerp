import {
  loadReportBranding, newReportDoc, reportLetterhead, sectionTitle,
  styledTable, finalizeReport, lastY, money,
} from './reportPdf';
import type { Quotation } from './quotations';

/** Export a quotation as a professional PDF (shares the report letterhead/footer). */
export async function exportQuotationPdf(q: Quotation): Promise<void> {
  const { settings, logo } = await loadReportBranding();
  const doc = newReportDoc();
  const fmt = (c: number) => money(c, settings);

  let y = reportLetterhead(doc, {
    settings, logo, title: 'Quotation',
    period: `${q.number}${q.validUntil ? ` · valid until ${new Date(q.validUntil).toLocaleDateString('en-GB')}` : ''}`,
  });

  // Customer / title block
  const meta: (string | number)[][] = [];
  if (q.customer?.name) meta.push(['Customer', q.customer.name]);
  if (q.customer?.phone) meta.push(['Phone', q.customer.phone]);
  if (q.customer?.email) meta.push(['Email', q.customer.email]);
  if (q.title) meta.push(['Subject', q.title]);
  meta.push(['Status', q.status]);
  if (meta.length) {
    styledTable(doc, {
      startY: y, theme: 'plain', body: meta,
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 }, 1: { halign: 'left' } },
      fontSize: 9,
    });
    y = lastY(doc) + 6;
  }

  // Line items
  y = sectionTitle(doc, y, 'Items');
  styledTable(doc, {
    startY: y,
    head: [['#', 'Description', 'Qty', 'Unit', 'Unit Price', 'Disc', 'Total']],
    body: q.lines.map((l, i) => [
      i + 1, l.description, l.qty, l.unitLabel, fmt(l.unitPriceCents),
      l.discountCents > 0 ? `− ${fmt(l.discountCents)}` : '—', fmt(l.totalCents),
    ]),
    columnStyles: { 0: { cellWidth: 10, halign: 'right' }, 2: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    fontSize: 8.5,
  });

  // Totals block (right-aligned via a plain table)
  const totals: (string | number)[][] = [['Subtotal', fmt(q.subtotalCents)]];
  if (q.discountCents > 0) totals.push(['Discount', `− ${fmt(q.discountCents)}`]);
  if (q.taxCents > 0) totals.push(['Tax', fmt(q.taxCents)]);
  styledTable(doc, {
    startY: lastY(doc) + 6,
    theme: 'plain',
    body: totals,
    foot: [['TOTAL', fmt(q.totalCents)]],
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 120 }, 1: { halign: 'right' } },
    fontSize: 9.5,
  });

  // Notes / terms
  if (q.note || q.termsConditions) {
    y = sectionTitle(doc, lastY(doc) + 8, q.termsConditions ? 'Terms & Conditions' : 'Notes');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    const text = [q.note, q.termsConditions].filter(Boolean).join('\n\n');
    const lines = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - 24) as string[];
    doc.text(lines, 12, y + 1);
  }

  finalizeReport(doc, settings);
  doc.save(`${q.number}.pdf`);
}
