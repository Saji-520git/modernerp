import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProductCategory { id: string; name: string }
export interface ProductBrand    { id: string; name: string }
export interface ProductUnit     { id: string; name: string; shortCode: string }

export interface ProductStock {
  qty: string;           // Prisma Decimal comes as string
  warehouseId: string;
  warehouse: { name: string; code: string };
}

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  categoryId: string | null;
  category: ProductCategory | null;
  brandId: string | null;
  brand: ProductBrand | null;
  unitId: string;
  unit: ProductUnit;
  // Unit conversion fields (null = not configured yet)
  baseUnitId:     string | null;
  purchaseUnitId: string | null;
  salesUnitId:    string | null;
  costEntryUnitId: string | null;
  priceEntryUnitId: string | null;
  baseUnit:     ProductUnit | null;
  purchaseUnit: ProductUnit | null;
  salesUnit:    ProductUnit | null;
  unitConversions?: Array<{
    fromUnitId: string;
    toUnitId: string;
    conversionQty: number;
    fromUnit: { shortCode: string };
  }>;
  costCents: number;           // weighted-average cost per base unit
  lastCostCents: number;       // most recent receipt cost per base unit — G1
  priceCents: number;
  defaultDiscountCents: number;
  serviceChargeCents: number;
  serviceChargeLabel: string | null;
  serviceChargeMode: string;
  receiptName: string | null;
  taxPercent: number;
  reorderLevel: number;
  reorderQty: number;
  isActive: boolean;
  imageUrl: string | null;
  expiryDate: string | null;
  expiryAlertDays: number;
  isBatchTracked: boolean;
  defaultSupplierId: string | null;
  stock: ProductStock[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductMeta {
  categories: ProductCategory[];
  brands: ProductBrand[];
  units: ProductUnit[];
}

export interface ProductListResponse {
  total: number;
  page: number;
  pageSize: number;
  data: Product[];
}

export interface CreateProductPayload {
  name: string;
  sku?: string;
  barcode?: string | null;
  description?: string | null;
  categoryId?: string | null;
  brandId?: string | null;
  unitId: string;
  baseUnitId?:     string | null;
  purchaseUnitId?: string | null;
  salesUnitId?:    string | null;
  costEntryUnitId?: string | null;
  priceEntryUnitId?: string | null;
  costCents: number;
  priceCents: number;
  defaultDiscountCents?: number;
  serviceChargeCents?: number;
  serviceChargeLabel?: string | null;
  serviceChargeMode?: string;
  receiptName?: string | null;
  taxPercent: number;
  reorderLevel: number;
  reorderQty?: number;
  isActive: boolean;
  imageUrl?: string | null;
  expiryDate?: string | null;
  expiryAlertDays?: number;
  isBatchTracked?: boolean;
  defaultSupplierId?: string | null;
}

export type UpdateProductPayload = Partial<CreateProductPayload>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatCents(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function totalStock(product: Product): number {
  return product.stock.reduce((s, w) => s + Number(w.qty), 0);
}

export function marginPct(product: Product): number {
  if (product.priceCents === 0) return 0;
  return Math.round(((product.priceCents - product.costCents) / product.priceCents) * 1000) / 10;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const productsApi = {
  list: (params?: {
    search?: string;
    categoryId?: string;
    brandId?: string;
    isActive?: 'true' | 'false' | 'all';
    page?: number;
    pageSize?: number;
  }): Promise<ProductListResponse> =>
    api.get('/products', { params }).then((r) => r.data),

  getById: (id: string): Promise<Product> =>
    api.get(`/products/${id}`).then((r) => r.data),

  /** Exact barcode lookup — returns Product or throws 404 */
  getByBarcode: (barcode: string): Promise<Product> =>
    api.get(`/products/by-barcode/${encodeURIComponent(barcode)}`).then((r) => r.data.product),

  create: (data: CreateProductPayload): Promise<Product> =>
    api.post('/products', data).then((r) => r.data),

  update: (id: string, data: UpdateProductPayload): Promise<Product> =>
    api.patch(`/products/${id}`, data).then((r) => r.data),

  toggleActive: (id: string): Promise<{ id: string; isActive: boolean; name: string }> =>
    api.patch(`/products/${id}/toggle-active`).then((r) => r.data),

  /** Smart delete — backend hard-deletes if no history, else soft-deletes. */
  remove: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/products/${id}`).then((r) => r.data),

  meta: (): Promise<ProductMeta> =>
    api.get('/products/meta').then((r) => r.data),

  exportCsv: async (): Promise<void> => {
    const res = await api.get('/products/export/csv', { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Deferred, not immediate: Electron opens a Save dialog and does not read
    // the blob until the user picks a folder, so revoking here would pull the
    // data out from under an open dialog. Same reason as the backup download.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
