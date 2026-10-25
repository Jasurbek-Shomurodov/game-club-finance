import { getAverageIncomeDayCounts, sumGameClubRows, type ExpenseRow } from './dashboardMetrics';
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

type Side = 'gameClub' | 'bar';

function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function previousMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const absolute = year * 12 + monthNumber - 2;
  return `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, '0')}`;
}

export interface SideForecast {
  /** Days from the month start through the side's latest entry; 0 without any entry. */
  daysCounted: number;
  incomeToDate: number;
  profitToDate: number;
  /** Month-end figures if the rest of the month keeps this month's daily pace; null without entries. */
  projectedIncome: number | null;
  projectedProfit: number | null;
  lastMonthIncome: number;
  lastMonthProfit: number;
}

export interface ForecastDayRow {
  day: number;
  /** Cumulative money in; actual through the counted days, projected after them, null where not drawn. */
  gameClubActual: number | null;
  gameClubProjected: number | null;
  gameClubLastMonth: number | null;
  barActual: number | null;
  barProjected: number | null;
  barLastMonth: number | null;
}

export interface MonthForecast {
  month: string;
  daysInMonth: number;
  gameClub: SideForecast;
  bar: SideForecast;
  days: ForecastDayRow[];
}

/**
 * The business month so far and where it ends at its current pace: each side's
 * money in and profit per counted day (through that side's latest entry, as
 * "average daily income" counts them), stretched over the whole month. Last
 * month's running money in is drawn alongside by day of month.
 */
export function buildMonthForecast(businessToday: string, ledgers: AnalysisLedgers): MonthForecast {
  const month = businessToday.slice(0, 7);
  const length = daysInMonth(month);
  const range = { from: `${month}-01`, to: businessToday };
  const lastMonth = previousMonth(month);
  const lastRange = { from: `${lastMonth}-01`, to: `${lastMonth}-${String(daysInMonth(lastMonth)).padStart(2, '0')}` };
  const current = buildDailyAnalysis(range, ledgers);
  const previous = buildDailyAnalysis(lastRange, ledgers);
  const dayCounts = getAverageIncomeDayCounts(range, {
    cashRows: ledgers.cashRows.filter((row) => row.date >= range.from && row.date <= range.to),
    debtRows: ledgers.debtRows.filter((row) => row.date !== undefined && row.date >= range.from && row.date <= range.to),
    stockRows: ledgers.stockRows.filter((row) => row.date >= range.from && row.date <= range.to),
  });

  const incomeOf = (side: Side, row: (typeof current)[number]) => (side === 'gameClub' ? row.gameClubIncome : row.barSales);
  const spentOf = (side: Side, row: (typeof current)[number]) => (
    side === 'gameClub' ? row.gameClubExpenses : row.barCost + row.barExpenses
  );
  const sideForecast = (side: Side): SideForecast => {
    const incomeToDate = current.reduce((total, row) => total + incomeOf(side, row), 0);
    const profitToDate = current.reduce((total, row) => total + incomeOf(side, row) - spentOf(side, row), 0);
    const daysCounted = incomeToDate > 0 ? dayCounts[side] : 0;
    const scale = daysCounted ? length / daysCounted : 0;
    return {
      daysCounted,
      incomeToDate,
      profitToDate,
      projectedIncome: daysCounted ? Math.round(incomeToDate * scale) : null,
      projectedProfit: daysCounted ? Math.round(profitToDate * scale) : null,
      lastMonthIncome: previous.reduce((total, row) => total + incomeOf(side, row), 0),
      lastMonthProfit: previous.reduce((total, row) => total + incomeOf(side, row) - spentOf(side, row), 0),
    };
  };
  const gameClub = sideForecast('gameClub');
  const bar = sideForecast('bar');

  const running = (side: Side, rows: typeof current) => {
    let total = 0;
    return rows.map((row) => (total += incomeOf(side, row)));
  };
  const actual = { gameClub: running('gameClub', current), bar: running('bar', current) };
  const before = { gameClub: running('gameClub', previous), bar: running('bar', previous) };
  const line = (side: Side, forecast: SideForecast, day: number) => {
    const counted = forecast.daysCounted;
    const reached = counted ? actual[side][counted - 1] : 0;
    const pace = counted ? reached / counted : 0;
    return {
      actual: counted && day <= counted ? actual[side][day - 1] : null,
      projected: counted && day >= counted ? Math.round(reached + pace * (day - counted)) : null,
      lastMonth: day <= before[side].length ? before[side][day - 1] : null,
    };
  };

  return {
    month,
    daysInMonth: length,
    gameClub,
    bar,
    days: Array.from({ length }, (_, index) => {
      const day = index + 1;
      const club = line('gameClub', gameClub, day);
      const barLine = line('bar', bar, day);
      return {
        day,
        gameClubActual: club.actual,
        gameClubProjected: club.projected,
        gameClubLastMonth: club.lastMonth,
        barActual: barLine.actual,
        barProjected: barLine.projected,
        barLastMonth: barLine.lastMonth,
      };
    }),
  };
}

export interface YearOverYear {
  /** Calendar years in the history, oldest first. */
  years: string[];
  /** One row per calendar month (1–12) with each year's money in, absent where that month has no history. */
  rows: Array<{ month: number } & Record<string, number>>;
}

/** One side's money in by calendar month, one series per year. */
export function buildYearOverYear(rows: MonthlyAnalysisRow[], side: Side): YearOverYear {
  const years = Array.from(new Set(rows.map((row) => row.month.slice(0, 4)))).sort();
  const byMonth = Array.from({ length: 12 }, (_, index) => ({ month: index + 1 }) as { month: number } & Record<string, number>);
  for (const row of rows) {
    byMonth[Number(row.month.slice(5, 7)) - 1][row.month.slice(0, 4)] = side === 'gameClub' ? row.gameClubIncome : row.barSales;
  }
  return { years, rows: byMonth };
}

export interface HeatmapCell {
  date: string;
  /** Money in that day; null for a day after the range end or before its start. */
  value: number | null;
  /** 0 = no money in, 1–4 = quartile of the days that had money in. */
  level: 0 | 1 | 2 | 3 | 4;
}

/**
 * One side's money in per day as a calendar: one column per Monday-first week
 * (the last `weeks` weeks through the range end), one row per weekday.
 */
export function buildCalendarHeatmap(
  range: { from: string; to: string },
  ledgers: AnalysisLedgers,
  side: Side,
  weeks = WEEK_WINDOW,
): { weeks: Array<{ start: string; days: HeatmapCell[] }>; max: number } {
  const firstMonday = shiftDate(periodStart(range.to, 'week'), -7 * (weeks - 1));
  const shown = { from: firstMonday > range.from ? firstMonday : range.from, to: range.to };
  const values = new Map(buildDailyAnalysis(shown, ledgers).map((row) => [row.date, side === 'gameClub' ? row.gameClubIncome : row.barSales]));
  const sorted = Array.from(values.values()).filter((value) => value > 0).sort((a, b) => a - b);
  const threshold = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
  const cuts = sorted.length ? [threshold(0.25), threshold(0.5), threshold(0.75)] : [];
  const levelOf = (value: number): HeatmapCell['level'] => {
    if (value <= 0) return 0;
    if (value < cuts[0]) return 1;
    if (value < cuts[1]) return 2;
    if (value < cuts[2]) return 3;
    return 4;
  };
  const columns = Array.from({ length: weeks }, (_, week) => {
    const start = shiftDate(firstMonday, week * 7);
    return {
      start,
      days: Array.from({ length: 7 }, (_, weekday): HeatmapCell => {
        const date = shiftDate(start, weekday);
        const value = values.get(date);
        return value === undefined ? { date, value: null, level: 0 } : { date, value, level: levelOf(value) };
      }),
    };
  });
  // A history shorter than the window starts at its first week, not with empty columns.
  const first = columns.findIndex((column) => column.days.some((day) => day.value !== null));
  return { max: sorted.at(-1) ?? 0, weeks: first < 0 ? [] : columns.slice(first) };
}
