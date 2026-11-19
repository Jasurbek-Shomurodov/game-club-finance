import type { ExpenseRow } from './dashboardMetrics';
import type { MoneyExchangeRow } from './moneyExchanges';
import {
  buildMoneyReport,
  type MoneyReportActivity,
  type MoneyReportCashRow,
  type MoneyReportDay,
  type MoneyReportDebtPaymentRow,
} from './moneyReport';

/**
 * A what-if view of one closeout day: the owner leaves some entries out (a
 * one-off purchase, say) to see the day's usual picture. Nothing stored
 * changes; the day is rebuilt from its remaining rows with the same formulas
 * the closeout header uses.
 */

/** The figures a closeout day header shows, each one tappable. */
export type DayFigure = 'income' | 'expenses' | 'barExpenses' | 'cash' | 'terminal' | 'card' | 'playstation';

export const DAY_FIGURES: readonly DayFigure[] = ['income', 'expenses', 'barExpenses', 'cash', 'terminal', 'card', 'playstation'];

/** The rows a day was built from. */
export interface DayRows {
  cash: MoneyReportCashRow[];
  expenses: ExpenseRow[];
  debtPayments: MoneyReportDebtPaymentRow[];
  exchanges: MoneyExchangeRow[];
}

/** An entry's stable key, as the closeout table keys it; null when it has no id and cannot be left out. */
export function activityKey(activity: Pick<MoneyReportActivity, 'id' | 'source'>): string | null {
  return activity.id ? `${activity.source}:${activity.id}` : null;
}

function rowKey(source: MoneyReportActivity['source'], id: string | null | undefined): string | null {
  return id ? `${source}:${id}` : null;
}

/**
 * The rows behind `day`'s entries. `rows` may hold the whole period and every
 * category: only rows listed on the day are kept, so a filtered closeout day
 * stays filtered.
 */
export function rowsOfDay(rows: DayRows, day: Pick<MoneyReportDay, 'date' | 'activities'>): DayRows {
  const keys = new Set(day.activities.map(activityKey).filter((key): key is string => key !== null));
  const listed = (source: MoneyReportActivity['source'], row: { date: string; id?: string | null }) => {
    if (row.date !== day.date) return false;
    const key = rowKey(source, row.id);
    // A row without an id cannot be matched or left out; it is always part of its day.
    return key === null || keys.has(key);
  };
  return {
    cash: rows.cash.filter((row) => listed('daily_cash', row)),
    expenses: rows.expenses.filter((row) => listed('expense', row)),
    debtPayments: rows.debtPayments.filter((row) => listed('debt_payment', row)),
    exchanges: rows.exchanges.filter((row) => listed('exchange', row)),
  };
}

function emptyDay(date: string): MoneyReportDay {
  return {
    date,
    cash: 0,
    terminal: 0,
    card: 0,
    playstation: 0,
    total: 0,
    income: 0,
    expenses: 0,
    gameClubExpenses: 0,
    barExpenses: 0,
    activities: [],
  };
}

/** The day rebuilt without the entries whose keys are in `excluded`. */
export function dayWithout(rows: DayRows, date: string, excluded: ReadonlySet<string>): MoneyReportDay {
  const kept = (source: MoneyReportActivity['source']) => (row: { id?: string | null }) => {
    const key = rowKey(source, row.id);
    return key === null || !excluded.has(key);
  };
  const report = buildMoneyReport(
    rows.cash.filter(kept('daily_cash')),
    rows.expenses.filter(kept('expense')),
    rows.debtPayments.filter(kept('debt_payment')),
    [],
    [],
    rows.exchanges.filter(kept('exchange')),
  );
  return report.days.find((day) => day.date === date) ?? emptyDay(date);
}

/** A day figure as the header shows it: expenses there are the ones Game Club money paid. */
export function dayFigure(day: MoneyReportDay, figure: DayFigure): number {
  if (figure === 'expenses') return day.gameClubExpenses;
  return day[figure];
}

/**
 * How much each entry adds to `figure`: the figure with the entry minus the
 * figure without it. An entry that does not touch the figure gives 0, so a
 * reserve-paid expense is not under Expenses and an exchange moves between
 * methods without touching income.
 */
export function contributionsTo(rows: DayRows, day: MoneyReportDay, figure: DayFigure): Map<string, number> {
  const full = dayFigure(day, figure);
  const contributions = new Map<string, number>();
  for (const activity of day.activities) {
    const key = activityKey(activity);
    if (key === null) continue;
    contributions.set(key, full - dayFigure(dayWithout(rows, day.date, new Set([key])), figure));
  }
  return contributions;
}
