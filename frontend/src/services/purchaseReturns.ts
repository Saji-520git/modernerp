import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReturnStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export interface PurchaseReturnLine {
  id:             string;
  purchaseLineId: string;
  productId:      string;
  qty:            number;
  unitCostCents:  number;
  lineTotalCents: number;
  product:        { id: string; name: string; sku: string };
  purchaseLine:   { id: string; qty: number; receivedQty: number; returnedQty: number };
}

export interface PurchaseReturn {
  id:          string;
  number:      string;
  purchaseId:  string;
  supplierId:  string;
  warehouseId: string;
  status:      ReturnStatus;
  reason:      string | null;
  totalCents:  number;
  isActive:    boolean;
  createdAt:   string;
  updatedAt:   string;
  purchase:    { id: string; number: string };
  supplier:    { id: string; name: string };
  warehouse:   { id: string; name: string; code: string };
  createdBy:   { id: string; fullName: string };
  lines?:      PurchaseReturnLine[];
  _count?:     { lines: number };
}

export interface CreateReturnLineInput {
  purchaseLineId: string;
  qty:            number;
}

export interface CreateReturnInput {
  purchaseId: string;
  reason?:    string;
  lines:      CreateReturnLineInput[];
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const purchaseReturnsApi = {
  list: (purchaseId?: string, supplierId?: string): Promise<PurchaseReturn[]> =>
    api.get('/purchase-returns', { params: { ...(purchaseId ? { purchaseId } : {}), ...(supplierId ? { supplierId } : {}) } }).then((r) => r.data),

  get: (id: string): Promise<PurchaseReturn> =>
    api.get(`/purchase-returns/${id}`).then((r) => r.data),

  getDebitNote: (id: string): Promise<PurchaseReturn> =>
    api.get(`/purchase-returns/${id}/debit-note`).then((r) => r.data),

  create: (data: CreateReturnInput): Promise<PurchaseReturn> =>
    api.post('/purchase-returns', data).then((r) => r.data),

  confirm: (id: string): Promise<PurchaseReturn> =>
    api.patch(`/purchase-returns/${id}/confirm`).then((r) => r.data),

  cancel: (id: string): Promise<PurchaseReturn> =>
    api.patch(`/purchase-returns/${id}/cancel`).then((r) => r.data),

  delete: (id: string): Promise<PurchaseReturn> =>
    api.delete(`/purchase-returns/${id}`).then((r) => r.data),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  DRAFT:     'Draft',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
};

export const RETURN_STATUS_COLORS: Record<ReturnStatus, string> = {
  DRAFT:     'bg-amber-100 text-amber-700',
  CONFIRMED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

export function formatCents(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Print Debit Note ─────────────────────────────────────────────────────────

export function printDebitNote(ret: PurchaseReturn): void {
  const lines = ret.lines ?? [];
  const rows = lines.map((l) => `
    <tr>
      <td>${l.product.name}</td>
      <td>${l.product.sku}</td>
      <td style="text-align:right">${Number(l.qty)}</td>
      <td style="text-align:right">${formatCents(l.unitCostCents)}</td>
      <td style="text-align:right">${formatCents(l.lineTotalCents)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><title>${ret.number}</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 12px; margin: 24px; color: #1e293b; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
    .meta div p { margin: 2px 0; }
    .label { color: #64748b; font-size: 10px; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th { background: #f1f5f9; text-align: left; padding: 8px; font-size: 11px; }
    td { padding: 8px; border-bottom: 1px solid #e2e8f0; }
    .total { font-weight: bold; font-size: 14px; text-align: right; margin-top: 12px; }
    .status { display:inline-block; padding:2px 8px; border-radius:9999px;
              background:${ret.status==='CONFIRMED'?'#dcfce7':'#fef9c3'};
              color:${ret.status==='CONFIRMED'?'#166534':'#854d0e'}; font-size:11px; }
  </style></head><body>
  <h1>Debit Note — ${ret.number}</h1>
  <span class="status">${RETURN_STATUS_LABELS[ret.status]}</span>
  <div class="meta">
    <div>
      <p class="label">Supplier</p><p><strong>${ret.supplier.name}</strong></p>
      <p class="label" style="margin-top:8px">Original PO</p><p>${ret.purchase.number}</p>
    </div>
    <div>
      <p class="label">Warehouse</p><p>${ret.warehouse.name} (${ret.warehouse.code})</p>
      <p class="label" style="margin-top:8px">Date</p><p>${new Date(ret.createdAt).toLocaleDateString()}</p>
      ${ret.reason ? `<p class="label" style="margin-top:8px">Reason</p><p>${ret.reason}</p>` : ''}
    </div>
  </div>
  <table>
    <thead><tr>
      <th>Product</th><th>SKU</th>
      <th style="text-align:right">Qty</th>
      <th style="text-align:right">Unit Cost</th>
      <th style="text-align:right">Total</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="total">Total Credit: ${formatCents(ret.totalCents)}</p>
  <p style="margin-top:24px;color:#64748b;font-size:10px">
    Prepared by ${ret.createdBy.fullName} · ${new Date(ret.createdAt).toLocaleString()}
  </p>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 400);
}
