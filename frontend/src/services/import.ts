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

export function downloadCsvTemplate(): void {
  const rows = [TEMPLATE_HEADERS, ...EXAMPLE_ROWS];
  const csv  = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'import-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadErrorCsv(errors: RowError[]): void {
  const header = ['Row', 'Field', 'Error'];
  const rows   = errors.map((e) => [String(e.row), e.field, e.message]);
  const csv    = [header, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
  const blob   = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = 'import-errors.csv';
  a.click();
  URL.revokeObjectURL(url);
}
