// ─── Local calendar dates ─────────────────────────────────────────────────────
//
// A shop's day is its OWN day. "Today's revenue" means since local midnight, and
// a bar labelled the 15th means what was sold on the 15th in the shop.
//
// The trap: `date.toISOString().slice(0, 10)` looks like a date formatter and is
// not. It renders the instant in UTC, so local midnight in any timezone AHEAD of
// UTC formats as the PREVIOUS day — every figure lands one bar to the left. In
// Sri Lanka (UTC+5:30) that mislabelled every day on the reports dashboard, and
// separately, SQL DATE_TRUNC on a UTC-stored timestamp bucketed by UTC day while
// the "today" KPI beside it used local midnight, so one screen disagreed with
// itself about which day it was.
//
// Use these instead of hand-rolling either half.

/** `YYYY-MM-DD` for the LOCAL calendar day containing `d`. */
export function toLocalYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Minutes to ADD to a UTC timestamp to read it as local wall-clock time.
 * +330 for UTC+5:30. Feed this to SQL so DATE_TRUNC buckets by local day:
 *
 *   DATE_TRUNC('day', ts + make_interval(mins => $offset))
 *
 * Read per call rather than cached at import: a long-running till should follow
 * a DST change without a restart.
 */
export function localOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/** Local midnight `daysAgo` days back from today. */
export function localMidnightDaysAgo(daysAgo: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

/** `YYYY-MM-DD` exactly — anything else is passed through to the Date parser. */
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Start of a local calendar day, from a `YYYY-MM-DD` string.
 *
 * `new Date('2026-09-01')` does NOT do this: the ISO date-only form is defined
 * to parse as UTC, so in any timezone ahead of UTC it lands part-way through
 * the previous local day. Constructing from parts builds the local instant the
 * shop actually means.
 */
export function localDayStart(ymd: string): Date {
  if (!YMD.test(ymd)) return new Date(ymd);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Last millisecond of a local calendar day, from a `YYYY-MM-DD` string. */
export function localDayEnd(ymd: string): Date {
  if (!YMD.test(ymd)) return new Date(ymd);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}

/**
 * Prisma `gte`/`lte` bounds for an inclusive local date range, or undefined
 * when neither end was given.
 *
 * Every list filter used to build this by hand as
 * `gte: new Date(from)` / `lte: new Date(to + 'T23:59:59Z')` — both UTC. In
 * Colombo (UTC+5:30) asking for "1 September" therefore returned 05:30 on the
 * 1st through 05:29 on the 2nd: an early-morning sale was filed under the
 * previous day, and a sale just after midnight appeared under the wrong one.
 * The dashboard already used local midnight, so the two disagreed about what
 * "today" meant on the same screen.
 */
export function localDayRange(
  from?: string | null,
  to?: string | null,
): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: localDayStart(from) } : {}),
    ...(to   ? { lte: localDayEnd(to) }     : {}),
  };
}
