import { isBarPaidExpense, sumGameClubRows, type DailyCashRow, type ExpenseRow, type StockCountRow } from './dashboardMetrics';
import type { ExpensePreset } from './expensePlans';
import { isReservePaidExpense } from './reserveMoves';

/**
 * Money checks: records in a month that look off and are worth a second look.
 * Each check belongs to one side of the club (game club or bar); the two sides
 * are never added together. Thresholds are named constants so they can be
 * tuned from real months and are pinned by the tests.
 */

export type MoneyCheckKind = 'duplicate_expense' | 'category_spike' | 'low_income_day' | 'repeated_shortage';
export type MoneyCheckSide = 'game_club' | 'bar';

export interface MoneyCheck {
  kind: MoneyCheckKind;
  severity: 'warning' | 'danger';
  /** Never both sides added together. */
  side: MoneyCheckSide | null;
  /** The day it happened, when it is one day. */
  date: string | null;
  /** The records behind it. */
  range: { from: string; to: string };
  /** Expense category key. */
  category?: string;
  /** The figure that is off (whole UZS). */
  amount: number;
  /** What it is compared with. */
  usual?: number;
  /** Rows or days involved. */
  count?: number;
  /** Expense ids, for duplicates. */
  recordIds?: string[];
}

/** Rows with the same date, category, amount, side and method that make a duplicate. */
export const DUPLICATE_MIN_ROWS = 2;
/**
 * Payroll writes one `salary` expense per person (record_salary_entry), so
 * several people paid the same amount on one day is normal, not a duplicate.
 * Each cash shortage is its own record (record_cash_shortage), and repeated
 * shortages are a check of their own.
 */
export const DUPLICATE_EXEMPT_CATEGORIES: readonly string[] = ['salary', 'shortage'];

/** Full months before the selected one that set a category's usual level. */
export const SPIKE_HISTORY_MONTHS = 3;
/** Of those months, how many must have had the category. */
export const SPIKE_MIN_HISTORY_MONTHS = 2;
/** Month to date at least this many times what the earlier months had spent by the same day. */
export const SPIKE_RATIO = 1.5;
/** A spike this many times the usual level is `danger` (twice the threshold). */
export const SPIKE_DANGER_RATIO = SPIKE_RATIO * 2;
/** The excess must be at least this share of the side's expenses so far. */
export const SPIKE_MIN_SHARE = 0.05;
/**
 * Shortages are already a check of their own (repeated_shortage); flagging
 * their category again would report the same money twice.
 */
export const SPIKE_EXEMPT_CATEGORIES: readonly string[] = ['shortage'];

/** Weeks of the same weekday that set a day's usual income. */
export const LOW_INCOME_WEEKS = 8;
/** Same-weekday days with an entry needed before a day can be judged. */
export const LOW_INCOME_MIN_SAMPLES = 4;
/** A day under this share of its usual income is low. */
export const LOW_INCOME_RATIO = 0.6;
/** A day under this share is `danger` (twice as far below as the threshold allows). */
export const LOW_INCOME_DANGER_RATIO = 1 - (1 - LOW_INCOME_RATIO) * 2;

/** Shortages in one month that make a pattern. */
export const SHORTAGE_MIN_COUNT = 3;
/** Recorded days in a row, each with a shortage, that make a pattern. */
export const SHORTAGE_RUN_DAYS = 3;

const SHORTAGE_CATEGORY = 'shortage';
const DAY_MS = 86_400_000;

type Range = { from: string; to: string };

const toUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => fromUtc(toUtc(iso) + days * DAY_MS);
const sideOf = (row: Pick<ExpenseRow, 'payment_source'>): MoneyCheckSide => (isBarPaidExpense(row) ? 'bar' : 'game_club');

/** The first day of the month `offset` months from the one `iso` falls in. */
function monthStart(iso: string, offset = 0): string {
  const absolute = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1 + offset;
  return `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, '0')}-01`;
}

/**
 * The earliest day the checks for a month read: the full months that set a
 * category's usual level and the weeks that set a weekday's usual income.
 */
export function moneyCheckHistoryStart(range: Range): string {
  const months = monthStart(range.from, -SPIKE_HISTORY_MONTHS);
  const weeks = addDays(range.from, -LOW_INCOME_WEEKS * 7);
  return months < weeks ? months : weeks;
}

export interface MoneyCheckInput {
  /** The selected month. */
  range: Range;
  /** The club's business date; today is never judged as a finished day. */
  today: string;
  /** Expenses from `moneyCheckHistoryStart(range)` through the month. */
  expenseRows: readonly ExpenseRow[];
  /** Daily cash entries over the same window. */
  cashRows: readonly DailyCashRow[];
  /** Bar sales per day (or per product and day) over the same window. */
  stockRows: readonly Pick<StockCountRow, 'date' | 'bar_income'>[];
  /** The club's planned expenses; a planned category is left to the plan panel. */
  presets: readonly ExpensePreset[];
}

function findDuplicates(rows: readonly ExpenseRow[], range: Range): MoneyCheck[] {
  const groups = new Map<string, ExpenseRow[]>();
  for (const row of rows) {
    if (row.date < range.from || row.date > range.to) continue;
    // Reserve-paid expenses (136, 124) leave the reserve, not a side's money.
    if (DUPLICATE_EXEMPT_CATEGORIES.includes(row.category) || isReservePaidExpense(row)) continue;
    const amount = Number(row.amount ?? 0);
    if (!(amount > 0)) continue;
    const key = [row.date, row.category, amount, sideOf(row), row.payment_method ?? ''].join('|');
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  const checks: MoneyCheck[] = [];
  for (const group of groups.values()) {
    if (group.length < DUPLICATE_MIN_ROWS) continue;
    const [first] = group;
    checks.push({
      kind: 'duplicate_expense',
      severity: 'danger',
      side: sideOf(first),
      date: first.date,
      range: { from: first.date, to: first.date },
      category: first.category,
      amount: Number(first.amount),
      count: group.length,
      recordIds: group.map((row) => row.id),
    });
  }
  return checks;
}

const daysInMonth = (monthFirstDay: string) => Number(addDays(monthStart(monthFirstDay, 1), -1).slice(8, 10));

/**
 * A category far above what the three earlier months had spent by the same
 * day of the month. Comparing by day keeps a lump payment (rent on the 2nd)
 * from looking like a spike until the month catches up with it.
 */
function findSpikes(input: MoneyCheckInput): MoneyCheck[] {
  const { range, today, expenseRows, presets } = input;
  if (today < range.from) return [];
  const toDate = today < range.to ? today : range.to;
  // A finished month is compared with whole months; one in progress with the same days of each.
  const cutoffDay = toDate === range.to ? 31 : Number(toDate.slice(8, 10));
  const historyMonths = Array.from({ length: SPIKE_HISTORY_MONTHS }, (_, index) => monthStart(range.from, -(index + 1)));
  const historyFrom = historyMonths[historyMonths.length - 1];
  const cutoffByMonth = new Map(historyMonths.map((month) => [month, Math.min(cutoffDay, daysInMonth(month))]));
  const planned = new Set(presets.filter((preset) => !preset.archived_at).map((preset) => `${preset.payment_source}|${preset.category}`));

  const current = new Map<string, number>();
  const sideTotals: Record<MoneyCheckSide, number> = { game_club: 0, bar: 0 };
  /** Per category and history month: the whole month and the same days as the selected month so far. */
  const history = new Map<string, Map<string, { full: number; toDay: number }>>();
  for (const row of expenseRows) {
    // Reserve-paid expenses are not side money (as expenseTotalsByCategory).
    if (isReservePaidExpense(row)) continue;
    const amount = Number(row.amount ?? 0);
    const side = sideOf(row);
    const key = `${side}|${row.category}`;
    if (row.date >= range.from && row.date <= toDate) {
      current.set(key, (current.get(key) ?? 0) + amount);
      sideTotals[side] += amount;
    } else if (row.date >= historyFrom && row.date < range.from) {
      const month = monthStart(row.date);
      const byMonth = history.get(key) ?? new Map<string, { full: number; toDay: number }>();
      const entry = byMonth.get(month) ?? { full: 0, toDay: 0 };
      entry.full += amount;
      if (Number(row.date.slice(8, 10)) <= (cutoffByMonth.get(month) ?? 0)) entry.toDay += amount;
      byMonth.set(month, entry);
      history.set(key, byMonth);
    }
  }

  const checks: MoneyCheck[] = [];
  for (const [key, amount] of current) {
    const [side, category] = key.split('|') as [MoneyCheckSide, string];
    if (planned.has(key) || SPIKE_EXEMPT_CATEGORIES.includes(category)) continue;
    const byMonth = history.get(key);
    const monthsWithCategory = historyMonths.filter((month) => (byMonth?.get(month)?.full ?? 0) > 0).length;
    if (monthsWithCategory < SPIKE_MIN_HISTORY_MONTHS) continue;
    const usual = historyMonths.reduce((total, month) => total + (byMonth?.get(month)?.toDay ?? 0), 0) / SPIKE_HISTORY_MONTHS;
    if (!(usual > 0) || amount < usual * SPIKE_RATIO) continue;
    if (amount - usual < sideTotals[side] * SPIKE_MIN_SHARE) continue;
    checks.push({
      kind: 'category_spike',
      severity: amount >= usual * SPIKE_DANGER_RATIO ? 'danger' : 'warning',
      side,
      date: null,
      range: { from: range.from, to: toDate },
      category,
      amount,
      usual: Math.round(usual),
    });
  }
  return checks;
}

function findLowDays(
  side: MoneyCheckSide,
  incomeByDate: ReadonlyMap<string, number>,
  range: Range,
  today: string,
): MoneyCheck[] {
  const checks: MoneyCheck[] = [];
  for (const [date, amount] of incomeByDate) {
    // Only finished days of the month that have an entry; a missing entry is not a low day.
    if (date < range.from || date > range.to || date >= today) continue;
    const samples: number[] = [];
    for (let week = 1; week <= LOW_INCOME_WEEKS; week += 1) {
      const sample = incomeByDate.get(addDays(date, -7 * week));
      if (sample !== undefined) samples.push(sample);
    }
    if (samples.length < LOW_INCOME_MIN_SAMPLES) continue;
    const usual = samples.reduce((total, value) => total + value, 0) / samples.length;
    if (!(usual > 0) || amount >= usual * LOW_INCOME_RATIO) continue;
    checks.push({
      kind: 'low_income_day',
      severity: amount < usual * LOW_INCOME_DANGER_RATIO ? 'danger' : 'warning',
      side,
      date,
      range: { from: date, to: date },
      amount,
      usual: Math.round(usual),
    });
  }
  return checks;
}

function gameClubIncomeByDate(rows: readonly DailyCashRow[]): Map<string, number> {
  const byDate = new Map<string, DailyCashRow[]>();
  for (const row of rows) {
    const group = byDate.get(row.date);
    if (group) group.push(row);
    else byDate.set(row.date, [row]);
  }
  return new Map([...byDate].map(([date, group]) => [date, sumGameClubRows(group).gameClubIncome]));
}

function barSalesByDate(rows: readonly Pick<StockCountRow, 'date' | 'bar_income'>[]): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const row of rows) byDate.set(row.date, (byDate.get(row.date) ?? 0) + Number(row.bar_income ?? 0));
  return byDate;
}

/** The longest run of recorded days in a row that each had a shortage, ending inside the month. */
function longestShortageRun(shortageDates: ReadonlySet<string>, recordedDays: readonly string[], range: Range): { from: string; to: string; days: number } | null {
  let best: { from: string; to: string; days: number } | null = null;
  let runStart: string | null = null;
  let runDays = 0;
  for (const day of recordedDays) {
    if (day > range.to) break;
    if (shortageDates.has(day)) {
      runStart ??= day;
      runDays += 1;
      if (day >= range.from && (!best || runDays > best.days)) best = { from: runStart, to: day, days: runDays };
    } else {
      runStart = null;
      runDays = 0;
    }
  }
  return best;
}

function findShortages(input: MoneyCheckInput, gameClubDays: ReadonlyMap<string, number>, barDays: ReadonlyMap<string, number>): MoneyCheck[] {
  const { range, expenseRows } = input;
  const checks: MoneyCheck[] = [];
  for (const side of ['game_club', 'bar'] as const) {
    const rows = expenseRows.filter((row) => row.category === SHORTAGE_CATEGORY && sideOf(row) === side);
    const inMonth = rows.filter((row) => row.date >= range.from && row.date <= range.to);
    if (!inMonth.length) continue;
    // A recorded day is one with the side's daily entry, or a shortage itself.
    const shortageDates = new Set(rows.map((row) => row.date));
    const recorded = [...new Set([...(side === 'bar' ? barDays : gameClubDays).keys(), ...shortageDates])].sort();
    const run = longestShortageRun(shortageDates, recorded, range);
    const longRun = run && run.days >= SHORTAGE_RUN_DAYS ? run : null;
    if (inMonth.length < SHORTAGE_MIN_COUNT && !longRun) continue;
    // A run that started last month brings its earlier shortages in.
    const from = longRun && longRun.from < range.from ? longRun.from : range.from;
    const counted = rows.filter((row) => row.date >= from && row.date <= range.to);
    const dates = counted.map((row) => row.date).sort();
    checks.push({
      kind: 'repeated_shortage',
      severity: 'warning',
      side,
      date: null,
      range: { from, to: dates[dates.length - 1] },
      category: SHORTAGE_CATEGORY,
      amount: counted.reduce((total, row) => total + Number(row.amount ?? 0), 0),
      count: counted.length,
    });
  }
  return checks;
}

/**
 * A key unique within one month's checks. Duplicate groups that differ only
 * by payment method are told apart by their record ids.
 */
export function moneyCheckKey(check: MoneyCheck): string {
  return [
    check.kind,
    check.side ?? '',
    check.category ?? '',
    check.date ?? check.range.from,
    check.amount,
    check.recordIds?.join(',') ?? '',
  ].join(':');
}

const SEVERITY_ORDER = { danger: 0, warning: 1 } as const;
const checkDate = (check: MoneyCheck) => check.date ?? check.range.to;

/** Danger first, then the newest, then the largest. */
export function sortMoneyChecks(checks: MoneyCheck[]): MoneyCheck[] {
  return [...checks].sort((a, b) => (
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || checkDate(b).localeCompare(checkDate(a))
    || b.amount - a.amount
  ));
}

/** Everything in the month that looks off, worst and newest first. */
export function buildMoneyChecks(input: MoneyCheckInput): MoneyCheck[] {
  const { range, today } = input;
  if (today < range.from) return [];
  const gameClubDays = gameClubIncomeByDate(input.cashRows);
  const barDays = barSalesByDate(input.stockRows);
  return sortMoneyChecks([
    ...findDuplicates(input.expenseRows, range),
    ...findSpikes(input),
    ...findLowDays('game_club', gameClubDays, range, today),
    ...findLowDays('bar', barDays, range, today),
    ...findShortages(input, gameClubDays, barDays),
  ]);
}
