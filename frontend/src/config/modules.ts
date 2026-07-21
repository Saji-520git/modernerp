import { Tag, ClipboardCheck, Gift, FileText, type LucideIcon } from 'lucide-react';

// ─── Optional feature modules (per-client on/off) ────────────────────────────
// Mirror of backend/src/config/modules.ts. Core modules are always on and not
// listed. Toggled in Settings > Modules; gates nav, routes and POS hooks.

export const OPTIONAL_MODULES = ['promotions', 'stockTake', 'loyalty', 'quotations'] as const;
export type ModuleKey = (typeof OPTIONAL_MODULES)[number];

export const MODULE_META: Record<ModuleKey, { label: string; description: string; icon: LucideIcon }> = {
  promotions: { label: 'Promotions & Offers',      description: 'Time-bound discounts and offers, auto-applied at POS.',  icon: Tag },
  stockTake:  { label: 'Stock-take / Cycle count', description: 'Physical count sheets that reconcile inventory variance.', icon: ClipboardCheck },
  loyalty:    { label: 'Loyalty Points',           description: 'Customers earn and redeem points on purchases.',          icon: Gift },
  quotations: { label: 'Quotations',               description: 'Create quotes and convert them to sales.',                icon: FileText },
};

export type ModuleFlags = Partial<Record<ModuleKey, boolean>>;
