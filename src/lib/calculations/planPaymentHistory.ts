import { monthRange } from '@/lib/utils';
import type { ExpensePlanSide, ExpensePlanSummary, ExpensePreset, PresetExpenseRow } from './expensePlans';
import { monthStart } from './upcomingPayments';

/**
 * What was paid against each planned expense in each of the last six months,
 * ending with the selected one. It states facts only: a preset keeps just its
 * current monthly amount, so an older month's plan is unknown and nothing is
 * judged as missed. Game club and bar plans are kept apart and never added
 * together.
 */

type Range = { from: string; to: string };

/** Months shown, the selected one last. */
export const PLAN_HISTORY_MONTHS = 6;

export interface PlanHistoryCell {
  /** 'YYYY-MM'. */
  month: string;
  /** The whole calendar month: where the cell's payments open. */
  range: Range;
  /** Sum of the payments linked to the plan in the month; 0 when none. */
  paid: number;
  count: number;
}

export interface PlanHistoryRow {
  preset: ExpensePreset;
  /** Oldest first, always `PLAN_HISTORY_MONTHS` long. */
  cells: PlanHistoryCell[];
  /** Cells with something paid. */
  paidMonths: number;
}

export interface PlanHistorySide {
  rows: PlanHistoryRow[];
}

export interface PlanPaymentHistory {
  /** The column months, oldest first, ending with the selected month. */
  months: string[];
  gameClub: PlanHistorySide;
  bar: PlanHistorySide;
}

export interface PlanPaymentHistoryInput {
  /** Planned against actual for the selected month: rows and their order come from here. */
  summary: ExpensePlanSummary;
  /** Linked payments from `planHistoryStart(range)` through the selected month. */
  linkedExpenses: readonly PresetExpenseRow[];
  /** The selected month. */
  range: Range;
}

/** The first day of the oldest month shown: five months before the selected one. */
export function planHistoryStart(range: Range): string {
  return monthStart(range.from, -(PLAN_HISTORY_MONTHS - 1));
}

/**
 * One row per plan of the summary, in its order (archived plans with spending
 * in the selected month included, as in the plan panels), and one cell per
 * month with what was paid against the plan that month.
 */
export function buildPlanPaymentHistory({ summary, linkedExpenses, range }: PlanPaymentHistoryInput): PlanPaymentHistory {
  const months = Array.from({ length: PLAN_HISTORY_MONTHS }, (_, index) => (
    monthStart(range.from, index - (PLAN_HISTORY_MONTHS - 1)).slice(0, 7)
  ));
  const ranges = months.map((month) => monthRange(month));
  const first = ranges[0].from;
  const last = ranges[ranges.length - 1].to;

  const paid = new Map<string, { amount: number; count: number }>();
  for (const row of linkedExpenses) {
    if (!row.preset_id || row.date < first || row.date > last) continue;
    const key = `${row.preset_id}|${row.date.slice(0, 7)}`;
    const entry = paid.get(key) ?? { amount: 0, count: 0 };
    entry.amount += Number(row.amount ?? 0);
    entry.count += 1;
    paid.set(key, entry);
  }

  const side = (planSide: ExpensePlanSide): PlanHistorySide => ({
    rows: planSide.rows.map(({ preset }) => {
      const cells = months.map((month, index) => {
        const entry = paid.get(`${preset.id}|${month}`);
        return { month, range: ranges[index], paid: entry?.amount ?? 0, count: entry?.count ?? 0 };
      });
      return { preset, cells, paidMonths: cells.filter((cell) => cell.paid > 0).length };
    }),
  });

  return { months, gameClub: side(summary.gameClub), bar: side(summary.bar) };
}
