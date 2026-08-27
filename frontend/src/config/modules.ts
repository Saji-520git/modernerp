import { Tag, ClipboardCheck, Gift, FileText, UserCog, MessageCircle, Database, ShieldCheck, Download, type LucideIcon } from 'lucide-react';

// ─── Optional feature modules (per-client on/off) ────────────────────────────
// Mirror of backend/src/config/modules.ts. Core modules are always on and not
// listed. Toggled in Settings > Modules; gates nav, routes and POS hooks.

export const OPTIONAL_MODULES = ['promotions', 'stockTake', 'loyalty', 'quotations', 'userManagement', 'whatsapp', 'dataManagement', 'auditLog', 'productExport'] as const;
export type ModuleKey = (typeof OPTIONAL_MODULES)[number];

export const MODULE_META: Record<ModuleKey, { label: string; description: string; icon: LucideIcon }> = {
  promotions:     { label: 'Promotions & Offers',      description: 'Time-bound discounts and offers, auto-applied at POS.',  icon: Tag },
  stockTake:      { label: 'Stock-take / Cycle count', description: 'Physical count sheets that reconcile inventory variance.', icon: ClipboardCheck },
  loyalty:        { label: 'Loyalty Points',           description: 'Customers earn and redeem points on purchases.',          icon: Gift },
  quotations:     { label: 'Quotations',               description: 'Create quotes and convert them to sales.',                icon: FileText },
  userManagement: { label: 'User Management',          description: "Lets the client's own admin create users and assign roles.", icon: UserCog },
  whatsapp:       { label: 'WhatsApp Messaging',       description: 'Send receipts, reminders and offers to customers over WhatsApp.', icon: MessageCircle },
  dataManagement: { label: 'Data Management',          description: 'Super-admin tools to clear selected records or reset system data.', icon: Database },
  auditLog:       { label: 'Audit Trail',              description: 'Records who changed what. Read-only, and never writable through the API.', icon: ShieldCheck },
  productExport:  { label: 'Export Product Data',      description: 'Download the catalogue as a spreadsheet, in the same shape the importer reads.', icon: Download },
};

export type ModuleFlags = Partial<Record<ModuleKey, boolean>>;
