import { describe, expect, it } from 'vitest';
import {
  averageByWeekday,
  bestAndWorstDays,
  buildMonthCalendar,
  mondayWeekday,
  periodProgress,
  rankShares,
  safeRatio,
  expenseTotalsByCategory,
  valuesByDate,
} from './insights';

describe('mondayWeekday', () => {
  it('numbers Monday 0 and Sunday 6', () => {
    expect(mondayWeekday('2026-11-16')).toBe(0); // Monday
    expect(mondayWeekday('2026-11-22')).toBe(6); // Sunday
  });
});

describe('averageByWeekday', () => {
  it('counts days without a row as zero and stops at the through date', () => {
    const values = new Map([['2026-11-02', 100], ['2026-11-09', 300], ['2026-11-03', 50]]);
    const result = averageByWeekday(values, { from: '2026-11-01', through: '2026-11-10' });
    expect(result[0]).toEqual({ weekday: 0, days: 2, total: 400, average: 200 });
    expect(result[1]).toEqual({ weekday: 1, days: 2, total: 50, average: 25 });
    expect(result[6]).toMatchObject({ days: 2, total: 0, average: 0 });
  });

  it('returns empty slots for a range that has not started', () => {
    const result = averageByWeekday(new Map(), { from: '2026-11-05', through: '2026-11-01' });
    expect(result.every((slot) => slot.days === 0 && slot.average === 0)).toBe(true);
  });
});

describe('buildMonthCalendar', () => {
  it('lays a month out in Monday-first weeks with levels relative to the best day', () => {
    const values = new Map([['2026-11-01', 400], ['2026-11-02', 100], ['2026-11-03', 0]]);
    const weeks = buildMonthCalendar('2026-11', values, '2026-11-03');
    // 1 November 2026 is a Sunday: six empty slots first.
    expect(weeks[0].slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(weeks[0][6]).toMatchObject({ day: 1, value: 400, level: 4 });
    expect(weeks[1][0]).toMatchObject({ day: 2, value: 100, level: 1 });
    expect(weeks[1][1]).toMatchObject({ day: 3, value: 0, level: 0 });
    expect(weeks[1][2]).toMatchObject({ day: 4, value: null, level: 0 });
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
  });

  it('shows every day as not yet happened when nothing is entered', () => {
    const weeks = buildMonthCalendar('2026-02', new Map(), null);
    expect(weeks.flat().filter(Boolean).every((cell) => cell!.value === null)).toBe(true);
  });
});

describe('rankShares', () => {
  const other = { key: 'other', label: 'Other' };
  it('sorts largest first, drops non-positive values and folds the tail', () => {
    const result = rankShares([
      { key: 'a', label: 'A', value: 10 },
      { key: 'b', label: 'B', value: 50 },
      { key: 'c', label: 'C', value: 20 },
      { key: 'd', label: 'D', value: 20 },
      { key: 'z', label: 'Z', value: -5 },
    ], 3, other);
    expect(result.map((item) => item.key)).toEqual(['b', 'c', 'other']);
    expect(result[2]).toMatchObject({ value: 30, other: true });
    expect(result.reduce((sum, item) => sum + item.share, 0)).toBeCloseTo(1);
  });

  it('keeps every item when they fit and is empty without a positive total', () => {
    expect(rankShares([{ key: 'a', label: 'A', value: 1 }], 3, other)).toEqual([{ key: 'a', label: 'A', value: 1, share: 1 }]);
    expect(rankShares([{ key: 'a', label: 'A', value: 0 }], 3, other)).toEqual([]);
  });
});

describe('periodProgress', () => {
  const range = { from: '2026-11-01', to: '2026-11-30' };
  it('counts today as elapsed', () => {
    expect(periodProgress(range, '2026-11-19')).toEqual({ elapsed: 19, total: 30, ratio: 19 / 30 });
  });
  it('is complete after the range and empty before it', () => {
    expect(periodProgress(range, '2026-12-05').ratio).toBe(1);
    expect(periodProgress(range, '2026-10-05').elapsed).toBe(0);
  });
});

describe('bestAndWorstDays', () => {
  it('ignores days without income', () => {
    const result = bestAndWorstDays(new Map([['2026-11-01', 0], ['2026-11-02', 300], ['2026-11-03', 100]]));
    expect(result).toEqual({ best: { date: '2026-11-02', value: 300 }, worst: { date: '2026-11-03', value: 100 } });
    expect(bestAndWorstDays(new Map([['2026-11-01', 0]]))).toBeNull();
  });
});

describe('safeRatio', () => {
  it('is null for a whole that is not positive', () => {
    expect(safeRatio(1, 4)).toBe(0.25);
    expect(safeRatio(1, 0)).toBeNull();
  });
});

describe('expenseTotalsByCategory', () => {
  const rows = [
    { category: 'rent', amount: 100, payment_source: 'game_club' as const },
    { category: 'rent', amount: '50', payment_source: null },
    { category: 'cleaning', amount: 30, payment_source: 'bar' as const },
    { category: 'food', amount: 200, payment_source: 'game_club' as const },
  ];
  it('keeps each side to its own expenses, largest category first', () => {
    expect(expenseTotalsByCategory(rows, 'game_club')).toEqual([{ category: 'food', value: 200 }, { category: 'rent', value: 150 }]);
    expect(expenseTotalsByCategory(rows, 'bar')).toEqual([{ category: 'cleaning', value: 30 }]);
  });
  it('leaves out expenses the owner reserve or the club dollars paid', () => {
    const paid = [
      { category: 'rent', amount: 100, payment_source: 'game_club' as const },
      { category: 'investment', amount: 900, payment_source: 'game_club' as const, paid_from_reserve: true },
      { category: 'equipment', amount: 700, payment_source: 'game_club' as const, payment_method: 'usd' },
    ];
    expect(expenseTotalsByCategory(paid, 'game_club')).toEqual([{ category: 'rent', value: 100 }]);
  });
  it('keeps reserve-paid and dollar-paid expenses when asked, so categories add up to the accounting expenses', () => {
    const paid = [
      { category: 'rent', amount: 100, payment_source: 'game_club' as const },
      { category: 'investment', amount: 900, payment_source: 'game_club' as const, paid_from_reserve: true },
      { category: 'equipment', amount: 700, payment_source: 'game_club' as const, payment_method: 'usd' },
      { category: 'cleaning', amount: 40, payment_source: 'bar' as const, paid_from_reserve: true },
    ];
    const gameClub = expenseTotalsByCategory(paid, 'game_club', { includeReservePaid: true });
    expect(gameClub).toEqual([
      { category: 'investment', value: 900 },
      { category: 'equipment', value: 700 },
      { category: 'rent', value: 100 },
    ]);
    expect(gameClub.reduce((sum, row) => sum + row.value, 0)).toBe(1700);
    expect(expenseTotalsByCategory(paid, 'bar', { includeReservePaid: true })).toEqual([{ category: 'cleaning', value: 40 }]);
    expect(expenseTotalsByCategory(paid, 'bar')).toEqual([]);
  });
});

describe('valuesByDate', () => {
  it('sums rows that share a date', () => {
    const values = valuesByDate([{ date: 'a', v: 1 }, { date: 'a', v: 2 }, { date: 'b', v: null }], (row) => row.v);
    expect([...values]).toEqual([['a', 3], ['b', 0]]);
  });
});
