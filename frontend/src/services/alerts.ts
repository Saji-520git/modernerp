import { api } from './api';

export type AlertType     = 'LOW_STOCK' | 'EXPIRING_SOON' | 'EXPIRED';
export type AlertSeverity = 'WARNING' | 'CRITICAL';

export interface StockAlert {
  id:          string;
  type:        AlertType;
  severity:    AlertSeverity;
  productId:   string;
  product:     { id: string; name: string; sku: string };
  warehouseId: string | null;
  warehouse:   { id: string; name: string } | null;
  qty:         number;
  threshold:   number;
  expiryDate:  string | null;
  message:     string;
  isRead:      boolean;
  isDismissed: boolean;
  createdAt:   string;
  updatedAt:   string;
}

export interface AlertsResponse {
  items:         StockAlert[];
  total:         number;
  unreadCount:   number;
  criticalCount: number;
  page:          number;
  pageSize:      number;
}

export interface AlertCount {
  count:    number;
  critical: number;
}

export const alertsApi = {
  getAlerts: (params?: {
    type?:     AlertType;
    severity?: AlertSeverity;
    isRead?:   boolean;
    page?:     number;
    pageSize?: number;
  }): Promise<AlertsResponse> =>
    api.get<AlertsResponse>('/inventory/alerts', { params }).then(r => r.data),

  getCount: (): Promise<AlertCount> =>
    api.get<AlertCount>('/inventory/alerts/count').then(r => r.data),

  markRead: (ids: string[] | 'all'): Promise<{ success: boolean }> =>
    api.post('/inventory/alerts/read', { ids }).then(r => r.data),

  dismiss: (id: string): Promise<{ success: boolean }> =>
    api.post(`/inventory/alerts/${id}/dismiss`).then(r => r.data),

  dismissAll: (type?: AlertType): Promise<{ success: boolean }> =>
    api.post('/inventory/alerts/dismiss-all', undefined, { params: type ? { type } : undefined }).then(r => r.data),
};
