import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toLocalYMD,
  todayLocalYMD,
  localYMDDaysAgo,
  localMonthStartYMD,
  localDayStart,
  ymdToTransactionISO,
  ymdToLocalMidnightISO,
  apiDateToYMD,
} from './local-date';

// These must hold in whatever timezone the machine runs in — never hard-code an
// offset. The bug being guarded against only appears AHEAD of UTC, so the
// assertions are written to be true everywhere and sharpened where they can be.
const tzOffsetMin = -new Date().getTimezoneOffset();

afterEach(() => vi.useRealTimers());

describe('toLocalYMD / todayLocalYMD', () => {
  it('formats the local calendar day', () => {
    expect(toLocalYMD(new Date(2026, 8, 3, 14, 30))).toBe('2026-09-03');
  });

  it('pads month and day', () => {
    expect(toLocalYMD(new Date(2026, 0, 5, 12, 0))).toBe('2026-01-05');
  });

  it('agrees with the local clock, not the UTC one', () => {
    const now = new Date();
    expect(todayLocalYMD()).toBe(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    );
  });
});

describe('the 00:00–05:30 regression (why this module exists)', () => {
  // 2026-09-02 00:14 local — the moment PO-2026-0008 was actually raised.
  it('returns TODAY in the small hours, where toISOString() returned yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 2, 0, 14, 0));

    expect(todayLocalYMD()).toBe('2026-09-02');

    // The old expression, shown failing wherever the machine is ahead of UTC.
    const old = new Date().toISOString().slice(0, 10);
    if (tzOffsetMin > 14) {
      expect(old).toBe('2026-09-01');       // the bug, reproduced
      expect(old).not.toBe(todayLocalYMD());
    }
  });

  it('is stable across the whole day', () => {
    for (const hour of [0, 1, 5, 6, 12, 18, 23]) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 2, hour, 30, 0));
      expect(todayLocalYMD()).toBe('2026-09-02');
      vi.useRealTimers();
    }
  });
});

describe('localDayStart', () => {
  it('is local midnight, not UTC midnight', () => {
    const d = localDayStart('2026-09-03');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(3);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('differs from the date-only Date parse anywhere off UTC', () => {
    if (tzOffsetMin !== 0) {
      expect(localDayStart('2026-09-03').getTime()).not.toBe(new Date('2026-09-03').getTime());
    }
    // Round-trips regardless of zone.
    expect(toLocalYMD(localDayStart('2026-09-03'))).toBe('2026-09-03');
  });
});

describe('ymdToTransactionISO', () => {
  it('keeps the current time when the date is today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 15, 4, 19));

    const iso = ymdToTransactionISO('2026-09-03')!;
    const back = new Date(iso);
    expect(toLocalYMD(back)).toBe('2026-09-03');
    expect(back.getHours()).toBe(15);
    expect(back.getMinutes()).toBe(4);
  });

  it('anchors a back-dated document to LOCAL midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 15, 0, 0));

    const back = new Date(ymdToTransactionISO('2026-08-31')!);
    expect(toLocalYMD(back)).toBe('2026-08-31');
    expect(back.getHours()).toBe(0);
    expect(back.getMinutes()).toBe(0);
  });

  it('never produces the 05:30 AM artefact', () => {
    // The old path: new Date('2026-08-31').toISOString() === UTC midnight,
    // which reads as 05:30 local at UTC+5:30.
    const oldWay = new Date(new Date('2026-08-31').toISOString());
    const newWay = new Date(ymdToTransactionISO('2026-08-31')!);
    if (tzOffsetMin !== 0) {
      expect(newWay.getTime()).not.toBe(oldWay.getTime());
    }
    expect(newWay.getHours()).toBe(0);
    if (tzOffsetMin === 330) {
      expect(oldWay.getHours()).toBe(5);
      expect(oldWay.getMinutes()).toBe(30);
    }
  });

  it('keeps the picked day intact for a run of dates', () => {
    for (const ymd of ['2026-01-01', '2026-02-28', '2028-02-29', '2026-12-31']) {
      expect(toLocalYMD(new Date(ymdToTransactionISO(ymd)!))).toBe(ymd);
    }
  });

  it('treats an empty picker as "now" rather than unknown', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 15, 4, 19));
    for (const empty of ['', null, undefined]) {
      const d = new Date(ymdToTransactionISO(empty));
      expect(toLocalYMD(d)).toBe('2026-09-03');
      expect(d.getHours()).toBe(15);
    }
  });
});

describe('ymdToLocalMidnightISO', () => {
  it('is always local midnight, even for today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 15, 0, 0));
    const d = new Date(ymdToLocalMidnightISO('2026-09-03')!);
    expect(d.getHours()).toBe(0);
    expect(toLocalYMD(d)).toBe('2026-09-03');
  });

  it('returns undefined for empty input', () => {
    expect(ymdToLocalMidnightISO('')).toBeUndefined();
  });
});

describe('apiDateToYMD', () => {
  it('renders an API instant on the local calendar', () => {
    const d = new Date(2026, 8, 3, 15, 4);
    expect(apiDateToYMD(d.toISOString())).toBe('2026-09-03');
    expect(apiDateToYMD(d)).toBe('2026-09-03');
  });

  it('is empty for null, undefined and rubbish', () => {
    expect(apiDateToYMD(null)).toBe('');
    expect(apiDateToYMD(undefined)).toBe('');
    expect(apiDateToYMD('not a date')).toBe('');
  });

  it('round-trips a transaction ISO back to the same picker value', () => {
    for (const ymd of ['2026-09-03', '2026-01-01', '2026-12-31']) {
      expect(apiDateToYMD(ymdToTransactionISO(ymd)!)).toBe(ymd);
    }
  });
});

describe('helpers used by report/filter defaults', () => {
  it('localMonthStartYMD is the 1st of the current local month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 17, 3, 0, 0));   // 03:00 local, mid-month
    expect(localMonthStartYMD()).toBe('2026-09-01');
  });

  it('localYMDDaysAgo counts local days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 2, 0, 0));    // 02:00 local
    expect(localYMDDaysAgo(0)).toBe('2026-09-03');
    expect(localYMDDaysAgo(1)).toBe('2026-09-02');
    expect(localYMDDaysAgo(3)).toBe('2026-08-31');
  });
});
