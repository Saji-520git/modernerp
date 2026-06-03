// Delivery module shared types. Dates are ISO strings.

export type DeliveryStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED';

// Tailwind class hints for status badges.
export const DELIVERY_STATUS_COLORS: Record<DeliveryStatus, string> = {
  PENDING:          'bg-gray-100 text-gray-700',
  ASSIGNED:         'bg-blue-100 text-blue-700',
  OUT_FOR_DELIVERY: 'bg-amber-100 text-amber-700',
  DELIVERED:        'bg-green-100 text-green-700',
  FAILED:           'bg-red-100 text-red-700',
  CANCELLED:        'bg-gray-200 text-gray-500',
};

export interface Delivery {
  id: string;
  number: string;
  saleId: string | null;
  quotationId: string | null;
  customerId: string | null;
  status: DeliveryStatus;
  scheduledAt: string | null;
  deliveredAt: string | null;
  address: string;
  contactName: string | null;
  contactPhone: string | null;
  driverName: string | null;
  driverPhone: string | null;
  note: string | null;
  createdById: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Relations
  customer?: { id: string; name: string } | null;
  sale?: { id: string; number: string } | null;
  quotation?: { id: string; number: string } | null;
  createdBy?: { fullName: string } | null;
}

export interface CreateDeliveryDto {
  saleId?: string | null;
  quotationId?: string | null;
  customerId?: string | null;
  scheduledAt?: string | null;
  address: string;
  contactName?: string | null;
  contactPhone?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  note?: string | null;
}

export interface UpdateDeliveryDto {
  scheduledAt?: string | null;
  address?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  note?: string | null;
}

export interface DeliveryStats {
  today: {
    pending: number;
    assigned: number;
    outForDelivery: number;
    delivered: number;
  };
  thisWeek: { delivered: number };
  onTimeRate: number;
}

export interface DeliveryFilters {
  status?: string;
  customerId?: string;
  driverName?: string;
  search?: string;
  from?: string;
  to?: string;
}
