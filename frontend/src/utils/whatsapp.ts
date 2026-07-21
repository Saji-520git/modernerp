// ─── WhatsApp helpers ──────────────────────────────────────────────────────────
// Pure, side-effect-free utilities (except openWhatsApp) for building wa.me deep
// links and filling message templates. No network, no dependencies.

/**
 * Normalise a phone number to the bare digit string wa.me expects (country code
 * + subscriber number, no '+', no spaces).
 *
 * Rules:
 *  - leading '+'      → strip '+', keep digits; valid only if 7–15 digits (foreign preserved)
 *  - '0XXXXXXXXX' (10)→ Sri Lanka local: '94' + the 9 digits after the leading 0
 *  - '94XXXXXXXXX'(11)→ already normalised, unchanged
 *  - 10–15 digits     → returned as-is
 *  - anything else    → '' (caller treats empty as "no link")
 */
export function formatWAPhone(phone: string | null | undefined): string {
  if (!phone || typeof phone !== 'string') return '';
  const trimmed = phone.trim();

  // International input: strip the '+' and any non-digits, validate length.
  if (trimmed.startsWith('+')) {
    const intl = trimmed.replace(/\D/g, '');
    return intl.length >= 7 && intl.length <= 15 ? intl : '';
  }

  const digits = trimmed.replace(/\D/g, '');

  // '00' international prefix (e.g. 0094771234567) — strip and treat like '+'.
  if (digits.startsWith('00') && digits.length > 2) {
    const intl = digits.slice(2);
    return intl.length >= 7 && intl.length <= 15 ? intl : '';
  }

  if (digits.length === 10 && digits.startsWith('0')) {
    return '94' + digits.slice(1);
  }
  if (digits.length === 11 && digits.startsWith('94')) {
    return digits;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return digits;
  }
  return '';
}

/** Max length of the percent-encoded `text` query value before we truncate. */
const WA_TEXT_ENCODED_LIMIT = 1800;
const WA_TRUNCATION_SUFFIX  = '\n...(truncated)';

/**
 * Build a `https://wa.me/<number>?text=<encoded>` link. Returns '' when the
 * phone cannot be normalised. The encoded message (including a truncation
 * marker) is capped at WA_TEXT_ENCODED_LIMIT bytes.
 */
export function buildWALink(phone: string | null | undefined, msg: string): string {
  const number = formatWAPhone(phone);
  if (!number) return '';

  let text = msg ?? '';
  if (encodeURIComponent(text).length > WA_TEXT_ENCODED_LIMIT) {
    // Walk the raw string back until the encoded form (plus the suffix) fits.
    let truncated = text;
    while (
      truncated.length > 0 &&
      encodeURIComponent(truncated + WA_TRUNCATION_SUFFIX).length > WA_TEXT_ENCODED_LIMIT
    ) {
      truncated = truncated.slice(0, -1);
    }
    text = truncated + WA_TRUNCATION_SUFFIX;
  }

  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/**
 * Build a `whatsapp://send?phone=<number>&text=<encoded>` deep link — this opens
 * the installed WhatsApp Desktop app directly (no browser hop). Shares the same
 * phone normalisation + message truncation as buildWALink. Returns '' when the
 * phone cannot be normalised.
 */
export function buildWADesktopLink(phone: string | null | undefined, msg: string): string {
  const link = buildWALink(phone, msg);
  if (!link) return '';
  // Reuse buildWALink's normalised number + truncated/encoded text, then swap
  // the scheme so there is a single source of truth for both behaviours.
  const number = link.slice('https://wa.me/'.length, link.indexOf('?'));
  const text   = link.slice(link.indexOf('?text=') + '?text='.length);
  return `whatsapp://send?phone=${number}&text=${text}`;
}

/** Where a WhatsApp link should open. */
export type WAOpenMode = 'app' | 'browser';

/** Replace every `{key}` occurrence in `tpl` with `vars[key]` (empty for nullish). */
export function fillTemplate(
  tpl: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  let out = tpl;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(String(value ?? ''));
  }
  return out;
}

export interface WAItemLine {
  name: string;
  qty: number;
  lineTotalCents: number;
}

/**
 * Render cart/receipt lines as a plain-text bullet list for a message body.
 * Caps at 20 rows, clips each name to 30 chars, and appends an
 * "...and N more items" line when the list was capped.
 */
export function buildItemsList(lines: WAItemLine[]): string {
  const MAX_ROWS = 20;
  const shown = lines.slice(0, MAX_ROWS);
  const rows = shown.map((l) => {
    const name  = l.name.length > 30 ? l.name.slice(0, 30) : l.name;
    const total = (l.lineTotalCents / 100).toFixed(2);
    return `- ${name} x${l.qty} Rs.${total}`;
  });
  if (lines.length > MAX_ROWS) {
    rows.push(`- ...and ${lines.length - MAX_ROWS} more items`);
  }
  return rows.join('\n');
}

/**
 * Open a WhatsApp chat. `mode` decides the target:
 *   'app'     → whatsapp:// deep link → WhatsApp Desktop app directly (default)
 *   'browser' → https://wa.me link → default browser → WhatsApp Web
 * Silent no-op if the phone can't be normalised. In the desktop build, Electron's
 * setWindowOpenHandler routes both schemes to shell.openExternal.
 */
export function openWhatsApp(
  phone: string | null | undefined,
  msg: string,
  mode: WAOpenMode = 'app',
): void {
  const link = mode === 'browser' ? buildWALink(phone, msg) : buildWADesktopLink(phone, msg);
  if (!link) return;
  window.open(link, '_blank');
}

// ─── Default message templates ──────────────────────────────────────────────────
// Editable per business in Settings → WhatsApp. Placeholders in {braces} are
// filled via fillTemplate() at send time.

export const DEFAULT_RECEIPT_TEMPLATE =
  `Hi {customerName}, thank you for shopping at {businessName}! 🛍️\n\n` +
  `Receipt {invoiceNumber} — {date}\n` +
  `{items}\n\n` +
  `Total: {total}\n\n` +
  `We appreciate your business.`;

export const DEFAULT_OUTSTANDING_TEMPLATE =
  `Hi {customerName}, a friendly reminder from {businessName}.\n\n` +
  `Your current outstanding balance is {outstanding}.\n\n` +
  `Please settle at your earliest convenience. Thank you!`;

// Supplier direction — we owe THEM, so the wording is a payment assurance,
// not a "please settle" request. Placeholder key is {supplierName}.
export const DEFAULT_PAYABLE_TEMPLATE =
  `Hi {supplierName}, this is {businessName}.\n\n` +
  `Our current payable balance to you is {outstanding}.\n\n` +
  `We'll settle it shortly. Thank you for your patience.`;

export const DEFAULT_OFFER_TEMPLATE =
  `Hi {customerName}! 🎉\n\n` +
  `{businessName} has a special offer for you:\n` +
  `{offer}\n\n` +
  `Visit us soon!`;
