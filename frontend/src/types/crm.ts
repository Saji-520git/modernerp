// CRM module shared types. Money fields are integer cents; dates are ISO strings.

export type LoyaltyTxnType = 'EARN' | 'REDEEM' | 'ADJUST';
export type InteractionType = 'NOTE' | 'CALL' | 'VISIT' | 'PAYMENT_REMINDER' | 'OTHER';
export type SpendPeriod = 'all' | '30d' | '90d' | '1y';
export type PaymentBehavior = 'always_cash' | 'sometimes_credit' | 'always_credit';

// ─── Loyalty ──────────────────────────────────────────────────────────────────

export interface LoyaltyConfig {
  id: string;
  isEnabled: boolean;
  pointsPerAmount: number;
  amountPerPoint: number;
  minRedeemPoints: number;
  pointValueCents: number;
  expiryDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateLoyaltyConfigDto {
  isEnabled?: boolean;
  pointsPerAmount?: number;
  amountPerPoint?: number;
  minRedeemPoints?: number;
  pointValueCents?: number;
  expiryDays?: number | null;
}

export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  saleId: string | null;
  type: LoyaltyTxnType;
  points: number;
  balanceBefore: number;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

export interface CustomerLoyalty {
  customerId: string;
  customerName: string;
  loyaltyPoints: number;
  pointValueCents: number;
  valueCents: number;
  minRedeemPoints: number;
  isEnabled: boolean;
  transactions: LoyaltyTransaction[];
}

// ─── Price tiers ────────────────────────────────────────────────────────────

export interface PriceTier {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  _count?: { customers: number };
}

export interface CreateTierDto {
  name: string;
  description?: string | null;
  isDefault?: boolean;
  sortOrder?: number;
}

export interface UpdateTierDto {
  name?: string;
  description?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  sortOrder?: number;
}

export interface ProductPrice {
  id: string;
  productId: string;
  tierId: string;
  tierName: string;
  priceCents: number;
}

export interface SetProductPriceInput {
  tierId: string;
  priceCents: number;
}

// ─── Intelligence ───────────────────────────────────────────────────────────

export interface TopCustomer {
  customerId: string;
  name: string;
  totalSpent: number;
  orderCount: number;
  lastPurchase: string | null;
  loyaltyPoints: number;
}

export interface InactiveCustomer {
  customerId: string;
  name: string;
  lastPurchase: string;
  totalSpent: number;
}

export interface FavoriteProduct {
  productId: string;
  name: string;
  count: number;
}

export interface CustomerStats {
  customerId: string;
  name: string;
  totalSpent: number;
  orderCount: number;
  averageOrderValue: number;
  lastPurchase: string | null;
  firstPurchase: string | null;
  favoriteProducts: FavoriteProduct[];
  paymentBehavior: PaymentBehavior;
  loyaltyPoints: number;
  loyaltyValueCents: number;
}

export interface OwnerDashboard {
  totalCustomers: number;
  newThisMonth: number;
  topSpenderThisMonth: { name: string; amount: number } | null;
  totalLoyaltyPointsOutstanding: number;
  loyaltyLiabilityCents: number;
  customersAtRisk: number;
  creditExposureCents: number;
}

// ─── Interactions ───────────────────────────────────────────────────────────

export interface CustomerInteraction {
  id: string;
  customerId: string;
  type: InteractionType;
  note: string;
  followUpAt: string | null;
  isDone: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PendingFollowUp extends CustomerInteraction {
  customer: { id: string; name: string };
}

export interface AddInteractionDto {
  customerId: string;
  type: InteractionType;
  note: string;
  followUpAt?: string | null;
}
