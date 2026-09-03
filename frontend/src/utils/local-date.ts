// ─── Local calendar dates (browser side) ──────────────────────────────────────
//
// The mirror of backend/src/utils/local-date.ts. That file fixed the READ side —
// filtering a shop's day by its own calendar. This one fixes the WRITE side,
// which had the same bug from the other end.
//
// Two traps, both of which shipped:
//
// 1. `new Date().toISOString().slice(0, 10)` as "today". It renders the instant
//    in UTC, so anywhere AHEAD of UTC the small hours of the morning still read
//    as yesterday. In Colombo (UTC+5:30) every date picker defaulted to the
//    PREVIOUS day between 00:00 and 05:30. PO-2026-0008 was raised at 00:14 on
//    2 Sept and filed under 1 Sept because of exactly this.
//
// 2. `new Date('2026-09-03').toISOString()` to send a picked date. A date-ONLY
//    string is parsed by JS as UTC midnight, never local midnight. Stored and
//    read back in Colombo that instant is 05:30 AM — which is why every manual
//    invoice on the Sales page showed a 05:30 AM timestamp it never had.
//
// `<input type="date">` always gives and takes `YYYY-MM-DD` in LOCAL terms, so
// these helpers are what belongs on both sides of it.

/** `YYYY-MM-DD` for the LOCAL calendar day containing `d`. */
export function toLocalYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today's LOCAL date as `YYYY-MM-DD`. The replacement for `toISOString().slice(0, 10)`. */
export function todayLocalYMD(): string {
  return toLocalYMD(new Date());
}

/** `YYYY-MM-DD` for the local day `n` days before today (n may be negative). */
export function localYMDDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toLocalYMD(d);
}

/** First day of the current LOCAL month, as `YYYY-MM-DD`. */
export function localMonthStartYMD(): string {
  const d = new Date();
  return toLocalYMD(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Local midnight at the start of `ymd`. */
export function localDayStart(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Turn a date picker's `YYYY-MM-DD` into the ISO instant to send for a
 * TRANSACTION date (invoice, purchase order, payment).
 *
 * When the chosen day is today the current time is kept, so a document records
 * the moment it was actually raised — the till has always done this, and the
 * manual forms silently threw it away. Any other day has no meaningful time of
 * day, so it anchors to local midnight; that reads back as 12:00 AM on the
 * shop's clock rather than the 05:30 AM a UTC-midnight instant produces.
 *
 * Total by design: a transaction always happened at some instant, so an empty
 * picker means "now" rather than "unknown". That also matches what every
 * backend create already does with a missing date, so nothing changes shape.
 */
export function ymdToTransactionISO(ymd?: string | null): string {
  const now = new Date();
  if (!ymd || ymd === toLocalYMD(now)) return now.toISOString();
  return localDayStart(ymd).toISOString();
}

/**
 * Turn a date picker's `YYYY-MM-DD` into the ISO instant for a DATE-ONLY field
 * (expiry, valid-until, opening-balance-as-of) — always local midnight, because
 * no time of day is meant.
 */
export function ymdToLocalMidnightISO(ymd: string | undefined | null): string | undefined {
  if (!ymd) return undefined;
  return localDayStart(ymd).toISOString();
}

/**
 * `YYYY-MM-DD` for a value coming BACK from the API, for use as a date input's
 * value. Accepts a Date, an ISO string, or null.
 */
export function apiDateToYMD(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : toLocalYMD(d);
}
