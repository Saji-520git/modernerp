import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedRow {
  rowNum:        number;
  name:          string;
  sku:           string;
  barcode:       string | null;
  category:      string | null;
  brand:         string | null;
  unit:          string | null;
  costPrice:     number;
  sellPrice:     number;
  taxPercent:    number;
  reorderLevel:  number;
  openingStock:  number;
  warehouseName: string | null;
}

export interface RowError {
  row:     number;
  field:   string;
  message: string;
}

export interface PreviewResult {
  valid:  ParsedRow[];
  errors: RowError[];
}

export interface ImportSummary {
  imported:  number;
  withStock: number;
  skipped:   number;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const importApi = {
  preview: (file: File): Promise<PreviewResult> => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/import/preview', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  confirm: (file: File): Promise<ImportSummary> => {
    const form = new FormData();
    form.append('file', file);
    return api.post('/import/confirm', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
};

// ─── CSV Template generator (no library needed) ───────────────────────────────

const TEMPLATE_HEADERS = [
  'name', 'sku', 'barcode', 'category', 'brand', 'unit',
  'costPrice', 'sellPrice', 'taxPercent', 'reorderLevel',
  'openingStock', 'warehouseName',
];

const EXAMPLE_ROWS = [
  ['Panadol 500mg', 'MED-001', '8712345678901', 'Medicines', 'GSK', 'Box', '150', '200', '0', '10', '50', 'Main Warehouse'],
  ['Rexidin Mouthwash', 'MED-002', '', 'Medicines', 'Reckitt', 'Bottle', '320', '450', '0', '5', '0', ''],
];

// ─── CSV writing ─────────────────────────────────────────────────────────────
//
// Both files below quoted their fields but never escaped a quote INSIDE one, so
// an error message like:  Barcode "479..." already belongs to product PRD-0126
// was written as a field that closes itself three characters in. The result is
// not CSV: Excel and every conforming parser mis-split the line, and the error
// report — the one file whose whole job is telling you what went wrong — could
// not be opened correctly.
export function cell(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

// A BOM so Excel reads UTF-8 rather than mangling any non-ASCII product name,
// and CRLF because that is what Excel writes and expects.
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// The blob URL is released on a timer, not immediately.
//
// Electron shows a Save dialog and does not read the blob until the user picks
// a folder, so revoking straight after click() pulls the data out from under an
// open dialog: the file downloads in a browser and silently fails in the
// packaged app. Same reason as the backup and catalogue exports.
function downloadCsv(filename: string, rows: readonly (readonly unknown[])[]): void {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadCsvTemplate(): void {
  downloadCsv('import-template.csv', [TEMPLATE_HEADERS, ...EXAMPLE_ROWS]);
}

export function downloadErrorCsv(errors: RowError[]): void {
  downloadCsv('import-errors.csv', [
    ['Row', 'Field', 'Error'],
    ...errors.map((e) => [e.row, e.field, e.message]),
  ]);
}
