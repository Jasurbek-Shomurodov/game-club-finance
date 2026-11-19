// Range-level figures for the money-details pages, built only from the per-day
// rows so the summary always agrees with the days listed under it.

import type { MoneyDetailRow } from './moneyDetails';

export interface MoneyDetailsSummary {
  collected: number;
  deductions: number;
  moneyLeft: number;
  /** Share of collected money that stayed (0–100), null when nothing was collected. */
  keptPercent: number | null;
  /** Mean money left per listed day; 0 for an empty range. */
  averagePerDay: number;
  best: { date: string; moneyLeft: number } | null;
  worst: { date: string; moneyLeft: number } | null;
  /** Largest absolute daily money left, for scaling bars; 0 for an empty range. */
  maxAbsDay: number;
}

export function summarizeMoneyDetailRows(rows: readonly MoneyDetailRow[]): MoneyDetailsSummary {
  let collected = 0;
  let deductions = 0;
  let moneyLeft = 0;
  let best: MoneyDetailsSummary['best'] = null;
  let worst: MoneyDetailsSummary['worst'] = null;
  let maxAbsDay = 0;

  for (const row of rows) {
    collected += row.collectedTotal;
    deductions += row.deductionsTotal;
    moneyLeft += row.moneyLeft;
    if (!best || row.moneyLeft > best.moneyLeft) best = { date: row.date, moneyLeft: row.moneyLeft };
    if (!worst || row.moneyLeft < worst.moneyLeft) worst = { date: row.date, moneyLeft: row.moneyLeft };
    maxAbsDay = Math.max(maxAbsDay, Math.abs(row.moneyLeft));
  }

  return {
    collected,
    deductions,
    moneyLeft,
    keptPercent: collected > 0 ? Math.round((moneyLeft / collected) * 100) : null,
    averagePerDay: rows.length ? Math.round(moneyLeft / rows.length) : 0,
    best,
    worst,
    maxAbsDay,
  };
}

/** Share of `part` in `whole` as a 0–100 width, clamped so bars never overflow. */
export function sharePercent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}
