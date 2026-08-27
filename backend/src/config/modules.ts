// ─── Optional feature modules ───────────────────────────────────────────────
// Per-client on/off features. Core modules (POS, inventory, sales, purchases,
// contacts, reports, settings) are always on and NOT listed here. Keys are kept
// aligned with the future multi-tenant module layer so this ports cleanly.

export const OPTIONAL_MODULES = ['promotions', 'stockTake', 'loyalty', 'quotations', 'userManagement', 'whatsapp', 'dataManagement', 'auditLog', 'productExport'] as const;
export type ModuleKey = (typeof OPTIONAL_MODULES)[number];

export const MODULE_META: Record<ModuleKey, { label: string; description: string }> = {
  promotions:     { label: 'Promotions & Offers',      description: 'Time-bound discounts and offers, auto-applied at POS.' },
  stockTake:      { label: 'Stock-take / Cycle count', description: 'Physical count sheets that reconcile inventory variance.' },
  loyalty:        { label: 'Loyalty Points',           description: 'Customers earn and redeem points on purchases.' },
  quotations:     { label: 'Quotations',               description: 'Create quotes and convert them to sales.' },
  userManagement: { label: 'User Management',          description: "Lets the client's own admin create users and assign roles." },
  whatsapp:       { label: 'WhatsApp Messaging',       description: 'Send receipts, reminders and offers to customers over WhatsApp.' },
  dataManagement: { label: 'Data Management',          description: 'Super-admin tools to clear selected records or reset system data.' },
  auditLog:       { label: 'Audit Trail',              description: 'Records who changed what. Read-only, and never writable through the API.' },
  productExport:  { label: 'Export Product Data',      description: 'Download the catalogue as a spreadsheet, in the same shape the importer reads.' },
};

export type ModuleFlags = Partial<Record<ModuleKey, boolean>>;

/** True only when the flag map explicitly enables `key`. Default (missing) = off. */
export function isModuleEnabled(flags: unknown, key: ModuleKey): boolean {
  if (!flags || typeof flags !== 'object') return false;
  return (flags as Record<string, unknown>)[key] === true;
}
