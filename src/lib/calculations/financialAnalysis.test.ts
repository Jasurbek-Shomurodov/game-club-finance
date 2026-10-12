import { describe, expect, it } from 'vitest';
import {
  BAR_COST_TARGET,
  OTHER_CATEGORY,
  PROFIT_TARGET,
  buildCategoryComparison,
  buildFinancialAnalysis,
  buildMonthlyAnalysis,
  foldCategories,
  groupExpensesByCategory,
  type AnalysisLedgers,
} from './financialAnalysis';
import { calculateDashboardTotals, type ExpenseRow } from './dashboardMetrics';

function expense(id: string, date: string, amount: number, category: string, extra: Partial<ExpenseRow> = {}): ExpenseRow {
  return { id, date, amount, category, comment: null, created_at: `${date}T10:00:00Z`, ...extra };
}

const range = { from: '2026-09-01', to: '2026-09-03' };

const ledgers: AnalysisLedgers = {
  cashRows: [
    { date: '2026-09-01', cash_income: 100_000, terminal_income: 50_000, card_income: 0, playstation_income: 20_000 },
    { date: '2026-09-02', cash_income: 80_000, terminal_income: 0, card_income: 30_000, playstation_income: 0 },
  ],
  stockRows: [
    { date: '2026-09-01', bar_income: 40_000, bar_cost: 25_000, bar_profit: 15_000, sold_quantity: 4 },
    { date: '2026-09-03', bar_income: 10_000, bar_cost: 5_000, bar_profit: 5_000, sold_quantity: 1 },
  ],
  purchaseRows: [],
  expenseRows: [
    expense('e1', '2026-09-01', 60_000, 'rent', { payment_method: 'cash', payment_source: 'game_club' }),
    expense('e2', '2026-09-02', 30_000, 'salary', { payment_method: 'terminal', payment_source: 'game_club' }),
    expense('e3', '2026-09-03', 10_000, 'supplies', { payment_method: 'cash', payment_source: 'bar' }),
  ],
  debtRows: [{ date: '2026-09-02', amount: 15_000, remaining_amount: 15_000, status: 'unpaid' }],
  debtPaymentRows: [{ date: '2026-09-03', amount: 5_000, payment_method: 'card' }],
};

describe('buildFinancialAnalysis', () => {
  const analysis = buildFinancialAnalysis(range, ledgers);

  it('agrees with the dashboard accounting net profit', () => {
    const dashboard = calculateDashboardTotals(
      ledgers.cashRows, ledgers.stockRows, [], ledgers.expenseRows, [], ledgers.debtRows, ledgers.debtPaymentRows,
    );
    expect(analysis.totals.accountingNetProfit).toBe(dashboard.accountingNetProfit);
    // 280k game club + 15k debt + 50k bar = 345k in; 30k COGS + 100k expenses out.
    expect(analysis.indicators.income).toBe(345_000);
    expect(analysis.indicators.spent).toBe(130_000);
    expect(analysis.indicators.left).toBe(215_000);
    expect(analysis.indicators.barMarginPct).toBe(40);
    expect(analysis.indicators.salarySharePct).toBe(30);
    expect(analysis.indicators.averageDailySpend).toBe(Math.round(130_000 / 3));
  });

  it('splits income by source without counting debts twice', () => {
    expect(analysis.sources).toEqual([
      { key: 'computers', amount: 260_000 },
      { key: 'playstation', amount: 20_000 },
      { key: 'bar', amount: 50_000 },
      { key: 'debts', amount: 15_000 },
    ]);
  });

  it('balances the sankey with profit on the outflow side', () => {
    const { sankey } = analysis;
    const inflow = sankey.sources.reduce((sum, node) => sum + node.amount, 0);
    const outflow = sankey.targets.reduce((sum, node) => sum + node.amount, 0);
    expect(inflow).toBe(outflow);
    expect(sankey.total).toBe(345_000);
    expect(sankey.targets.map((node) => node.key)).toEqual([BAR_COST_TARGET, 'rent', 'salary', 'supplies', PROFIT_TARGET]);
  });

  it('covers a loss with a shortfall source', () => {
    const loss = buildFinancialAnalysis(range, {
      ...ledgers,
      expenseRows: [...ledgers.expenseRows, expense('e4', '2026-09-03', 400_000, 'repair')],
    });
    const shortfall = loss.sankey.sources.find((node) => node.key === 'shortfall');
    expect(shortfall?.amount).toBe(185_000);
    expect(loss.sankey.targets.some((node) => node.key === PROFIT_TARGET)).toBe(false);
    const inflow = loss.sankey.sources.reduce((sum, node) => sum + node.amount, 0);
    expect(inflow).toBe(loss.sankey.total);
  });

  it('builds one daily row per date with spending groups by payment source', () => {
    expect(analysis.daily.map((day) => day.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(analysis.daily[0]).toMatchObject({ income: 210_000, barCost: 25_000, gameClubExpenses: 60_000, barExpenses: 0, spent: 85_000 });
    expect(analysis.daily[1]).toMatchObject({ income: 125_000, gameClubExpenses: 30_000 });
    expect(analysis.daily[2]).toMatchObject({ income: 10_000, barCost: 5_000, barExpenses: 10_000 });
  });

  it('nets game-club money per payment method and ignores bar-paid expenses', () => {
    expect(analysis.paymentMethods).toEqual([
      { method: 'cash', income: 180_000, expenses: 60_000, left: 120_000 },
      { method: 'terminal', income: 50_000, expenses: 30_000, left: 20_000 },
      { method: 'card', income: 35_000, expenses: 0, left: 35_000 },
    ]);
  });

  it('lists the largest payments first', () => {
    expect(analysis.largest.map((row) => row.id)).toEqual(['e1', 'e2', 'e3']);
  });
});

describe('expense categories', () => {
  it('groups, sorts and folds small categories into other', () => {
    const rows = ['a', 'b', 'c', 'd'].map((category, index) => expense(category, '2026-09-01', (4 - index) * 10, category));
    rows.push(expense('o', '2026-09-01', 5, OTHER_CATEGORY));
    const grouped = groupExpensesByCategory(rows);
    expect(grouped.map((row) => row.category)).toEqual(['a', 'b', 'c', 'd', OTHER_CATEGORY]);
    const folded = foldCategories(grouped, 2);
    expect(folded.map((row) => [row.category, row.amount])).toEqual([['a', 40], ['b', 30], [OTHER_CATEGORY, 35]]);
  });

  it('compares categories with the previous period', () => {
    const rows = buildCategoryComparison(
      [expense('1', '2026-09-01', 150, 'rent'), expense('2', '2026-09-01', 20, 'repair')],
      [expense('3', '2026-08-01', 100, 'rent'), expense('4', '2026-08-01', 50, 'tax')],
    );
    expect(rows).toEqual([
      { category: 'rent', current: 150, previous: 100, change: 50, changePct: 50 },
      { category: 'tax', current: 0, previous: 50, change: -50, changePct: -100 },
      { category: 'repair', current: 20, previous: 0, change: 20, changePct: null },
    ]);
  });
});

describe('buildMonthlyAnalysis', () => {
  it('returns the last twelve months ending with the business month', () => {
    const months = buildMonthlyAnalysis('2026-09-15', ledgers);
    expect(months).toHaveLength(12);
    expect(months[0].month).toBe('2025-10-01');
    expect(months[11]).toEqual({ month: '2026-09-01', income: 345_000, spent: 130_000, profit: 215_000 });
    expect(months[10]).toEqual({ month: '2026-08-01', income: 0, spent: 0, profit: 0 });
  });
});
