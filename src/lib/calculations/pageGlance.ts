/**
 * "At a glance" figures for the daily cash, salaries, bar stock, collected
 * money and owner profit pages. Pure and side-specific: the game club and the
 * bar are never added together here.
 */
import { previousYearMonth } from '@/lib/utils';
import { calculateGameClubIncome } from './dailyCash';
import { summarizeStockRow, type StockTotalsRowInput } from './stock';

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

function parseYearMonth(yearMonth: string): { year: number; month: number } {
  const match = MONTH_PATTERN.exec(yearMonth);
  if (!match) throw new Error(`Invalid year-month: ${yearMonth}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** `count` months ending with `yearMonth`, oldest first. */
export function recentYearMonths(yearMonth: string, count: number): string[] {
  const months: string[] = [];
  let current = yearMonth;
  for (let index = 0; index < Math.max(0, count); index += 1) {
    months.unshift(current);
    current = previousYearMonth(current);
  }
  return months;
}

function daysInMonth(yearMonth: string): number {
  const { year, month } = parseYearMonth(yearMonth);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Relative change from `before` to `now`; null when there is nothing to compare with. */
export function changeRatio(now: number, before: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null;
  return (now - before) / Math.abs(before);
}

export interface DailyCashGlanceEntry {
  date: string;
  cash_income: number | null;
  terminal_income: number | null;
  card_income: number | null;
  playstation_income: number | null;
}

export type DailyCashMethod = 'cash' | 'terminal' | 'card' | 'playstation';

export interface DailyCashMonthGlance {
  yearMonth: string;
  total: number;
  byMethod: Record<DailyCashMethod, number>;
  /** Each entered day's total. */
  values: Map<string, number>;
  /** Days of the month through `through` (inclusive) that should have an entry. */
  expectedDays: number;
  enteredDays: number;
  /** Days through `through` without an entry, oldest first. */
  missingDates: string[];
  /** Average of the entered days, 0 when none was entered. */
  averagePerEnteredDay: number;
  /** Projected month total at the entered days' average, null before the month starts. */
  projectedTotal: number | null;
}

const entryTotal = (entry: DailyCashGlanceEntry) => calculateGameClubIncome({
  cashIncome: Number(entry.cash_income ?? 0),
  terminalIncome: Number(entry.terminal_income ?? 0),
  cardIncome: Number(entry.card_income ?? 0),
  playstationIncome: Number(entry.playstation_income ?? 0),
});

/**
 * The month's Game Club income from the daily cash entries, which days are
 * still missing an entry up to `through` (the business today), and a
 * projection at the current daily average. Entries outside the month are
 * ignored, so a wider query is safe.
 */
export function dailyCashMonthGlance(entries: readonly DailyCashGlanceEntry[], yearMonth: string, through: string): DailyCashMonthGlance {
  const total = daysInMonth(yearMonth);
  const byMethod: Record<DailyCashMethod, number> = { cash: 0, terminal: 0, card: 0, playstation: 0 };
  const values = new Map<string, number>();
  for (const entry of entries) {
    if (entry.date.slice(0, 7) !== yearMonth) continue;
    byMethod.cash += Number(entry.cash_income ?? 0);
    byMethod.terminal += Number(entry.terminal_income ?? 0);
    byMethod.card += Number(entry.card_income ?? 0);
    byMethod.playstation += Number(entry.playstation_income ?? 0);
    values.set(entry.date, (values.get(entry.date) ?? 0) + entryTotal(entry));
  }
  const monthStart = `${yearMonth}-01`;
  const monthEnd = `${yearMonth}-${String(total).padStart(2, '0')}`;
  const lastDay = through < monthStart ? 0 : through > monthEnd ? total : Number(through.slice(8, 10));
  const missingDates: string[] = [];
  for (let day = 1; day <= lastDay; day += 1) {
    const date = `${yearMonth}-${String(day).padStart(2, '0')}`;
    if (!values.has(date)) missingDates.push(date);
  }
  const sum = byMethod.cash + byMethod.terminal + byMethod.card + byMethod.playstation;
  const enteredDays = values.size;
  const averagePerEnteredDay = enteredDays ? sum / enteredDays : 0;
  return {
    yearMonth,
    total: sum,
    byMethod,
    values,
    expectedDays: lastDay,
    enteredDays,
    missingDates,
    averagePerEnteredDay,
    projectedTotal: lastDay === 0 ? null : lastDay >= total ? sum : Math.round(averagePerEnteredDay * total),
  };
}

/** Sum of `values` on days 1 … `lastDay` of `yearMonth` (a month to date). */
export function monthToDateTotal(values: ReadonlyMap<string, number>, yearMonth: string, lastDay: number): number {
  const limit = Math.min(lastDay, daysInMonth(yearMonth));
  let sum = 0;
  for (const [date, value] of values) {
    if (date.slice(0, 7) === yearMonth && Number(date.slice(8, 10)) <= limit) sum += value;
  }
  return sum;
}

export interface MonthPair {
  month: string;
  first: number;
  second: number;
}

/**
 * Two figures per month for `months` (oldest first), zero where a month has
 * no row, so a bar chart always shows a continuous run of months.
 */
export function monthlyPairs<T>(
  months: readonly string[],
  byMonth: ReadonlyMap<string, T> | Readonly<Record<string, T>>,
  pick: (row: T) => { first: number; second: number },
): MonthPair[] {
  const lookup = (month: string): T | undefined => (byMonth instanceof Map ? byMonth.get(month) : (byMonth as Record<string, T>)[month]);
  return months.map((month) => {
    const row = lookup(month);
    const values = row === undefined ? { first: 0, second: 0 } : pick(row);
    return { month, first: values.first, second: values.second };
  });
}

export interface StockGlanceRow {
  id: string;
  name: string;
  category: string;
  input: StockTotalsRowInput;
}

export interface StockGlanceProduct {
  id: string;
  name: string;
  quantity: number;
  income: number;
}

export interface StockGlance {
  /** Stock value at cost per category, largest first. */
  valueByCategory: Array<{ category: string; value: number }>;
  /** Products by the day's bar income, largest first (only those that sold). */
  topSellers: StockGlanceProduct[];
  /** Tracked products with nothing left, by name. */
  outOfStock: StockGlanceProduct[];
  /** Tracked products with 1 … `lowAt` left, fewest first. */
  lowStock: StockGlanceProduct[];
}

/**
 * The bar's stock on one day: where its value sits, what sold best and what
 * is running out. Uses the same per-row summary as the closing-stock totals,
 * so the figures always agree with the KPI tiles.
 */
export function stockGlance(rows: readonly StockGlanceRow[], { lowAt = 3, top = 5 }: { lowAt?: number; top?: number } = {}): StockGlance {
  const byCategory = new Map<string, number>();
  const sellers: StockGlanceProduct[] = [];
  const outOfStock: StockGlanceProduct[] = [];
  const lowStock: StockGlanceProduct[] = [];
  for (const row of rows) {
    const summary = summarizeStockRow(row.input);
    if (summary.soldQuantity > 0) {
      sellers.push({ id: row.id, name: row.name, quantity: summary.soldQuantity, income: summary.barIncome });
    }
    if (!row.input.tracksInventory) continue;
    const value = row.input.closingStock * row.input.costPrice;
    if (value > 0) byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + value);
    const left = row.input.closingStock;
    const product = { id: row.id, name: row.name, quantity: left, income: summary.barIncome };
    if (left <= 0) outOfStock.push(product);
    else if (left <= lowAt) lowStock.push(product);
  }
  return {
    valueByCategory: [...byCategory.entries()]
      .map(([category, value]) => ({ category, value }))
      .sort((a, b) => b.value - a.value),
    topSellers: sellers.sort((a, b) => b.income - a.income || b.quantity - a.quantity || a.name.localeCompare(b.name)).slice(0, top),
    outOfStock: outOfStock.sort((a, b) => a.name.localeCompare(b.name)),
    lowStock: lowStock.sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name)),
  };
}

export interface CollectedFlowDay {
  date: string;
  collected: number;
  /** Paid out of collected money or moved into the reserve (positive). */
  out: number;
}

/**
 * Collected money per day, oldest first: what collectors took in against what
 * left the collected money (expenses paid from it and moves to the reserve).
 */
export function collectedFlowByDay(moves: ReadonlyArray<{ kind: 'collect' | 'expense' | 'reserve'; date: string; amount: number }>): CollectedFlowDay[] {
  const days = new Map<string, CollectedFlowDay>();
  for (const move of moves) {
    const day = days.get(move.date) ?? { date: move.date, collected: 0, out: 0 };
    if (move.kind === 'collect') day.collected += move.amount;
    else day.out += -move.amount;
    days.set(move.date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The ISO date one day before `iso`. */
function previousIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * The last day a daily cash entry is already due: the business today once it
 * has an entry, otherwise the day before (today is still being worked).
 */
export function lastDueCashDay(today: string, enteredDates: { has(date: string): boolean }): string {
  return enteredDates.has(today) ? today : previousIsoDate(today);
}
