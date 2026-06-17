import { api } from './api';

export type UnitType = 'COUNT' | 'WEIGHT' | 'VOLUME' | 'LENGTH' | 'OTHER';

export interface Unit {
  id:           string;
  name:         string;
  shortCode:    string;
  type:         UnitType;
  allowDecimal: boolean;
  isActive:     boolean;
  createdAt:    string;
  updatedAt:    string;
  // Distinct active products using this unit in any role (base/purchase/sales).
  // Provided by list + getById; absent on create/update responses.
  productCount?: number;
}

export interface UnitBody {
  name:         string;
  shortCode:    string;
  type:         UnitType;
  allowDecimal: boolean;
  isActive:     boolean;
}

export interface ListUnitsParams {
  search?:   string;
  type?:     UnitType;
  isActive?: 'true' | 'false' | 'all';
  page?:     number;
  pageSize?: number;
}

export interface ListUnitsResponse {
  total:    number;
  page:     number;
  pageSize: number;
  data:     Unit[];
}

export interface ProductUnitConversion {
  id:            string;
  productId:     string;
  fromUnitId:    string;
  toUnitId:      string;
  conversionQty: number;
  priceCents:    number | null;
  discountType:  string | null;
  discountValue: number | null;
  barcode:       string | null;
  isActive:      boolean;
  fromUnit:      { id: string; name: string; shortCode: string };
  toUnit:        { id: string; name: string; shortCode: string };
}

export interface ConversionLinePayload {
  fromUnitId:    string;
  toUnitId:      string;
  conversionQty: number;
  priceCents?:   number | null;
  discountType?: string | null;
  discountValue?: number | null;
  barcode?:      string | null;
}

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  COUNT:  'Count',
  WEIGHT: 'Weight',
  VOLUME: 'Volume',
  LENGTH: 'Length',
  OTHER:  'Other',
};

export const UNIT_TYPE_COLORS: Record<UnitType, string> = {
  COUNT:  'bg-blue-100 text-blue-700',
  WEIGHT: 'bg-green-100 text-green-700',
  VOLUME: 'bg-purple-100 text-purple-700',
  LENGTH: 'bg-amber-100 text-amber-700',
  OTHER:  'bg-slate-100 text-slate-700',
};

export const unitsApi = {
  list: (params?: ListUnitsParams) =>
    api.get<ListUnitsResponse>('/units', { params }).then((r: { data: ListUnitsResponse }) => r.data),

  listAll: () =>
    api.get<ListUnitsResponse>('/units', { params: { pageSize: 200, isActive: 'true' } }).then((r: { data: ListUnitsResponse }) => r.data.data),

  getById: (id: string) =>
    api.get<Unit>(`/units/${id}`).then((r: { data: Unit }) => r.data),

  create: (body: UnitBody) =>
    api.post<Unit>('/units', body).then((r: { data: Unit }) => r.data),

  update: (id: string, body: Partial<UnitBody>) =>
    api.patch<Unit>(`/units/${id}`, body).then((r: { data: Unit }) => r.data),

  softDelete: (id: string) =>
    api.delete(`/units/${id}`).then((r: { data: unknown }) => r.data),

  getConversions: (productId: string) =>
    api.get<ProductUnitConversion[]>(`/products/${productId}/conversions`).then((r: { data: ProductUnitConversion[] }) => r.data),

  setConversions: (productId: string, conversions: ConversionLinePayload[]) =>
    api.put<ProductUnitConversion[]>(`/products/${productId}/conversions`, conversions).then((r: { data: ProductUnitConversion[] }) => r.data),
};
