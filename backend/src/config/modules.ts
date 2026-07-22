// ─── Optional feature modules ───────────────────────────────────────────────
// Per-client on/off features. Core modules (POS, inventory, sales, purchases,
// contacts, reports, settings) are always on and NOT listed here. Keys are kept
// aligned with the future multi-tenant module layer so this ports cleanly.

export const OPTIONAL_MODULES = ['promotions', 'stockTake', 'loyalty', 'quotations', 'userManagement'] as const;
export type ModuleKey = (typeof OPTIONAL_MODULES)[number];

export const MODULE_META: Record<ModuleKey, { label: string; description: string }> = {
  promotions:     { label: 'Promotions & Offers',      description: 'Time-bound discounts and offers, auto-applied at POS.' },
  stockTake:      { label: 'Stock-take / Cycle count', description: 'Physical count sheets that reconcile inventory variance.' },
  loyalty:        { label: 'Loyalty Points',           description: 'Customers earn and redeem points on purchases.' },
  quotations:     { label: 'Quotations',               description: 'Create quotes and convert them to sales.' },
  userManagement: { label: 'User Management',          description: "Lets the client's own admin create users and assign roles." },
};

export type ModuleFlags = Partial<Record<ModuleKey, boolean>>;

/** True only when the flag map explicitly enables `key`. Default (missing) = off. */
export function isModuleEnabled(flags: unknown, key: ModuleKey): boolean {
  if (!flags || typeof flags !== 'object') return false;
  return (flags as Record<string, unknown>)[key] === true;
}
