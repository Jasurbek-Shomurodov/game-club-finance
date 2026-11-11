import type { CashShortage, OwnerWithdrawalSource } from '@/types';

/** A live salary fine (salary_entries row) that recovers part of a shortage. */
export interface CashShortageRecovery {
  id: string;
  cash_shortage_id: string;
  amount: number;
  date: string;
}

/** One shortage with what was taken back from salary and what is still lost. */
export interface CashShortageSummary {
  shortage: CashShortage;
  recovered: number;
  /** amount - recovered, never below zero. */
  lost: number;
}

export interface CashShortageTotals {
  amount: number;
  recovered: number;
  lost: number;
}

const EMPTY_TOTALS: CashShortageTotals = { amount: 0, recovered: 0, lost: 0 };

/**
 * Pairs each shortage with its live recovery fines. A shortage is already a
 * `shortage` expense in every money total (migration 135); recovery is a salary
 * fine, so it lowers payroll instead of changing the shortage.
 */
export function summarizeCashShortages(
  shortages: readonly CashShortage[],
  recoveries: readonly CashShortageRecovery[],
): CashShortageSummary[] {
  const recoveredById = new Map<string, number>();
  for (const recovery of recoveries) {
    recoveredById.set(recovery.cash_shortage_id, (recoveredById.get(recovery.cash_shortage_id) ?? 0) + Number(recovery.amount));
  }
  return shortages
    .map((shortage) => {
      const amount = Number(shortage.amount);
      const recovered = Math.min(amount, recoveredById.get(shortage.id) ?? 0);
      return { shortage, recovered, lost: Math.max(0, amount - recovered) };
    })
    .sort((a, b) => b.shortage.date.localeCompare(a.shortage.date) || b.shortage.created_at.localeCompare(a.shortage.created_at));
}

/** Totals per source for one calendar month (YYYY-MM). Game Club and Bar are never added together. */
export function cashShortageTotalsForMonth(
  summaries: readonly CashShortageSummary[],
  month: string,
): Record<OwnerWithdrawalSource, CashShortageTotals> {
  const totals: Record<OwnerWithdrawalSource, CashShortageTotals> = { game_club: { ...EMPTY_TOTALS }, bar: { ...EMPTY_TOTALS } };
  for (const { shortage, recovered, lost } of summaries) {
    if (shortage.date.slice(0, 7) !== month) continue;
    const side = totals[shortage.payment_source];
    side.amount += Number(shortage.amount);
    side.recovered += recovered;
    side.lost += lost;
  }
  return totals;
}

/** What is left to recover from salary: nothing without a responsible employee. */
export function recoverableAmount(summary: CashShortageSummary): number {
  return summary.shortage.employee_id ? summary.lost : 0;
}
