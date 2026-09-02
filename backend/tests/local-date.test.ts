import { localDayStart, localDayEnd, localDayRange, toLocalYMD } from '../src/utils/local-date';

// These assert LOCAL-day semantics, so they must hold in whatever timezone the
// machine runs in — never hard-code a UTC offset.
const tzOffsetMin = -new Date().getTimezoneOffset();

describe('localDayStart / localDayEnd', () => {
  it('starts a day at local midnight, not UTC midnight', () => {
    const d = localDayStart('2026-09-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);          // September
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it('ends a day at the last local millisecond', () => {
    const d = localDayEnd('2026-09-01');
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });

  it('differs from the UTC parse wherever the machine is not on UTC', () => {
    // This is the bug in one line: `new Date('2026-09-01')` is UTC midnight,
    // which is NOT local midnight anywhere east or west of Greenwich.
    const utcParse = new Date('2026-09-01');
    if (tzOffsetMin !== 0) {
      expect(localDayStart('2026-09-01').getTime()).not.toBe(utcParse.getTime());
    }
    // Whatever the zone, the local start must format back to the same day.
    expect(toLocalYMD(localDayStart('2026-09-01'))).toBe('2026-09-01');
    expect(toLocalYMD(localDayEnd('2026-09-01'))).toBe('2026-09-01');
  });

  it('covers the whole day and nothing of the next', () => {
    const start = localDayStart('2026-09-01');
    const end   = localDayEnd('2026-09-01');
    const nextStart = localDayStart('2026-09-02');
    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect(end.getTime()).toBe(nextStart.getTime() - 1);
  });

  it('keeps an early-morning local instant inside its own day', () => {
    // The regression: a 00:20 sale used to fall outside a filter for its own
    // date, because the UTC window did not open until 05:30 local.
    const early = new Date(2026, 8, 1, 0, 20, 0);
    expect(early >= localDayStart('2026-09-01')).toBe(true);
    expect(early <= localDayEnd('2026-09-01')).toBe(true);
    // ...and is NOT inside the previous day's range, which is where the UTC
    // window used to file it.
    expect(early <= localDayEnd('2026-08-31')).toBe(false);
  });

  it('keeps a late-evening local instant inside its own day', () => {
    const late = new Date(2026, 8, 1, 23, 50, 0);
    expect(late <= localDayEnd('2026-09-01')).toBe(true);
    expect(late >= localDayStart('2026-09-02')).toBe(false);
  });

  it('handles month and year boundaries', () => {
    expect(toLocalYMD(localDayEnd('2026-01-31'))).toBe('2026-01-31');
    expect(toLocalYMD(localDayEnd('2026-12-31'))).toBe('2026-12-31');
    expect(toLocalYMD(localDayStart('2026-03-01'))).toBe('2026-03-01');
    expect(toLocalYMD(localDayEnd('2028-02-29'))).toBe('2028-02-29');   // leap year
  });

  it('passes a non-date-only string through to the Date parser', () => {
    const iso = '2026-09-01T10:30:00Z';
    expect(localDayStart(iso).getTime()).toBe(new Date(iso).getTime());
  });
});

describe('localDayRange', () => {
  it('is undefined when neither end is given', () => {
    expect(localDayRange()).toBeUndefined();
    expect(localDayRange(null, null)).toBeUndefined();
    expect(localDayRange('', '')).toBeUndefined();
  });

  it('builds an inclusive range across both ends', () => {
    const r = localDayRange('2026-09-01', '2026-09-03')!;
    expect(toLocalYMD(r.gte!)).toBe('2026-09-01');
    expect(toLocalYMD(r.lte!)).toBe('2026-09-03');
    expect(r.gte!.getHours()).toBe(0);
    expect(r.lte!.getHours()).toBe(23);
  });

  it('supports an open start or an open end', () => {
    const onlyTo = localDayRange(undefined, '2026-09-03')!;
    expect(onlyTo.gte).toBeUndefined();
    expect(toLocalYMD(onlyTo.lte!)).toBe('2026-09-03');

    const onlyFrom = localDayRange('2026-09-01', undefined)!;
    expect(onlyFrom.lte).toBeUndefined();
    expect(toLocalYMD(onlyFrom.gte!)).toBe('2026-09-01');
  });

  it('a single-day range includes the entire day', () => {
    const r = localDayRange('2026-09-01', '2026-09-01')!;
    const morning = new Date(2026, 8, 1, 0, 0, 1);
    const night   = new Date(2026, 8, 1, 23, 59, 59);
    expect(morning >= r.gte! && morning <= r.lte!).toBe(true);
    expect(night   >= r.gte! && night   <= r.lte!).toBe(true);
  });

  it('excludes the neighbouring days', () => {
    const r = localDayRange('2026-09-01', '2026-09-01')!;
    const prevNight = new Date(2026, 7, 31, 23, 59, 59);
    const nextDawn  = new Date(2026, 8, 2, 0, 0, 0);
    expect(prevNight >= r.gte!).toBe(false);
    expect(nextDawn  <= r.lte!).toBe(false);
  });
});
