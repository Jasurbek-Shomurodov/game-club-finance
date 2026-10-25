import { describe, expect, it } from 'vitest';
import {
  buildCategorySeries,
  buildOwnerMonthSeries,
  buildPeriodSeries,
  buildProfitMonths,
  buildWeekdayPattern,
  granularityRange,
  periodStart,
  weekdayOf,
} from './analysisSeries';
import { analysisTotals, barFlow, gameClubFlow, type AnalysisLedgers } from './financialAnalysis';
import type { ExpenseRow } from './dashboardMetrics';
import type { AvailableSourceBalance } from './availableMoney';

function expense(id: string, date: string, amount: number, category: string, extra: Partial<ExpenseRow> = {}): ExpenseRow {
  return { id, date, amount, category, comment: null, created_at: `${date}T10:00:00Z`, ...extra };
}

// 2026-09-28 is a Monday; the range crosses a week and a month boundary.
const range = { from: '2026-09-28', to: '2026-10-06' };

const ledgers: AnalysisLedgers = {
  cashRows: [
    { date: '2026-09-28', cash_income: 100_000, terminal_income: 50_000, card_income: 0, playstation_income: 20_000 },
    { date: '2026-10-01', cash_income: 80_000, terminal_income: 0, card_income: 30_000, playstation_income: 0 },
    { date: '2026-10-05', cash_income: 60_000, terminal_income: 0, card_income: 0, playstation_income: 10_000 },
  ],
  stockRows: [
    { date: '2026-09-29', bar_income: 40_000, bar_cost: 25_000, bar_profit: 15_000, sold_quantity: 4 },
    { date: '2026-10-05', bar_income: 10_000, bar_cost: 5_000, bar_profit: 5_000, sold_quantity: 1 },
  ],
  purchaseRows: [],
  expenseRows: [
    expense('e1', '2026-09-30', 30_000, 'rent'),
    expense('e2', '2026-10-02', 12_000, 'cleaning', { payment_source: 'bar' }),
    expense('e3', '2026-10-06', 8_000, 'snacks'),
  ],
  debtRows: [{ amount: 15_000, date: '2026-10-01', remaining_amount: 15_000, status: 'unpaid' }],
  debtPaymentRows: [],
};

describe('period buckets', () => {
  it('starts weeks on Monday and months on the first', () => {
    expect(weekdayOf('2026-09-28')).toBe(0);
    expect(weekdayOf('2026-10-04')).toBe(6);
    expect(periodStart('2026-10-04', 'week')).toBe('2026-09-28');
    expect(periodStart('2026-10-05', 'week')).toBe('2026-10-05');
    expect(periodStart('2026-10-17', 'month')).toBe('2026-10-01');
    expect(periodStart('2026-10-17', 'day')).toBe('2026-10-17');
  });

  it('limits days and weeks to their windows and never starts before the history', () => {
    const history = { from: '2026-01-15', to: '2026-10-25' };
    expect(granularityRange(history, 'month')).toEqual(history);
    expect(granularityRange(history, 'day')).toEqual({ from: '2026-09-25', to: '2026-10-25' });
    // 2026-10-25 is a Sunday; its week starts 2026-10-19, and 26 weeks span back to 2026-04-27.
    expect(granularityRange(history, 'week')).toEqual({ from: '2026-04-27', to: '2026-10-25' });
    expect(granularityRange({ from: '2026-10-20', to: '2026-10-25' }, 'day')).toEqual({ from: '2026-10-20', to: '2026-10-25' });
  });
});

describe('buildPeriodSeries', () => {
  it('matches the canonical side totals whatever the granularity', () => {
    const totals = analysisTotals(ledgers);
    for (const granularity of ['day', 'week', 'month'] as const) {
      const rows = buildPeriodSeries(range, ledgers, granularity);
      const sum = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((total, row) => total + pick(row), 0);
      expect(sum((row) => row.gameClubLeft)).toBe(gameClubFlow(totals).left);
      expect(sum((row) => row.barLeft)).toBe(barFlow(totals).left);
      expect(sum((row) => row.computers + row.playstation + row.debts)).toBe(totals.gameClubIncome);
      expect(rows.at(-1)?.gameClubCumulative).toBe(gameClubFlow(totals).left);
      expect(rows.at(-1)?.barCumulative).toBe(barFlow(totals).left);
    }
  });

  it('groups days into weeks and months with each bucket’s last day', () => {
    const weeks = buildPeriodSeries(range, ledgers, 'week');
    expect(weeks.map((row) => [row.period, row.end])).toEqual([['2026-09-28', '2026-10-04'], ['2026-10-05', '2026-10-06']]);
    expect(weeks[0]).toMatchObject({
      gameClubIncome: 170_000 + 110_000 + 15_000,
      gameClubSpent: 30_000,
      barSales: 40_000,
      barSpent: 25_000 + 12_000,
      computers: 150_000 + 110_000,
      playstation: 20_000,
      debts: 15_000,
    });
    const months = buildPeriodSeries(range, ledgers, 'month');
    expect(months.map((row) => row.period)).toEqual(['2026-09-01', '2026-10-01']);
    expect(months[0]).toMatchObject({ gameClubLeft: 170_000 - 30_000, barLeft: 40_000 - 25_000, gameClubCumulative: 140_000 });
    expect(buildPeriodSeries(range, ledgers, 'day')).toHaveLength(9);
  });
});

describe('buildWeekdayPattern', () => {
  it('averages only the days each side recorded income', () => {
    const rows = buildWeekdayPattern(range, ledgers);
    expect(rows).toHaveLength(7);
    // Two Mondays with game club income (28 Sep, 5 Oct); the bar sold only on 5 Oct.
    expect(rows[0]).toMatchObject({ gameClubAverage: (170_000 + 70_000) / 2, gameClubDays: 2, barAverage: 10_000, barDays: 1 });
    // Thursday 1 Oct includes the new debt, as game club income does.
    expect(rows[3]).toMatchObject({ gameClubAverage: 125_000, gameClubDays: 1, barDays: 0, barAverage: 0 });
    expect(rows[6]).toMatchObject({ gameClubAverage: 0, gameClubDays: 0 });
  });
});

describe('buildCategorySeries', () => {
  it('folds categories outside the top list into other, per bucket', () => {
    const top = [{ category: 'rent', amount: 30_000, share: 60, count: 1 }, { category: 'other', amount: 20_000, share: 40, count: 2 }];
    expect(buildCategorySeries(range, ledgers.expenseRows, 'week', top)).toEqual([
      { period: '2026-09-28', rent: 30_000, other: 12_000 },
      { period: '2026-10-05', other: 8_000 },
    ]);
    expect(buildCategorySeries(range, ledgers.expenseRows, 'day', top)).toHaveLength(9);
  });
});

describe('buildOwnerMonthSeries', () => {
  it('lists each month oldest first with withdrawals and what is left', () => {
    const side = (earned: number, withdrawn: number): AvailableSourceBalance => ({
      earned,
      withdrawn,
      available: earned - withdrawn,
      overdrawnBy: Math.max(0, withdrawn - earned),
    });
    const month = (gameClub: AvailableSourceBalance, bar: AvailableSourceBalance) => ({ gameClub, bar, hasOverWithdrawal: false, invalidWithdrawals: [] });
    expect(buildOwnerMonthSeries({
      '2026-10': month(side(100, 40), side(50, 60)),
      '2026-09': month(side(80, 0), side(30, 30)),
    })).toEqual([
      { month: '2026-09-01', gameClubWithdrawn: 0, gameClubLeft: 80, barWithdrawn: 30, barLeft: 0 },
      { month: '2026-10-01', gameClubWithdrawn: 40, gameClubLeft: 60, barWithdrawn: 60, barLeft: -10 },
    ]);
  });
});

describe('buildProfitMonths', () => {
  it('gives each side its own profit and margin', () => {
    const rows = [
      { month: '2026-09-01', gameClubIncome: 200, gameClubLeft: 50, barSales: 0, barLeft: -10 },
      { month: '2026-10-01', gameClubIncome: 300, gameClubLeft: -30, barSales: 100, barLeft: 33 },
    ];
    expect(buildProfitMonths(rows, 'gameClub')).toEqual([
      { month: '2026-09-01', profit: 50, marginPct: 25 },
      { month: '2026-10-01', profit: -30, marginPct: -10 },
    ]);
    expect(buildProfitMonths(rows, 'bar')).toEqual([
      { month: '2026-09-01', profit: -10, marginPct: null },
      { month: '2026-10-01', profit: 33, marginPct: 33 },
    ]);
  });
});
