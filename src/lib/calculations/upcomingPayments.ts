import type { ExpenseRow } from './dashboardMetrics';
import { isBarPaidExpense } from './dashboardMetrics';
import type { ExpensePlanRow, ExpensePlanSummary, ExpensePreset, ExpensePresetSource, PresetExpenseRow } from './expensePlans';
import { isReservePaidExpense } from './reserveMoves';
import { manualExpenseCategoriesFor } from '@/lib/expenseCategories';

/**
 * What is still to be paid this month against the club's planned expenses,
 * and regular expenses that have no plan yet. Game club and bar plans are
 * kept apart and never added together.
 */

type Range = { from: string; to: string };

/** Linked payments whose day of the month sets a plan's usual pay day. */
export const USUAL_DAY_PAYMENTS = 6;
/** Months of linked payments read to find them (one payment a month for a monthly plan). */
export const USUAL_DAY_HISTORY_MONTHS = 6;

/** Full months before the selected one that a suggestion looks at. */
export const SUGGESTION_HISTORY_MONTHS = 4;
/** Of those months, how many must have had the category. */
export const SUGGESTION_MIN_MONTHS = 3;
/** Each month with the category within this share of their median. */
export const SUGGESTION_TOLERANCE = 0.25;
/** A suggested amount is the median rounded to this step. */
export const SUGGESTION_ROUNDING = 1_000;
/** At most this many suggestions per side, largest first. */
export const SUGGESTION_MAX_PER_SIDE = 3;
/**
 * Payroll writes one `salary` expense per person and is owed from all of
 * history, not a monthly plan; cash shortages, corrections, discounts and
 * investments are not running costs to plan for.
 */
export const SUGGESTION_EXEMPT_CATEGORIES: readonly string[] = ['salary', 'shortage', 'correction', 'discount', 'investments'];

const toUtc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

/** The first day of the month `offset` months from the one `iso` falls in. */
export function monthStart(iso: string, offset = 0): string {
  const absolute = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1 + offset;
  return `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, '0')}-01`;
}

function lastDayOfMonth(iso: string): number {
  return new Date(toUtc(monthStart(iso, 1)) - 86_400_000).getUTCDate();
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The median day of the month of the latest payments, or null without any. */
function usualDayOf(dates: readonly string[]): number | null {
  const latest = [...dates].sort().slice(-USUAL_DAY_PAYMENTS);
  if (!latest.length) return null;
  return Math.round(median(latest.map((date) => Number(date.slice(8, 10)))));
}

/** The earliest linked payment read for the usual pay day. */
export function usualDayHistoryStart(range: Range): string {
  return monthStart(range.from, -USUAL_DAY_HISTORY_MONTHS);
}

/** The earliest expense read for plan suggestions. */
export function planSuggestionHistoryStart(range: Range): string {
  return monthStart(range.from, -SUGGESTION_HISTORY_MONTHS);
}

/** The full months a suggestion is drawn from: where its records open. */
export function planSuggestionRange(range: Range): Range {
  return {
    from: planSuggestionHistoryStart(range),
    to: new Date(toUtc(range.from) - 86_400_000).toISOString().slice(0, 10),
  };
}

export interface UpcomingPayment {
  preset: ExpensePreset;
  /** Planned for the month minus linked actual, floored at 0. */
  remaining: number;
  /** Median day of the month of the last six linked payments; null without any. */
  usualDay: number | null;
  /** `usualDay` in the selected month, clamped to its last day; null without a usual day. */
  dueDate: string | null;
  /** The due date is before the business date and something is still due. Never without a due date. */
  overdue: boolean;
}

export interface UpcomingSide {
  rows: UpcomingPayment[];
  remaining: number;
}

export interface UpcomingPayments {
  gameClub: UpcomingSide;
  bar: UpcomingSide;
}

export interface UpcomingInput {
  /** Planned against actual for the selected month (`buildExpensePlanSummary`). */
  summary: ExpensePlanSummary;
  /** Linked payments from `usualDayHistoryStart(range)` through the month. */
  linkedExpenses: readonly PresetExpenseRow[];
  /** The selected month. */
  range: Range;
  /** The club's business date. */
  today: string;
}

const emptySide = (): UpcomingSide => ({ rows: [], remaining: 0 });

/**
 * Every live plan of the current business month with what is still due and
 * when it is usually paid. A past (or future) month has nothing upcoming.
 */
export function buildUpcomingPayments({ summary, linkedExpenses, range, today }: UpcomingInput): UpcomingPayments {
  const result: UpcomingPayments = { gameClub: emptySide(), bar: emptySide() };
  if (today < range.from || today > range.to) return result;

  const datesByPreset = new Map<string, string[]>();
  for (const row of linkedExpenses) {
    if (!row.preset_id || row.date > range.to) continue;
    const dates = datesByPreset.get(row.preset_id) ?? [];
    dates.push(row.date);
    datesByPreset.set(row.preset_id, dates);
  }

  const lastDay = lastDayOfMonth(range.from);
  const build = (rows: readonly ExpensePlanRow[], side: UpcomingSide) => {
    for (const row of rows) {
      if (row.preset.archived_at) continue;
      const remaining = Math.max(0, row.planned - row.actual);
      const usualDay = usualDayOf(datesByPreset.get(row.preset.id) ?? []);
      const dueDate = usualDay === null
        ? null
        : `${range.from.slice(0, 8)}${String(Math.min(usualDay, lastDay)).padStart(2, '0')}`;
      side.rows.push({
        preset: row.preset,
        remaining,
        usualDay,
        dueDate,
        overdue: dueDate !== null && dueDate < today && remaining > 0,
      });
      side.remaining += remaining;
    }
  };
  build(summary.gameClub.rows, result.gameClub);
  build(summary.bar.rows, result.bar);
  return result;
}

export interface PlanSuggestion {
  category: string;
  side: ExpensePresetSource;
  /** The median monthly total, rounded to 1 000. */
  typicalAmount: number;
  /** Months (of the last four full ones) that had the category. */
  months: number;
  /** Median day of the month of the latest payments. */
  usualDay: number | null;
}

export interface PlanSuggestionInput {
  /** The selected month; the four full months before it are read. */
  range: Range;
  /** Expenses from `planSuggestionHistoryStart(range)` on. */
  expenseRows: readonly Pick<ExpenseRow, 'date' | 'amount' | 'category' | 'payment_source' | 'payment_method' | 'paid_from_reserve'>[];
  /** Every preset of the club; archived ones do not count as a plan. */
  presets: readonly ExpensePreset[];
}

/**
 * A side's category with no live plan that was paid in at least three of the
 * last four full months, each month's total within 25% of their median.
 */
export function suggestExpensePlans({ range, expenseRows, presets }: PlanSuggestionInput): PlanSuggestion[] {
  const historyFrom = planSuggestionHistoryStart(range);
  const planned = new Set(presets.filter((preset) => !preset.archived_at).map((preset) => `${preset.payment_source}|${preset.category}`));

  const groups = new Map<string, { totals: Map<string, number>; dates: string[] }>();
  for (const row of expenseRows) {
    if (row.date < historyFrom || row.date >= range.from) continue;
    // Reserve-paid expenses leave the reserve, not a side's money.
    if (isReservePaidExpense(row)) continue;
    const amount = Number(row.amount ?? 0);
    if (!(amount > 0)) continue;
    const side: ExpensePresetSource = isBarPaidExpense(row) ? 'bar' : 'game_club';
    const key = `${side}|${row.category}`;
    const group = groups.get(key) ?? { totals: new Map<string, number>(), dates: [] };
    const month = monthStart(row.date);
    group.totals.set(month, (group.totals.get(month) ?? 0) + amount);
    group.dates.push(row.date);
    groups.set(key, group);
  }

  const suggestions: PlanSuggestion[] = [];
  for (const [key, group] of groups) {
    const [side, category] = key.split('|') as [ExpensePresetSource, string];
    if (planned.has(key) || SUGGESTION_EXEMPT_CATEGORIES.includes(category)) continue;
    // Only a category the plan form offers for this side can become a plan.
    if (!manualExpenseCategoriesFor(side).includes(category)) continue;
    const totals = [...group.totals.values()];
    if (totals.length < SUGGESTION_MIN_MONTHS) continue;
    const middle = median(totals);
    if (!(middle > 0) || totals.some((total) => Math.abs(total - middle) > middle * SUGGESTION_TOLERANCE)) continue;
    suggestions.push({
      category,
      side,
      typicalAmount: Math.max(SUGGESTION_ROUNDING, Math.round(middle / SUGGESTION_ROUNDING) * SUGGESTION_ROUNDING),
      months: totals.length,
      usualDay: usualDayOf(group.dates),
    });
  }

  const sorted = suggestions.sort((a, b) => b.typicalAmount - a.typicalAmount || a.category.localeCompare(b.category));
  return (['game_club', 'bar'] as const).flatMap((side) => sorted.filter((row) => row.side === side).slice(0, SUGGESTION_MAX_PER_SIDE));
}
