import { describe, expect, it } from 'vitest';
import type { SalaryEntry } from './salaries';
import { buildSalaryCalendar, shiftYearMonth } from './salaryCalendar';

const entry = (id: string, date: string, kind: SalaryEntry['kind'], amount: number, deleted = false): SalaryEntry => ({
  id, employee_id: 'e1', date, kind, amount, comment: '', payment_method: null, payment_source: null,
  created_at: `${date}T10:00:00Z`, deleted_at: deleted ? `${date}T11:00:00Z` : null,
});

describe('shiftYearMonth', () => {
  it('crosses year boundaries both ways', () => {
    expect(shiftYearMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftYearMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftYearMonth('2026-10', 0)).toBe('2026-10');
  });
});

describe('buildSalaryCalendar', () => {
  it('lays out the Monday-first weeks the month touches, no more', () => {
    const days = buildSalaryCalendar('2026-10', [], '2026-10-27');
    expect(days).toHaveLength(35);
    expect(days.at(-1)).toMatchObject({ date: '2026-11-01', inMonth: false });
    // February 2027 starts on a Monday and fills exactly four weeks; March 2026 needs six.
    expect(buildSalaryCalendar('2027-02', [], '')).toHaveLength(28);
    expect(buildSalaryCalendar('2026-03', [], '')).toHaveLength(42);
    // 1 October 2026 is a Thursday, so the grid opens on Monday 28 September.
    expect(days[0]).toMatchObject({ date: '2026-09-28', day: 28, inMonth: false });
    expect(days[3]).toMatchObject({ date: '2026-10-01', day: 1, inMonth: true });
    expect(days.filter((day) => day.inMonth)).toHaveLength(31);
    expect(days.filter((day) => day.isToday).map((day) => day.date)).toEqual(['2026-10-27']);
  });

  it('adds each kind per day and leaves deleted entries out of the totals', () => {
    const days = buildSalaryCalendar('2026-10', [
      entry('a', '2026-10-21', 'payment', 1_000_000),
      entry('b', '2026-10-21', 'payment', 1_600_000, true),
      entry('c', '2026-10-21', 'payment', 500_000),
      entry('d', '2026-10-26', 'fine', 100_000),
      entry('e', '2026-10-26', 'bonus', 50_000),
    ], '2026-10-27');
    const day = (date: string) => days.find((d) => d.date === date)!;
    expect(day('2026-10-21')).toMatchObject({ totals: { payment: 1_500_000 }, count: 3 });
    expect(day('2026-10-26')).toMatchObject({ totals: { fine: 100_000, bonus: 50_000 }, count: 2 });
    expect(day('2026-10-22')).toMatchObject({ totals: {}, count: 0 });
  });

  it('keeps a day whose only entry was deleted selectable but empty of totals', () => {
    const days = buildSalaryCalendar('2026-10', [entry('x', '2026-10-05', 'bonus', 10, true)], '2026-10-27');
    expect(days.find((d) => d.date === '2026-10-05')).toMatchObject({ totals: {}, count: 1 });
  });
});
