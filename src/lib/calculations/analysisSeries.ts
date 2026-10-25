import { sumGameClubRows, type ExpenseRow } from './dashboardMetrics';
import type { AvailableMoneyByMonth } from './availableMoney';
import {
  OTHER_CATEGORY,
  buildDailyAnalysis,
  type AnalysisLedgers,
  type CategoryAmount,
  type MonthlyAnalysisRow,
} from './financialAnalysis';

/**
 * Time series behind the overall analysis charts. Every series is built from
 * buildDailyAnalysis (the same per-day split the monthly view draws), grouped
 * by day, Monday-first week or calendar month. The game club and the bar keep
 * separate columns; nothing here adds the two sides together.
 */

export type Granularity = 'day' | 'week' | 'month';

/** Days drawn in the daily view; longer histories read better by week or month. */
export const DAY_WINDOW = 31;
/** Weeks drawn in the weekly view. */
export const WEEK_WINDOW = 26;

export interface PeriodSeriesRow {
  /** First day of the bucket: the date, the week's Monday or the month's first day. */
  period: string;
  /** Last day of the bucket that lies inside the analysed range. */
  end: string;
  gameClubIncome: number;
  gameClubSpent: number;
  gameClubLeft: number;
  barSales: number;
  barSpent: number;
  barLeft: number;
  /** Game club income split by source; computers + playstation + debts = gameClubIncome. */
  computers: number;
  playstation: number;
  debts: number;
  /** Running profit of each side from the first drawn bucket. */
  gameClubCumulative: number;
  barCumulative: number;
}

export interface WeekdayPatternRow {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  /** Average money in on that weekday, over the days that side recorded income. */
  gameClubAverage: number;
  barAverage: number;
  gameClubDays: number;
  barDays: number;
}

export interface OwnerMonthRow {
  month: string;
  gameClubWithdrawn: number;
  /** Earned minus withdrawn; negative when the month is overdrawn. */
  gameClubLeft: number;
  barWithdrawn: number;
  barLeft: number;
}

const amountOf = (row: { amount?: number | null }) => Number(row.amount ?? 0);

function shiftDate(date: string, days: number): string {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

/** Monday = 0 … Sunday = 6 for an ISO calendar date. */
export function weekdayOf(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** First day of the bucket a calendar date falls in. */
export function periodStart(date: string, granularity: Granularity): string {
  if (granularity === 'day') return date;
  if (granularity === 'month') return `${date.slice(0, 7)}-01`;
  return shiftDate(date, -weekdayOf(date));
}

/**
 * The part of the history a granularity draws: every month, the last
 * WEEK_WINDOW weeks (from a Monday) or the last DAY_WINDOW days.
 */
export function granularityRange(range: { from: string; to: string }, granularity: Granularity): { from: string; to: string } {
  if (granularity === 'month') return range;
  const start = granularity === 'day'
    ? shiftDate(range.to, -(DAY_WINDOW - 1))
    : shiftDate(periodStart(range.to, 'week'), -7 * (WEEK_WINDOW - 1));
  return { from: start > range.from ? start : range.from, to: range.to };
}

function sourceSplitByDay(ledgers: Pick<AnalysisLedgers, 'cashRows' | 'debtRows'>) {
  const byDay = new Map<string, { computers: number; playstation: number; debts: number }>();
  const at = (date: string) => {
    let entry = byDay.get(date);
    if (!entry) {
      entry = { computers: 0, playstation: 0, debts: 0 };
      byDay.set(date, entry);
    }
    return entry;
  };
  for (const row of ledgers.cashRows) {
    const totals = sumGameClubRows([row]);
    const entry = at(row.date);
    entry.computers += totals.computerIncome;
    entry.playstation += totals.playstationIncome;
  }
  for (const row of ledgers.debtRows) {
    if (row.date) at(row.date).debts += amountOf(row);
  }
  return byDay;
}

/** Each side's money in, spending and profit per bucket, with a running profit. */
export function buildPeriodSeries(
  range: { from: string; to: string },
  ledgers: AnalysisLedgers,
  granularity: Granularity,
): PeriodSeriesRow[] {
  const sources = sourceSplitByDay(ledgers);
  const buckets = new Map<string, PeriodSeriesRow>();
  for (const day of buildDailyAnalysis(range, ledgers)) {
    const key = periodStart(day.date, granularity);
    let row = buckets.get(key);
    if (!row) {
      row = {
        period: key,
        end: day.date,
        gameClubIncome: 0,
        gameClubSpent: 0,
        gameClubLeft: 0,
        barSales: 0,
        barSpent: 0,
        barLeft: 0,
        computers: 0,
        playstation: 0,
        debts: 0,
        gameClubCumulative: 0,
        barCumulative: 0,
      };
      buckets.set(key, row);
    }
    row.end = day.date;
    row.gameClubIncome += day.gameClubIncome;
    row.gameClubSpent += day.gameClubExpenses;
    row.barSales += day.barSales;
    row.barSpent += day.barCost + day.barExpenses;
    const split = sources.get(day.date);
    if (split) {
      row.computers += split.computers;
      row.playstation += split.playstation;
      row.debts += split.debts;
    }
  }

  let gameClubRunning = 0;
  let barRunning = 0;
  return Array.from(buckets.values()).map((row) => {
    const gameClubLeft = row.gameClubIncome - row.gameClubSpent;
    const barLeft = row.barSales - row.barSpent;
    gameClubRunning += gameClubLeft;
    barRunning += barLeft;
    return { ...row, gameClubLeft, barLeft, gameClubCumulative: gameClubRunning, barCumulative: barRunning };
  });
}

/**
 * Average money in per weekday. Only days a side recorded income count, so a
 * day nobody entered does not pull that weekday's average down.
 */
export function buildWeekdayPattern(range: { from: string; to: string }, ledgers: AnalysisLedgers): WeekdayPatternRow[] {
  const rows = Array.from({ length: 7 }, (_, weekday) => ({ weekday, gameClubTotal: 0, barTotal: 0, gameClubDays: 0, barDays: 0 }));
  for (const day of buildDailyAnalysis(range, ledgers)) {
    const row = rows[weekdayOf(day.date)];
    if (day.gameClubIncome > 0) {
      row.gameClubTotal += day.gameClubIncome;
      row.gameClubDays += 1;
    }
    if (day.barSales > 0) {
      row.barTotal += day.barSales;
      row.barDays += 1;
    }
  }
  return rows.map(({ weekday, gameClubTotal, barTotal, gameClubDays, barDays }) => ({
    weekday,
    gameClubAverage: gameClubDays ? Math.round(gameClubTotal / gameClubDays) : 0,
    barAverage: barDays ? Math.round(barTotal / barDays) : 0,
    gameClubDays,
    barDays,
  }));
}

/**
 * Operating expenses per bucket by category, folded to the given top
 * categories (anything else, "other" included, lands in "other").
 */
export function buildCategorySeries(
  range: { from: string; to: string },
  expenseRows: ExpenseRow[],
  granularity: Granularity,
  topCategories: CategoryAmount[],
): Array<{ period: string } & Record<string, number | string>> {
  const named = new Set(topCategories.map((row) => row.category).filter((key) => key !== OTHER_CATEGORY));
  const buckets = new Map<string, { period: string } & Record<string, number | string>>();
  for (let date = range.from; date <= range.to; date = shiftDate(date, 1)) {
    const key = periodStart(date, granularity);
    if (!buckets.has(key)) buckets.set(key, { period: key });
  }
  for (const row of expenseRows) {
    if (row.date < range.from || row.date > range.to) continue;
    const bucket = buckets.get(periodStart(row.date, granularity));
    if (!bucket) continue;
    const category = named.has(row.category) ? row.category : OTHER_CATEGORY;
    bucket[category] = Number(bucket[category] ?? 0) + amountOf(row);
  }
  return Array.from(buckets.values());
}

/** Each month's owner withdrawals and what is still left to take, oldest first. */
export function buildOwnerMonthSeries(balancesByMonth: AvailableMoneyByMonth): OwnerMonthRow[] {
  return Object.keys(balancesByMonth)
    .sort()
    .map((month) => {
      const { gameClub, bar } = balancesByMonth[month];
      return {
        month: `${month.slice(0, 7)}-01`,
        gameClubWithdrawn: gameClub.withdrawn,
        gameClubLeft: gameClub.available,
        barWithdrawn: bar.withdrawn,
        barLeft: bar.available,
      };
    });
}

export interface ProfitMonthRow {
  month: string;
  profit: number;
  /** profit / money in, percent with one decimal; null in a month without money in. */
  marginPct: number | null;
}

/** One side's monthly profit and margin, from the monthly analysis rows. */
export function buildProfitMonths(rows: MonthlyAnalysisRow[], side: 'gameClub' | 'bar'): ProfitMonthRow[] {
  return rows.map((row) => {
    const income = side === 'gameClub' ? row.gameClubIncome : row.barSales;
    const profit = side === 'gameClub' ? row.gameClubLeft : row.barLeft;
    return { month: row.month, profit, marginPct: income ? Math.round((profit / income) * 1000) / 10 : null };
  });
}
