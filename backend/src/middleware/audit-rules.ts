// ─── Audit trail: what gets recorded, and how it reads ────────────────────────
//
// Split out from audit.ts so it can be tested without a database. Everything
// here is pure: the decisions the trail depends on — what is scrubbed, what is
// skipped, what the action is called — are exactly the parts that must not be
// wrong, and the least useful to verify by inspection.

/** Fields scrubbed from any recorded body, at any depth. */
export const REDACT = new Set([
  'password', 'currentPassword', 'newPassword', 'confirmPassword',
  'passwordHash', 'token', 'accessToken', 'refreshToken', 'secret', 'apiKey',
]);

/** Bodies whose JSON exceeds this are dropped rather than stored. */
export const MAX_META_CHARS = 4000;

/** Longest array kept in full before it is summarised. */
const MAX_ARRAY_ITEMS = 20;

/**
 * Copy of a request body with credentials removed and long arrays summarised.
 *
 * Recursive, because the sensitive field is rarely at the top: a user update
 * nests the password one level down, and a bulk import nests it per row.
 */
export function redact(value: unknown, depth = 0): unknown {
  // Primitives pass through at any depth.
  if (value === null || typeof value !== 'object') return value;
  // Past the cap, objects are replaced rather than returned as they are. The
  // old check returned the value itself, which meant the cap capped nothing:
  // a deep body was copied whole, and a self-referencing one survived into the
  // output and threw on JSON.stringify.
  if (depth > 4) return '[nested]';
  if (Array.isArray(value)) {
    // A 300-line invoice says nothing extra past the first few; keep the shape.
    const head = value.slice(0, MAX_ARRAY_ITEMS).map((v) => redact(v, depth + 1));
    return value.length > MAX_ARRAY_ITEMS
      ? [...head, `…and ${value.length - MAX_ARRAY_ITEMS} more`]
      : head;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.has(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

/**
 * First path segment — "sales", "purchases", "settings". Enough to answer "what
 * happened to invoices today" without every service having to declare itself.
 */
export function entityOf(path: string): string {
  const seg = path.split('?')[0].split('/').filter(Boolean);
  return seg[0] ?? 'unknown';
}

/**
 * The record acted on: a cuid or uuid anywhere in the path. Words and numbers
 * (`/sales/:id/payments`, `/settings`) are route structure, not an id.
 */
export function entityIdOf(path: string): string | null {
  const seg = path.split('?')[0].split('/').filter(Boolean);
  const id = seg.find((s) => /^c[a-z0-9]{20,}$/i.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s));
  return id ?? null;
}

/**
 * The verb, from the method and the tail of the route.
 *
 * POST /sales/:id/confirm is a confirmation, not a creation, and recording it
 * as CREATE would make the trail describe something that never happened.
 */
export function actionOf(method: string, path: string): string {
  const tail = path.split('?')[0].split('/').filter(Boolean).at(-1)?.toLowerCase() ?? '';
  const VERBS: Record<string, string> = {
    confirm: 'CONFIRM', cancel: 'CANCEL', void: 'CANCEL', close: 'CLOSE',
    open: 'OPEN', login: 'LOGIN', logout: 'LOGOUT', restore: 'RESTORE',
    'write-off': 'WRITE_OFF', adjustments: 'ADJUST', transfers: 'TRANSFER',
    permissions: 'PERMISSIONS', 'toggle-active': 'TOGGLE_ACTIVE',
  };
  if (VERBS[tail]) return VERBS[tail];
  if (method.toUpperCase() === 'POST')   return 'CREATE';
  if (method.toUpperCase() === 'DELETE') return 'DELETE';
  return 'UPDATE';
}

/** Changes state, but carries no audit value — recording it would only add noise. */
const SKIP = [
  /^\/auth\/refresh/,          // fires on a timer, says nothing about intent
  /^\/alerts\/.*\/read$/,      // marking a notification read
  /^\/alerts\/read-all$/,
];

/**
 * Whether a request should be recorded at all.
 *
 * Reads are excluded because GET is the overwhelming majority of traffic and
 * says nothing about who changed what — logging it would bury the entries that
 * matter. A 4xx is excluded because it changed nothing. A 5xx is KEPT: the
 * write may have partly landed, which is exactly when someone needs to know who
 * was doing what.
 */
export function shouldRecord(method: string, path: string, status: number): boolean {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  if (SKIP.some((re) => re.test(path))) return false;
  if (status >= 400 && status < 500) return false;
  return true;
}
