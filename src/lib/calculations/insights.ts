/**
 * "At a glance" figures shared by the dashboard, reports, owner profit and
 * financial analysis charts. Each works on one business at a time: the game
 * club and the bar are never added together here.
 */

import { isBarPaidExpense } from './dashboardMetrics';
import { isReservePaidExpense } from './reserveMoves';

/** Days between two ISO dates (UTC arithmetic, so no daylight-saving drift). */
function dayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function isoFromIndex(index: number): string {
  return new Date(index * 86_400_000).toISOString().slice(0, 10);
}

/** Monday-first weekday of an ISO date: 0 = Monday … 6 = Sunday. */
export function mondayWeekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export interface WeekdayAverage {
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  /** Average per day of that weekday, 0 when there was none. */
  average: number;
  /** How many days of that weekday were counted. */
  days: number;
  total: number;
}

/**
 * Average income per weekday over every day from `from` through `through`
 * (inclusive). Days without a row count as zero, so a closed Monday lowers
 * the Monday average instead of being skipped.
 */
export function averageByWeekday(
  values: ReadonlyMap<string, number>,
  range: { from: string; through: string },
): WeekdayAverage[] {
  const result: WeekdayAverage[] = Array.from({ length: 7 }, (_, weekday) => ({ weekday, average: 0, days: 0, total: 0 }));
  if (range.through < range.from) return result;
  for (let index = dayIndex(range.from); index <= dayIndex(range.through); index += 1) {
    const iso = isoFromIndex(index);
    const slot = result[mondayWeekday(iso)];
    slot.days += 1;
    slot.total += values.get(iso) ?? 0;
  }
  for (const slot of result) slot.average = slot.days ? slot.total / slot.days : 0;
  return result;
}

export interface CalendarCell {
  date: string;
  /** Day of the month, 1-31. */
  day: number;
  /** The day's amount; null for a day after `through` (not happened or not entered yet). */
  value: number | null;
  /** 0 (nothing) … 4 (the month's best day), relative to the month's best day. */
  level: 0 | 1 | 2 | 3 | 4;
}

/**
 * One month as Monday-first weeks for a calendar heatmap. Leading and trailing
 * slots outside the month are null.
 */
export function buildMonthCalendar(
  yearMonth: string,
  values: ReadonlyMap<string, number>,
  through: string | null,
): Array<Array<CalendarCell | null>> {
  const [y, m] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = `${yearMonth}-01`;
  const cells: CalendarCell[] = [];
  let max = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${yearMonth}-${String(day).padStart(2, '0')}`;
    const value = through !== null && date <= through ? values.get(date) ?? 0 : null;
    if (value !== null && value > max) max = value;
    cells.push({ date, day, value, level: 0 });
  }
  for (const cell of cells) {
    if (cell.value === null || cell.value <= 0 || max <= 0) continue;
    cell.level = Math.min(4, Math.max(1, Math.ceil((cell.value / max) * 4))) as CalendarCell['level'];
  }
  const weeks: Array<Array<CalendarCell | null>> = [];
  let week: Array<CalendarCell | null> = Array.from({ length: mondayWeekday(first) }, () => null);
  for (const cell of cells) {
    week.push(cell);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push([...week, ...Array.from({ length: 7 - week.length }, () => null)]);
  return weeks;
}

export interface ShareItem {
  key: string;
  label: string;
  value: number;
}

export interface RankedShare extends ShareItem {
  /** Share of the positive total, 0-1. */
  share: number;
  /** True for the folded "other" slice. */
  other?: boolean;
}

/**
 * Largest first, with everything after `maxSlices - 1` folded into one
 * "other" slice so a donut never needs more hues than the palette has.
 * Zero and negative values are left out.
 */
export function rankShares(items: readonly ShareItem[], maxSlices: number, other: { key: string; label: string }): RankedShare[] {
  const positive = items.filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  const total = positive.reduce((sum, item) => sum + item.value, 0);
  if (!total) return [];
  const withShare = (item: ShareItem): RankedShare => ({ ...item, share: item.value / total });
  if (positive.length <= maxSlices) return positive.map(withShare);
  const head = positive.slice(0, Math.max(1, maxSlices - 1)).map(withShare);
  const rest = positive.slice(head.length).reduce((sum, item) => sum + item.value, 0);
  return [...head, { ...other, value: rest, share: rest / total, other: true }];
}

export interface PeriodProgress {
  elapsed: number;
  total: number;
  /** elapsed / total, 0-1. */
  ratio: number;
}

/** How far `today` is through a date range (a finished range is 100%). */
export function periodProgress(range: { from: string; to: string }, today: string): PeriodProgress {
  const total = Math.max(1, dayIndex(range.to) - dayIndex(range.from) + 1);
  const capped = today > range.to ? range.to : today;
  const elapsed = capped < range.from ? 0 : dayIndex(capped) - dayIndex(range.from) + 1;
  return { elapsed, total, ratio: elapsed / total };
}

export interface ExtremeDay {
  date: string;
  value: number;
}

/** The best and the weakest day with an amount above zero, or null when there is none. */
export function bestAndWorstDays(values: ReadonlyMap<string, number>): { best: ExtremeDay; worst: ExtremeDay } | null {
  let best: ExtremeDay | null = null;
  let worst: ExtremeDay | null = null;
  for (const [date, value] of [...values.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (value <= 0) continue;
    if (!best || value > best.value) best = { date, value };
    if (!worst || value < worst.value) worst = { date, value };
  }
  return best && worst ? { best, worst } : null;
}

/** A ratio of part over whole, null when the whole is not positive. */
export function safeRatio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/**
 * One side's expenses summed by category, largest first. The side is decided
 * by `isBarPaidExpense`, the same split the dashboard totals use.
 *
 * By default an expense the owner reserve or the club's dollars paid is left
 * out (156, 124): it took no money from the side, so the categories add up to
 * what the side's own money paid (the Reports money view). Pass
 * `includeReservePaid` where the figure is accounting spending: the dashboard's
 * `gameClubExpenses`, `barExpenses` and profit keep those purchases, so its
 * categories only add up to them with the option on.
 */
export function expenseTotalsByCategory(
  rows: ReadonlyArray<{
    category: string;
    amount: number | string;
    payment_source?: 'game_club' | 'bar' | null;
    paid_from_reserve?: boolean | null;
    payment_method?: string | null;
  }>,
  side: 'game_club' | 'bar',
  { includeReservePaid = false }: { includeReservePaid?: boolean } = {},
): Array<{ category: string; value: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (isBarPaidExpense(row) !== (side === 'bar')) continue;
    if (!includeReservePaid && isReservePaidExpense(row)) continue;
    totals.set(row.category, (totals.get(row.category) ?? 0) + Number(row.amount ?? 0));
  }
  return [...totals.entries()]
    .map(([category, value]) => ({ category, value }))
    .sort((a, b) => b.value - a.value);
}

/** A side's amounts per date, for the heatmap and weekday charts. */
export function valuesByDate<T extends { date: string }>(rows: readonly T[], pick: (row: T) => number | null | undefined): Map<string, number> {
  const values = new Map<string, number>();
  for (const row of rows) values.set(row.date, (values.get(row.date) ?? 0) + Number(pick(row) ?? 0));
  return values;
}
