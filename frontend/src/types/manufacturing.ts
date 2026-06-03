// Manufacturing module (Sprint 7) — BOM + Production Orders.

export interface ProductRef {
  id: string;
  name: string;
  sku: string;
  costCents?: number;
}

export interface WarehouseRef {
  id: string;
  name: string;
  code: string;
}

// ─── BOM ──────────────────────────────────────────────────────────────────────

export interface BOMLine {
  id: string;
  bomId: string;
  materialId: string;
  material: ProductRef;
  qty: number | string;       // Prisma Decimal serialises as string
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BOM {
  id: string;
  productId: string;
  product: ProductRef;
  name: string;
  yieldQty: number | string;
  notes?: string | null;
  isActive: boolean;
  lines: BOMLine[];
  materialCostCents: number;  // computed server-side
  _count?: { lines: number };
  createdAt: string;
  updatedAt: string;
}

export interface BOMLineInput {
  materialId: string;
  qty: number;
  notes?: string | null;
}

export interface CreateBOMDto {
  productId: string;
  name: string;
  yieldQty?: number;
  notes?: string | null;
  lines: BOMLineInput[];
}

export interface UpdateBOMDto {
  name?: string;
  yieldQty?: number;
  notes?: string | null;
  isActive?: boolean;
  lines?: BOMLineInput[];
}

// ─── Production orders ──────────────────────────────────────────────────────────

export type ProductionStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface ProductionOrderLine {
  id: string;
  orderId: string;
  materialId: string;
  material: ProductRef;
  plannedQty: number | string;
  actualQty: number | string;
  unitCostCents: number;
  lineCostCents: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionOrder {
  id: string;
  number: string;
  productId: string;
  product: ProductRef;
  bomId?: string | null;
  warehouseId: string;
  warehouse: WarehouseRef;
  quantity: number | string;
  status: ProductionStatus;
  totalCostCents: number;
  notes?: string | null;
  createdById: string;
  createdBy?: { fullName: string };
  startedAt?: string | null;
  completedAt?: string | null;
  lines: ProductionOrderLine[];
  _count?: { lines: number };
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductionOrderDto {
  productId: string;
  warehouseId: string;
  quantity: number;
  notes?: string | null;
}

export interface ProductionFilters {
  status?: string;
  productId?: string;
  warehouseId?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface ProductionStats {
  totalOrders: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  completedCostCents: number;
}
