// ─── Promotions engine ───────────────────────────────────────────────────────
// Pure, DB-free discount calculator. Every promotion resolves to per-line
// discount contributions so they fold cleanly into the existing POS checkout
// math (each becomes additional SaleLine.discountCents). Server-authoritative:
// checkout calls this itself and never trusts client-sent promo numbers.
//
// v1 types: PERCENT_OFF (per matching line) · AMOUNT_OFF (flat off the matching
// subset, distributed proportionally). Stacking: non-stackable promos compete
// per line (best value wins, priority breaks ties); stackable promos add on top.
// All money is integer cents.

export interface PromoCartLine {
  lineKey: string;                 // stable per-line id (caller-chosen)
  productId: string;
  categoryId: string | null;
  brandId: string | null;
  qty: number;                     // in the sold unit
  lineAfterManualCents: number;    // line subtotal AFTER manual discount — promo base
}

export interface PromoInput {
  id: string;
  name: string;
  type: string;                    // 'PERCENT_OFF' | 'AMOUNT_OFF'
  scope: string;                   // 'ALL' | 'CATEGORY' | 'BRAND' | 'PRODUCT'
  scopeCategoryId: string | null;
  scopeBrandId: string | null;
  scopeProductId: string | null;
  value: number;                   // percent (0-100) or cents
  minQty: number | null;
  minCartCents: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  priority: number;
  stackable: boolean;
  maxDiscountCents: number | null;
  active: boolean;
  usageLimit: number | null;
  timesUsed: number;
}

export interface AppliedPromo { promotionId: string; label: string; discountCents: number; }

export interface PromoResult {
  lineDiscounts: Record<string, number>; // lineKey → additional promo discount (cents)
  applied: AppliedPromo[];               // per-promo total (for audit + receipt)
  totalDiscountCents: number;
}

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

function withinWindow(p: PromoInput, now: Date): boolean {
  if (p.startsAt && now < p.startsAt) return false;
  if (p.endsAt && now > p.endsAt) return false;
  return true;
}

function isEligible(p: PromoInput, cartSubtotalCents: number, now: Date): boolean {
  if (!p.active) return false;
  if (!withinWindow(p, now)) return false;
  if (p.usageLimit != null && p.timesUsed >= p.usageLimit) return false;
  if (p.minCartCents != null && cartSubtotalCents < p.minCartCents) return false;
  return true;
}

function matches(p: PromoInput, line: PromoCartLine): boolean {
  switch (p.scope) {
    case 'CATEGORY': return line.categoryId != null && line.categoryId === p.scopeCategoryId;
    case 'BRAND':    return line.brandId    != null && line.brandId    === p.scopeBrandId;
    case 'PRODUCT':  return line.productId === p.scopeProductId;
    case 'ALL':
    default:         return true;
  }
}

interface Contribution {
  promotionId: string; label: string; stackable: boolean; priority: number; discountCents: number;
}

/** Cap a promo's raw per-line contributions at its maxDiscountCents, then record them. */
function recordContribs(
  raw: { lineKey: string; disc: number }[],
  promo: PromoInput,
  perLine: Record<string, Contribution[]>,
): void {
  const total = raw.reduce((s, c) => s + c.disc, 0);
  if (total <= 0) return;
  const scale = promo.maxDiscountCents != null && total > promo.maxDiscountCents
    ? promo.maxDiscountCents / total
    : 1;
  for (const c of raw) {
    const disc = Math.floor(c.disc * scale);
    if (disc <= 0) continue;
    perLine[c.lineKey].push({
      promotionId: promo.id, label: promo.name,
      stackable: promo.stackable, priority: promo.priority, discountCents: disc,
    });
  }
}

/** Distribute a flat amount across matching lines, proportional to line value. */
function distribute(total: number, lines: PromoCartLine[]): { lineKey: string; disc: number }[] {
  const subtotal = lines.reduce((s, l) => s + l.lineAfterManualCents, 0);
  if (subtotal <= 0 || total <= 0) return [];
  const out = lines.map((l) => ({ lineKey: l.lineKey, disc: Math.floor(total * l.lineAfterManualCents / subtotal) }));
  const assigned = out.reduce((s, o) => s + o.disc, 0);
  if (out.length > 0) out[0].disc += total - assigned; // remainder → first line
  return out;
}

export function computePromotions(
  lines: PromoCartLine[],
  cartSubtotalCents: number,
  promos: PromoInput[],
  now: Date = new Date(),
): PromoResult {
  const perLine: Record<string, Contribution[]> = {};
  for (const l of lines) perLine[l.lineKey] = [];

  const eligible = promos.filter((p) => isEligible(p, cartSubtotalCents, now));

  for (const promo of eligible) {
    const matching = lines.filter((l) => matches(promo, l) && l.lineAfterManualCents > 0);
    if (matching.length === 0) continue;

    if (promo.type === 'PERCENT_OFF') {
      const raw = matching
        .filter((l) => promo.minQty == null || l.qty >= promo.minQty)
        .map((l) => ({ lineKey: l.lineKey, disc: Math.floor(l.lineAfterManualCents * clampPct(promo.value) / 100) }));
      recordContribs(raw, promo, perLine);
    } else if (promo.type === 'AMOUNT_OFF') {
      const subsetQty = matching.reduce((s, l) => s + l.qty, 0);
      if (promo.minQty != null && subsetQty < promo.minQty) continue;
      const subsetTotal = matching.reduce((s, l) => s + l.lineAfterManualCents, 0);
      const promoTotal = Math.min(promo.value, subsetTotal);
      recordContribs(distribute(promoTotal, matching), promo, perLine);
    }
  }

  // Resolve stacking per line, cap at line value, attribute to promos.
  const lineDiscounts: Record<string, number> = {};
  const appliedMap: Record<string, AppliedPromo> = {};

  for (const line of lines) {
    const contribs = perLine[line.lineKey];
    lineDiscounts[line.lineKey] = 0;
    if (contribs.length === 0) continue;

    const stackables = contribs.filter((c) => c.stackable);
    let best: Contribution | null = null;
    for (const c of contribs.filter((x) => !x.stackable)) {
      if (!best || c.discountCents > best.discountCents ||
          (c.discountCents === best.discountCents && c.priority > best.priority)) {
        best = c;
      }
    }
    const chosen = best ? [...stackables, best] : [...stackables];
    const rawSum = chosen.reduce((s, c) => s + c.discountCents, 0);
    if (rawSum <= 0) continue;

    const cap = line.lineAfterManualCents;
    const scale = rawSum > cap ? cap / rawSum : 1;
    const lineSum = Math.min(rawSum, cap);
    lineDiscounts[line.lineKey] = lineSum;

    for (const c of chosen) {
      const d = Math.floor(c.discountCents * scale);
      if (d <= 0) continue;
      const a = appliedMap[c.promotionId] ?? { promotionId: c.promotionId, label: c.label, discountCents: 0 };
      a.discountCents += d;
      appliedMap[c.promotionId] = a;
    }
  }

  const applied = Object.values(appliedMap).filter((a) => a.discountCents > 0);
  const totalDiscountCents = applied.reduce((s, a) => s + a.discountCents, 0);
  return { lineDiscounts, applied, totalDiscountCents };
}
