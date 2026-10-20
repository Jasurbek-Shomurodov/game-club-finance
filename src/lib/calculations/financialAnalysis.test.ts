import { describe, expect, it } from 'vitest';
import {
  BAR_COST_TARGET,
  OTHER_CATEGORY,
  buildCategoryComparison,
  buildCategoryDetail,
  buildFinancialAnalysis,
  buildMonthlyAnalysis,
  barFlow,
  foldCategories,
  gameClubFlow,
  groupExpensesByCategory,
  type AnalysisLedgers,
} from './financialAnalysis';
import { calculateDashboardTotals, type ExpenseRow } from './dashboardMetrics';
import { BAR_LEFT, GAME_CLUB_LEFT, buildDrillSankey } from './sankeyDrill';

const total = (nodes: Array<{ amount: number }>) => nodes.reduce((sum, node) => sum + node.amount, 0);

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

  it('keeps game club and bar indicators separate and agrees with the dashboard', () => {
    const dashboard = calculateDashboardTotals(
      ledgers.cashRows, ledgers.stockRows, [], ledgers.expenseRows, [], ledgers.debtRows, ledgers.debtPaymentRows,
    );
    expect(analysis.totals.gameClubProfit).toBe(dashboard.gameClubProfit);
    expect(analysis.totals.barProfit).toBe(dashboard.barProfit);
    // Game club: 280k collected + 15k new debt in; 90k game-club-paid expenses out.
    expect(analysis.indicators.gameClub).toEqual({
      income: 295_000,
      spent: 90_000,
      left: 205_000,
      marginPct: 69.5,
      averageDailyIncome: Math.round(295_000 / 3),
    });
    expect(analysis.indicators.gameClub.left).toBe(dashboard.gameClubProfit);
    // Bar: 50k sales in; 30k cost of goods sold + 10k bar-paid expenses out.
    expect(analysis.indicators.bar).toEqual({
      income: 50_000,
      spent: 40_000,
      left: 10_000,
      marginPct: 20,
      averageDailyIncome: Math.round(50_000 / 3),
    });
    expect(analysis.indicators.bar.left).toBe(dashboard.barProfit);
    expect(gameClubFlow(dashboard)).toEqual({ income: 295_000, spent: 90_000, left: 205_000 });
    expect(barFlow(dashboard)).toEqual({ income: 50_000, spent: 40_000, left: 10_000 });
  });

  it('splits income by source without counting debts twice', () => {
    expect(analysis.sources).toEqual([
      { key: 'computers', amount: 260_000 },
      { key: 'playstation', amount: 20_000 },
      { key: 'bar', amount: 50_000 },
      { key: 'debts', amount: 15_000 },
    ]);
  });

  it('draws a balanced game club sankey from game club money only', () => {
    const sankey = buildDrillSankey({ kind: 'gameClub' }, ledgers);
    expect(sankey.sources.map((node) => node.key)).toEqual(['computers', 'playstation', 'debts']);
    expect(total(sankey.sources)).toBe(295_000);
    expect(sankey.targets.map((node) => [node.key, node.amount])).toEqual([
      ['rent', 60_000], ['salary', 30_000], [GAME_CLUB_LEFT, 205_000],
    ]);
    expect(total(sankey.sources)).toBe(total(sankey.targets));
  });

  it('draws a balanced bar sankey from bar money only', () => {
    const sankey = buildDrillSankey({ kind: 'bar' }, ledgers);
    expect(sankey.sources.map((node) => [node.key, node.amount])).toEqual([['bar', 50_000]]);
    expect(sankey.targets.map((node) => [node.key, node.amount])).toEqual([
      [BAR_COST_TARGET, 30_000], ['supplies', 10_000], [BAR_LEFT, 10_000],
    ]);
    expect(total(sankey.sources)).toBe(total(sankey.targets));
  });

  it('covers a game club loss with a shortfall without touching bar money', () => {
    const losing = { ...ledgers, expenseRows: [...ledgers.expenseRows, expense('e4', '2026-09-03', 400_000, 'repair')] };
    const gameClub = buildDrillSankey({ kind: 'gameClub' }, losing);
    expect(gameClub.sources.find((node) => node.key === 'shortfall')?.amount).toBe(195_000);
    expect(gameClub.sources.some((node) => node.key === 'bar')).toBe(false);
    expect(gameClub.targets.some((node) => node.key === GAME_CLUB_LEFT)).toBe(false);
    expect(total(gameClub.sources)).toBe(total(gameClub.targets));

    const bar = buildDrillSankey({ kind: 'bar' }, losing);
    expect(bar.sources.map((node) => node.key)).toEqual(['bar']);
    expect(bar.targets.find((node) => node.key === BAR_LEFT)?.amount).toBe(10_000);

    const analysisWithLoss = buildFinancialAnalysis(range, losing);
    expect(analysisWithLoss.indicators.gameClub.left).toBe(-195_000);
    expect(analysisWithLoss.indicators.bar.left).toBe(10_000);
  });

  it('builds one daily row per date with spending groups by payment source', () => {
    expect(analysis.daily.map((day) => day.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(analysis.daily).toEqual([
      { date: '2026-09-01', gameClubIncome: 170_000, barSales: 40_000, barCost: 25_000, gameClubExpenses: 60_000, barExpenses: 0 },
      { date: '2026-09-02', gameClubIncome: 125_000, barSales: 0, barCost: 0, gameClubExpenses: 30_000, barExpenses: 0 },
      { date: '2026-09-03', gameClubIncome: 0, barSales: 10_000, barCost: 5_000, gameClubExpenses: 0, barExpenses: 10_000 },
    ]);
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
    expect(months[11]).toEqual({ month: '2026-09-01', gameClubIncome: 295_000, gameClubLeft: 205_000, barSales: 50_000, barLeft: 10_000 });
    expect(months[10]).toEqual({ month: '2026-08-01', gameClubIncome: 0, gameClubLeft: 0, barSales: 0, barLeft: 0 });
  });
});

describe('buildCategoryDetail', () => {
  const current = [
    expense('1', '2026-09-01', 100, 'rent'),
    expense('2', '2026-09-03', 50, 'rent', { payment_source: 'bar' }),
    expense('3', '2026-09-02', 30, 'tax'),
    expense('4', '2026-09-02', 20, OTHER_CATEGORY),
  ];
  const previous = [expense('5', '2026-08-01', 120, 'rent'), expense('6', '2026-08-01', 10, 'tax')];
  const top = foldCategories(groupExpensesByCategory(current), 1);

  it('lists one category newest first with totals and change', () => {
    const detail = buildCategoryDetail('rent', current, previous, top);
    expect(detail.rows.map((row) => row.id)).toEqual(['2', '1']);
    expect(detail).toMatchObject({ total: 150, count: 2, average: 75, previousTotal: 120, changePct: 25, share: 75, gameClubTotal: 100, barTotal: 50 });
  });

  it('collects every folded category for the other slice', () => {
    const detail = buildCategoryDetail(OTHER_CATEGORY, current, previous, top);
    expect(detail.rows.map((row) => row.id).sort()).toEqual(['3', '4']);
    expect(detail.total).toBe(50);
    expect(detail.previousTotal).toBe(10);
  });
});
