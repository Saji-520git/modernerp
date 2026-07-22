import { api } from './api';

export interface LoyaltyConfig {
  id: string;
  isEnabled: boolean;
  pointsPerAmount: number;  // cents of spend to earn 1 point
  amountPerPoint: number;
  minRedeemPoints: number;
  pointValueCents: number;  // cents value of 1 point on redemption
  expiryDays: number | null;
}

export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  saleId: string | null;
  type: string;             // EARN | REDEEM | ADJUST
  points: number;           // signed
  balanceBefore: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
  sale?: { number: string } | null;
}

export interface CustomerLoyalty {
  balance: number;
  transactions: LoyaltyTransaction[];
}

export const loyaltyApi = {
  getConfig: (): Promise<LoyaltyConfig> =>
    api.get('/loyalty/config').then((r) => r.data),
  updateConfig: (body: Partial<LoyaltyConfig>): Promise<LoyaltyConfig> =>
    api.patch('/loyalty/config', body).then((r) => r.data),
  getCustomer: (customerId: string): Promise<CustomerLoyalty> =>
    api.get(`/loyalty/customers/${customerId}`).then((r) => r.data),
  adjust: (customerId: string, points: number, note?: string): Promise<{ balance: number }> =>
    api.post(`/loyalty/customers/${customerId}/adjust`, { points, note }).then((r) => r.data),
};
