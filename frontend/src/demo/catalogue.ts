// ─── Fictional demo catalogue — hardware & building supplies ──────────────────
//
// EVERY name, phone number and figure in this file is invented for the demo.
// No customer, supplier, product cost or trading figure from any real
// installation appears here, by design. Prices are plausible Sri Lankan retail
// values in LKR, stored as integer cents like the rest of the system.
//
// Brand and supplier names are deliberate composites that do not correspond to
// real companies.

export interface CatUnit {
  id: string; name: string; shortCode: string; allowDecimal: boolean;
  type: 'COUNT' | 'WEIGHT' | 'VOLUME' | 'LENGTH' | 'OTHER';
}

export const UNITS: CatUnit[] = [
  { id: 'unit_pcs',  name: 'Piece',    shortCode: 'pcs',  allowDecimal: false, type: 'COUNT'  },
  { id: 'unit_box',  name: 'Box',      shortCode: 'box',  allowDecimal: false, type: 'COUNT'  },
  { id: 'unit_bag',  name: 'Bag',      shortCode: 'bag',  allowDecimal: false, type: 'COUNT'  },
  { id: 'unit_kg',   name: 'Kilogram', shortCode: 'kg',   allowDecimal: true,  type: 'WEIGHT' },
  { id: 'unit_l',    name: 'Litre',    shortCode: 'L',    allowDecimal: true,  type: 'VOLUME' },
  { id: 'unit_m',    name: 'Metre',    shortCode: 'm',    allowDecimal: true,  type: 'LENGTH' },
  { id: 'unit_roll', name: 'Roll',     shortCode: 'roll', allowDecimal: false, type: 'COUNT'  },
];

export const CATEGORIES = [
  { id: 'cat_cement',   name: 'Cement & Aggregates' },
  { id: 'cat_paint',    name: 'Paint & Finishes' },
  { id: 'cat_plumbing', name: 'Plumbing' },
  { id: 'cat_electric', name: 'Electrical' },
  { id: 'cat_tools',    name: 'Tools & Hardware' },
  { id: 'cat_roofing',  name: 'Roofing & Sheets' },
];

export const BRANDS = [
  { id: 'brd_lankastar', name: 'LankaStar' },
  { id: 'brd_novabuild', name: 'NovaBuild' },
  { id: 'brd_hiltona',   name: 'Hiltona' },
  { id: 'brd_prestige',  name: 'Prestige Works' },
  { id: 'brd_kandyan',   name: 'Kandyan Steel' },
  { id: 'brd_generic',   name: 'Unbranded' },
];

export const WAREHOUSES = [
  { id: 'wh_main', name: 'Gampola Main Store', code: 'MAIN', city: 'Gampola', isDefault: true,  type: 'STORE' },
  { id: 'wh_yard', name: 'Back Yard Store',    code: 'YARD', city: 'Gampola', isDefault: false, type: 'WAREHOUSE' },
];

export interface CatProduct {
  id: string; sku: string; barcode: string; name: string;
  categoryId: string; brandId: string; unitId: string;
  costCents: number; priceCents: number;
  reorderLevel: number; reorderQty: number;
  /** qty on hand at seed time, keyed by warehouse id */
  stock: Record<string, number>;
  isBatchTracked?: boolean;
  /** months from today until the nearest batch expires; batch-tracked only */
  expiryMonths?: number;
  /** Box -> base-unit conversion: how many base units in one box */
  boxOf?: number;
}

// Costs sit a believable 18-30% below price. Nothing here is anyone's real margin.
export const PRODUCTS: CatProduct[] = [
  // ── Cement & aggregates ──
  { id: 'p_cem_opc', sku: 'CEM-OPC-50', barcode: '4791234500011', name: 'OPC Cement 50kg Bag', categoryId: 'cat_cement', brandId: 'brd_lankastar', unitId: 'unit_bag', costCents: 212000, priceCents: 265000, reorderLevel: 40, reorderQty: 200, stock: { wh_main: 180, wh_yard: 320 } },
  { id: 'p_cem_mas', sku: 'CEM-MAS-50', barcode: '4791234500028', name: 'Masonry Cement 50kg Bag', categoryId: 'cat_cement', brandId: 'brd_lankastar', unitId: 'unit_bag', costCents: 178000, priceCents: 224000, reorderLevel: 30, reorderQty: 150, stock: { wh_main: 96, wh_yard: 140 } },
  { id: 'p_sand_rv', sku: 'AGG-SND-CUB', barcode: '4791234500035', name: 'River Sand (per cube)', categoryId: 'cat_cement', brandId: 'brd_generic', unitId: 'unit_pcs', costCents: 1750000, priceCents: 2200000, reorderLevel: 4, reorderQty: 10, stock: { wh_main: 6, wh_yard: 11 } },
  { id: 'p_agg_met', sku: 'AGG-MET-34', barcode: '4791234500042', name: 'Metal Chips 3/4in (per cube)', categoryId: 'cat_cement', brandId: 'brd_generic', unitId: 'unit_pcs', costCents: 1520000, priceCents: 1950000, reorderLevel: 3, reorderQty: 8, stock: { wh_main: 4, wh_yard: 7 } },

  // ── Paint & finishes (batch-tracked, real shelf life) ──
  { id: 'p_pnt_em4', sku: 'PNT-EMU-4L', barcode: '4791234500059', name: 'Emulsion Paint White 4L', categoryId: 'cat_paint', brandId: 'brd_novabuild', unitId: 'unit_pcs', costCents: 372000, priceCents: 480000, reorderLevel: 12, reorderQty: 48, stock: { wh_main: 34, wh_yard: 18 }, isBatchTracked: true, expiryMonths: 22 },
  { id: 'p_pnt_em1', sku: 'PNT-EMU-1L', barcode: '4791234500066', name: 'Emulsion Paint White 1L', categoryId: 'cat_paint', brandId: 'brd_novabuild', unitId: 'unit_pcs', costCents: 105000, priceCents: 138000, reorderLevel: 20, reorderQty: 60, stock: { wh_main: 52, wh_yard: 24 }, isBatchTracked: true, expiryMonths: 20 },
  { id: 'p_pnt_enm', sku: 'PNT-ENM-1L', barcode: '4791234500073', name: 'Gloss Enamel Brilliant White 1L', categoryId: 'cat_paint', brandId: 'brd_novabuild', unitId: 'unit_pcs', costCents: 128000, priceCents: 169000, reorderLevel: 15, reorderQty: 48, stock: { wh_main: 28, wh_yard: 12 }, isBatchTracked: true, expiryMonths: 4 },
  { id: 'p_pnt_und', sku: 'PNT-UND-4L', barcode: '4791234500080', name: 'Wall Undercoat 4L', categoryId: 'cat_paint', brandId: 'brd_novabuild', unitId: 'unit_pcs', costCents: 289000, priceCents: 375000, reorderLevel: 10, reorderQty: 30, stock: { wh_main: 21, wh_yard: 9 }, isBatchTracked: true, expiryMonths: 15 },
  { id: 'p_pnt_thn', sku: 'PNT-THN-1L', barcode: '4791234500097', name: 'Paint Thinner 1L', categoryId: 'cat_paint', brandId: 'brd_generic', unitId: 'unit_pcs', costCents: 52000, priceCents: 71000, reorderLevel: 24, reorderQty: 72, stock: { wh_main: 64, wh_yard: 30 } },
  { id: 'p_pnt_brs', sku: 'PNT-BRS-3IN', barcode: '4791234500103', name: 'Paint Brush 3in', categoryId: 'cat_paint', brandId: 'brd_prestige', unitId: 'unit_pcs', costCents: 27000, priceCents: 39000, reorderLevel: 30, reorderQty: 120, stock: { wh_main: 88, wh_yard: 40 }, boxOf: 12 },

  // ── Plumbing ──
  { id: 'p_plb_p2', sku: 'PLB-PVC-2IN', barcode: '4791234500110', name: 'PVC Pipe 2in x 6m', categoryId: 'cat_plumbing', brandId: 'brd_hiltona', unitId: 'unit_pcs', costCents: 112000, priceCents: 145000, reorderLevel: 20, reorderQty: 80, stock: { wh_main: 46, wh_yard: 74 } },
  { id: 'p_plb_p4', sku: 'PLB-PVC-4IN', barcode: '4791234500127', name: 'PVC Pipe 4in x 6m', categoryId: 'cat_plumbing', brandId: 'brd_hiltona', unitId: 'unit_pcs', costCents: 268000, priceCents: 342000, reorderLevel: 15, reorderQty: 60, stock: { wh_main: 22, wh_yard: 38 } },
  { id: 'p_plb_elb', sku: 'PLB-ELB-2IN', barcode: '4791234500134', name: 'PVC Elbow 2in', categoryId: 'cat_plumbing', brandId: 'brd_hiltona', unitId: 'unit_pcs', costCents: 9500, priceCents: 14000, reorderLevel: 50, reorderQty: 300, stock: { wh_main: 240, wh_yard: 160 }, boxOf: 50 },
  { id: 'p_plb_tee', sku: 'PLB-TEE-2IN', barcode: '4791234500141', name: 'PVC Tee 2in', categoryId: 'cat_plumbing', brandId: 'brd_hiltona', unitId: 'unit_pcs', costCents: 11500, priceCents: 17000, reorderLevel: 50, reorderQty: 300, stock: { wh_main: 186, wh_yard: 120 }, boxOf: 50 },
  { id: 'p_plb_tap', sku: 'PLB-TAP-BIB', barcode: '4791234500158', name: 'Brass Bib Tap 1/2in', categoryId: 'cat_plumbing', brandId: 'brd_prestige', unitId: 'unit_pcs', costCents: 86000, priceCents: 118000, reorderLevel: 20, reorderQty: 60, stock: { wh_main: 41, wh_yard: 15 } },
  { id: 'p_plb_sol', sku: 'PLB-SOL-500', barcode: '4791234500165', name: 'PVC Solvent Cement 500ml', categoryId: 'cat_plumbing', brandId: 'brd_hiltona', unitId: 'unit_pcs', costCents: 64000, priceCents: 87000, reorderLevel: 15, reorderQty: 48, stock: { wh_main: 9, wh_yard: 4 }, isBatchTracked: true, expiryMonths: 8 },

  // ── Electrical ──
  { id: 'p_ele_w15', sku: 'ELE-WIR-15', barcode: '4791234500172', name: 'Copper Wire 1.5mm 100m Coil', categoryId: 'cat_electric', brandId: 'brd_kandyan', unitId: 'unit_roll', costCents: 685000, priceCents: 890000, reorderLevel: 8, reorderQty: 30, stock: { wh_main: 17, wh_yard: 11 } },
  { id: 'p_ele_w25', sku: 'ELE-WIR-25', barcode: '4791234500189', name: 'Copper Wire 2.5mm 100m Coil', categoryId: 'cat_electric', brandId: 'brd_kandyan', unitId: 'unit_roll', costCents: 1042000, priceCents: 1340000, reorderLevel: 6, reorderQty: 24, stock: { wh_main: 12, wh_yard: 8 } },
  { id: 'p_ele_led', sku: 'ELE-LED-9W', barcode: '4791234500196', name: 'LED Bulb 9W Daylight', categoryId: 'cat_electric', brandId: 'brd_prestige', unitId: 'unit_pcs', costCents: 24000, priceCents: 36000, reorderLevel: 40, reorderQty: 200, stock: { wh_main: 156, wh_yard: 90 }, boxOf: 20 },
  { id: 'p_ele_swt', sku: 'ELE-SWT-1G', barcode: '4791234500202', name: 'Wall Switch 1-Gang', categoryId: 'cat_electric', brandId: 'brd_prestige', unitId: 'unit_pcs', costCents: 21000, priceCents: 32000, reorderLevel: 40, reorderQty: 200, stock: { wh_main: 132, wh_yard: 70 }, boxOf: 20 },
  { id: 'p_ele_skt', sku: 'ELE-SKT-13A', barcode: '4791234500219', name: '13A Socket Outlet', categoryId: 'cat_electric', brandId: 'brd_prestige', unitId: 'unit_pcs', costCents: 38000, priceCents: 55000, reorderLevel: 30, reorderQty: 120, stock: { wh_main: 74, wh_yard: 45 }, boxOf: 20 },
  { id: 'p_ele_cbr', sku: 'ELE-MCB-32A', barcode: '4791234500226', name: 'MCB Circuit Breaker 32A', categoryId: 'cat_electric', brandId: 'brd_kandyan', unitId: 'unit_pcs', costCents: 96000, priceCents: 135000, reorderLevel: 15, reorderQty: 60, stock: { wh_main: 6, wh_yard: 3 } },

  // ── Tools & hardware ──
  { id: 'p_tls_ham', sku: 'TLS-HAM-500', barcode: '4791234500233', name: 'Claw Hammer 500g', categoryId: 'cat_tools', brandId: 'brd_prestige', unitId: 'unit_pcs', costCents: 118000, priceCents: 165000, reorderLevel: 10, reorderQty: 40, stock: { wh_main: 23, wh_yard: 12 } },
  { id: 'p_tls_tap', sku: 'TLS-TAP-5M', barcode: '4791234500240', name: 'Measuring Tape 5m', categoryId: 'cat_tools', brandId: 'brd_prestige', unitId: 'unit_pcs', costCents: 48000, priceCents: 72000, reorderLevel: 20, reorderQty: 80, stock: { wh_main: 57, wh_yard: 28 } },
  { id: 'p_tls_trw', sku: 'TLS-TRW-STD', barcode: '4791234500257', name: 'Mason Trowel 10in', categoryId: 'cat_tools', brandId: 'brd_prestige', unitId: 'unit_pcs', costCents: 62000, priceCents: 92000, reorderLevel: 15, reorderQty: 60, stock: { wh_main: 34, wh_yard: 16 } },
  { id: 'p_tls_nal', sku: 'TLS-NAL-3IN', barcode: '4791234500264', name: 'Wire Nails 3in (per kg)', categoryId: 'cat_tools', brandId: 'brd_kandyan', unitId: 'unit_kg', costCents: 42000, priceCents: 58000, reorderLevel: 40, reorderQty: 200, stock: { wh_main: 118, wh_yard: 210 } },
  { id: 'p_tls_scr', sku: 'TLS-SCR-2IN', barcode: '4791234500271', name: 'Wood Screws 2in (per kg)', categoryId: 'cat_tools', brandId: 'brd_kandyan', unitId: 'unit_kg', costCents: 58000, priceCents: 79000, reorderLevel: 25, reorderQty: 100, stock: { wh_main: 64, wh_yard: 88 } },
  { id: 'p_tls_pdl', sku: 'TLS-PDL-BAR', barcode: '4791234500288', name: 'Crowbar 24in', categoryId: 'cat_tools', brandId: 'brd_kandyan', unitId: 'unit_pcs', costCents: 145000, priceCents: 198000, reorderLevel: 8, reorderQty: 24, stock: { wh_main: 11, wh_yard: 6 } },

  // ── Roofing & sheets ──
  { id: 'p_rof_asb', sku: 'ROF-ASB-8FT', barcode: '4791234500295', name: 'Roofing Sheet 8ft Corrugated', categoryId: 'cat_roofing', brandId: 'brd_lankastar', unitId: 'unit_pcs', costCents: 428000, priceCents: 545000, reorderLevel: 20, reorderQty: 80, stock: { wh_main: 38, wh_yard: 62 } },
  { id: 'p_rof_rdg', sku: 'ROF-RDG-STD', barcode: '4791234500301', name: 'Ridge Cover Standard', categoryId: 'cat_roofing', brandId: 'brd_lankastar', unitId: 'unit_pcs', costCents: 186000, priceCents: 245000, reorderLevel: 15, reorderQty: 60, stock: { wh_main: 26, wh_yard: 31 } },
  { id: 'p_rof_gut', sku: 'ROF-GUT-3M', barcode: '4791234500318', name: 'PVC Gutter 3m', categoryId: 'cat_roofing', brandId: 'brd_hiltona', unitId: 'unit_pcs', costCents: 158000, priceCents: 212000, reorderLevel: 12, reorderQty: 48, stock: { wh_main: 19, wh_yard: 24 } },
  { id: 'p_rof_hok', sku: 'ROF-HOK-J', barcode: '4791234500325', name: 'J-Hook Roofing Bolt', categoryId: 'cat_roofing', brandId: 'brd_kandyan', unitId: 'unit_pcs', costCents: 6500, priceCents: 10000, reorderLevel: 100, reorderQty: 500, stock: { wh_main: 420, wh_yard: 380 }, boxOf: 100 },
];

// ── Suppliers — invented trading names ────────────────────────────────────────
export const SUPPLIERS = [
  { id: 'sup_lanka', name: 'LankaStar Distributors (Pvt) Ltd', phone: '0812 234 561', email: 'orders@lankastar-demo.lk', address: '148 Peradeniya Road, Kandy' },
  { id: 'sup_nova',  name: 'NovaBuild Paints Agency',          phone: '0812 234 562', email: 'sales@novabuild-demo.lk',  address: '22 Trincomalee Street, Kandy' },
  { id: 'sup_hilt',  name: 'Hiltona Plastics Agencies',        phone: '0342 234 563', email: 'info@hiltona-demo.lk',     address: '9 Negombo Road, Kelaniya' },
  { id: 'sup_kandy', name: 'Kandyan Steel & Wire Co.',         phone: '0812 234 564', email: 'kandyansteel@demo.lk',     address: '76 Katugastota Road, Kandy' },
  { id: 'sup_upcty', name: 'Up-Country Hardware Supplies',     phone: '0812 234 565', email: 'upcountry@demo.lk',        address: '31 Nawalapitiya Road, Gampola' },
];

// ── Customers — invented names and numbers ───────────────────────────────────
export const CUSTOMERS = [
  { id: 'cus_ranjith', name: 'Ranjith Bandara',        phone: '0771 234 001', creditEnabled: true,  creditLimitCents: 15000000 },
  { id: 'cus_silva',   name: 'Silva Construction',     phone: '0771 234 002', creditEnabled: true,  creditLimitCents: 50000000 },
  { id: 'cus_fathima', name: 'Fathima Rizwan',         phone: '0771 234 003', creditEnabled: false, creditLimitCents: 0 },
  { id: 'cus_perera',  name: 'M. Perera & Sons',       phone: '0771 234 004', creditEnabled: true,  creditLimitCents: 25000000 },
  { id: 'cus_nuwan',   name: 'Nuwan Jayasuriya',       phone: '0771 234 005', creditEnabled: false, creditLimitCents: 0 },
  { id: 'cus_greenv',  name: 'Greenview Builders',     phone: '0771 234 006', creditEnabled: true,  creditLimitCents: 40000000 },
  { id: 'cus_kamala',  name: 'Kamala Wijeratne',       phone: '0771 234 007', creditEnabled: false, creditLimitCents: 0 },
  { id: 'cus_asiri',   name: 'Asiri Hardware (Trade)', phone: '0771 234 008', creditEnabled: true,  creditLimitCents: 30000000 },
  { id: 'cus_thilak',  name: 'Thilak Gunasekara',      phone: '0771 234 009', creditEnabled: false, creditLimitCents: 0 },
  { id: 'cus_mount',   name: 'Mountview Estate Works', phone: '0771 234 010', creditEnabled: true,  creditLimitCents: 20000000 },
];

export const EXPENSE_CATEGORIES = [
  { id: 'exc_rent',  name: 'Shop Rent',           color: '#6366f1' },
  { id: 'exc_wages', name: 'Staff Wages',         color: '#0ea5e9' },
  { id: 'exc_util',  name: 'Electricity & Water', color: '#f59e0b' },
  { id: 'exc_trans', name: 'Transport & Fuel',    color: '#10b981' },
  { id: 'exc_misc',  name: 'General / Misc',      color: '#94a3b8' },
];
