import { describe, expect, it } from 'vitest';
import type { ExpenseRow } from './dashboardMetrics';
import { buildMoneyReport } from './moneyReport';
import { activityKey, contributionsTo, dayFigure, dayWithout, rowsOfDay, type DayRows } from './dayExclusion';

const DATE = '2026-11-18';

function expense(id: string, amount: number, extra: Partial<ExpenseRow> = {}): ExpenseRow {
  return {
    id,
    date: DATE,
    amount,
    category: 'other',
    payment_method: 'cash',
    payment_source: 'game_club',
    comment: null,
    created_at: `${DATE}T10:00:00Z`,
    ...extra,
  };
}

// The 18 November day: club income, the Icafe payment, a bar purchase and the PlayStation.
const rows: DayRows = {
  cash: [{ id: 'income', date: DATE, cash_income: 1_791_000, terminal_income: 1_819_000, card_income: 0 }],
  expenses: [
    expense('icafe', 2_000_000, { category: 'investments' }),
    expense('cups', 100_000, { payment_source: 'bar' }),
    expense('ps5', 6_720_000, { category: 'equipment', payment_method: 'terminal', created_at: `${DATE}T18:06:00Z` }),
  ],
  debtPayments: [],
  exchanges: [],
};

const day = buildMoneyReport(rows.cash, rows.expenses).days[0];

describe('day exclusion', () => {
  it('rebuilds the same day when nothing is left out', () => {
    const rebuilt = dayWithout(rows, DATE, new Set());
    expect(rebuilt.income).toBe(3_610_000);
    expect(rebuilt.gameClubExpenses).toBe(8_720_000);
    expect(rebuilt.barExpenses).toBe(100_000);
    expect(rebuilt.total).toBe(-5_110_000);
    expect(rebuilt.cash).toBe(-209_000);
    expect(rebuilt.terminal).toBe(-4_901_000);
  });

  it('recalculates every figure without a one-off purchase', () => {
    const rebuilt = dayWithout(rows, DATE, new Set(['expense:ps5']));
    expect(rebuilt.gameClubExpenses).toBe(2_000_000);
    expect(rebuilt.total).toBe(1_610_000);
    expect(rebuilt.terminal).toBe(1_819_000);
    expect(rebuilt.cash).toBe(-209_000);
    expect(rebuilt.activities).toHaveLength(3);
  });

  it('leaves the bar out of the day total but drops it from bar expenses', () => {
    const rebuilt = dayWithout(rows, DATE, new Set(['expense:cups']));
    expect(rebuilt.barExpenses).toBe(0);
    expect(rebuilt.total).toBe(day.total);
  });

  it('gives an empty day when every entry is left out', () => {
    const all = new Set(day.activities.map(activityKey).filter((key): key is string => key !== null));
    const rebuilt = dayWithout(rows, DATE, all);
    expect(rebuilt.total).toBe(0);
    expect(rebuilt.activities).toEqual([]);
  });

  it('lists only the entries that make up a figure', () => {
    expect(Object.fromEntries(contributionsTo(rows, day, 'expenses'))).toEqual({
      'daily_cash:income': 0,
      'expense:icafe': 2_000_000,
      'expense:cups': 0,
      'expense:ps5': 6_720_000,
    });
    expect(Object.fromEntries(contributionsTo(rows, day, 'terminal'))).toEqual({
      'daily_cash:income': 1_819_000,
      'expense:icafe': 0,
      'expense:cups': 0,
      'expense:ps5': -6_720_000,
    });
  });

  it('keeps a reserve-paid expense out of Game Club expenses', () => {
    const withReserve: DayRows = { ...rows, expenses: [...rows.expenses, expense('reserve', 500_000, { paid_from_reserve: true })] };
    const reserveDay = buildMoneyReport(withReserve.cash, withReserve.expenses).days[0];
    expect(contributionsTo(withReserve, reserveDay, 'expenses').get('expense:reserve')).toBe(0);
    expect(dayFigure(reserveDay, 'expenses')).toBe(8_720_000);
  });

  it('keeps only the rows listed on a filtered day', () => {
    const otherDay = { ...rows, expenses: [...rows.expenses, expense('later', 1, { date: '2026-11-19' })] };
    const expensesOnly = buildMoneyReport([], rows.expenses.filter((row) => row.category === 'equipment')).days[0];
    const dayRows = rowsOfDay(otherDay, expensesOnly);
    expect(dayRows.cash).toEqual([]);
    expect(dayRows.expenses.map((row) => row.id)).toEqual(['ps5']);
  });
});
