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
