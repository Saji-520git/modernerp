// Canonical starter unit set — shared by the dev seed script, the Data
// Management "Full Reset" (which wipes units), and a server-boot safety net.
// Keeping one definition avoids the three call sites drifting apart.
export const DEFAULT_UNITS = [
  { name: 'Piece',      shortCode: 'pcs',  allowDecimal: false, type: 'COUNT'  as const },
  { name: 'Kilogram',   shortCode: 'kg',   allowDecimal: true,  type: 'WEIGHT' as const },
  { name: 'Gram',       shortCode: 'g',    allowDecimal: true,  type: 'WEIGHT' as const },
  { name: 'Liter',      shortCode: 'l',    allowDecimal: true,  type: 'VOLUME' as const },
  { name: 'Milliliter', shortCode: 'ml',   allowDecimal: true,  type: 'VOLUME' as const },
  { name: 'Box',        shortCode: 'box',  allowDecimal: false, type: 'COUNT'  as const },
  { name: 'Pack',       shortCode: 'pack', allowDecimal: false, type: 'COUNT'  as const },
  { name: 'Carton',     shortCode: 'ctn',  allowDecimal: false, type: 'COUNT'  as const },
  { name: 'Bottle',     shortCode: 'btl',  allowDecimal: false, type: 'COUNT'  as const },
  { name: 'Bag',        shortCode: 'bag',  allowDecimal: false, type: 'COUNT'  as const },
  { name: 'Case',       shortCode: 'case', allowDecimal: false, type: 'COUNT'  as const },
];

interface UnitTable {
  unit: {
    count: () => Promise<number>;
    create: (args: { data: (typeof DEFAULT_UNITS)[number] }) => Promise<unknown>;
  };
}

// Seeds the starter units ONLY when the table is completely empty — never
// touches an existing unit, even one a client deliberately deactivated.
// Safe to call on every server boot and right after a full reset re-empties
// the table; a no-op the moment any unit (client-created or otherwise) exists.
export async function seedDefaultUnitsIfEmpty(tx: UnitTable): Promise<number> {
  const count = await tx.unit.count();
  if (count > 0) return 0;
  for (const u of DEFAULT_UNITS) {
    await tx.unit.create({ data: u });
  }
  return DEFAULT_UNITS.length;
}
