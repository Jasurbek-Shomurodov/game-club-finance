import { describe, expect, it } from 'vitest';
import type { MoneyDetailRow } from './moneyDetails';
import { sharePercent, summarizeMoneyDetailRows } from './moneyDetailsSummary';

function row(date: string, collectedTotal: number, deductionsTotal: number): MoneyDetailRow {
  return { date, collected: [], collectedTotal, deductions: [], deductionsTotal, moneyLeft: collectedTotal - deductionsTotal };
}

describe('summarizeMoneyDetailRows', () => {
  it('adds the days and finds the best and weakest day', () => {
    const summary = summarizeMoneyDetailRows([
      row('2026-11-01', 1_242_000, 0),
      row('2026-11-02', 773_000, 3_479_000),
      row('2026-11-03', 2_000_000, 679_000),
    ]);
    expect(summary.collected).toBe(4_015_000);
    expect(summary.deductions).toBe(4_158_000);
    expect(summary.moneyLeft).toBe(-143_000);
    expect(summary.best).toEqual({ date: '2026-11-03', moneyLeft: 1_321_000 });
    expect(summary.worst).toEqual({ date: '2026-11-02', moneyLeft: -2_706_000 });
    expect(summary.maxAbsDay).toBe(2_706_000);
    expect(summary.averagePerDay).toBe(-47_667);
    expect(summary.keptPercent).toBe(-4);
  });

  it('handles an empty range and a range with nothing collected', () => {
    const empty = summarizeMoneyDetailRows([]);
    expect(empty).toMatchObject({ collected: 0, moneyLeft: 0, keptPercent: null, averagePerDay: 0, best: null, worst: null, maxAbsDay: 0 });
    expect(summarizeMoneyDetailRows([row('2026-11-01', 0, 50_000)]).keptPercent).toBeNull();
  });
});

describe('sharePercent', () => {
  it('clamps to 0–100 and guards an empty whole', () => {
    expect(sharePercent(25, 100)).toBe(25);
    expect(sharePercent(150, 100)).toBe(100);
    expect(sharePercent(-5, 100)).toBe(0);
    expect(sharePercent(5, 0)).toBe(0);
  });
});
