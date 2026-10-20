import { describe, expect, it } from 'vitest';
import type { ExpenseRow } from './dashboardMetrics';
import { BAR_COST_TARGET, OTHER_CATEGORY, buildFinancialAnalysis, type AnalysisLedgers } from './financialAnalysis';
import {
  BAR_LEFT,
  GAME_CLUB_LEFT,
  MORE_PAYMENTS,
  NOTE_PREFIX,
  NO_COMMENT,
  PAID_FROM_BAR,
  PAID_FROM_GAME_CLUB,
  buildDrillSankey,
  drillExpenseRows,
} from './sankeyDrill';

function expense(id: string, date: string, amount: number, category: string, extra: Partial<ExpenseRow> = {}): ExpenseRow {
  return { id, date, amount, category, comment: null, created_at: `${date}T10:00:00Z`, ...extra };
}

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
    expense('e1', '2026-09-01', 60_000, 'rent', { payment_source: 'game_club', comment: 'September' }),
    expense('e2', '2026-09-02', 30_000, 'salary', { payment_source: 'game_club' }),
    expense('e3', '2026-09-03', 10_000, 'supplies', { payment_source: 'bar', comment: 'Cups' }),
    expense('e4', '2026-09-03', 4_000, 'rent', { payment_source: 'bar', comment: 'September' }),
  ],
  debtRows: [
    { date: '2026-09-02', amount: 15_000, remaining_amount: 5_000, status: 'unpaid' },
    { date: '2026-09-03', amount: 3_000, remaining_amount: 0, status: 'paid' },
  ],
  debtPaymentRows: [],
};

const total = (nodes: Array<{ amount: number }>) => nodes.reduce((sum, node) => sum + node.amount, 0);
const amounts = (nodes: Array<{ key: string; amount: number }>) => Object.fromEntries(nodes.map((node) => [node.key, node.amount]));

describe('sankey drill-downs', () => {
  const analysis = buildFinancialAnalysis({ from: '2026-09-01', to: '2026-09-03' }, ledgers);

  it('traces game club money to its expenses and what is left', () => {
    const sankey = buildDrillSankey({ kind: 'gameClub' }, ledgers);
    expect(amounts(sankey.sources)).toEqual({ computers: 260_000, playstation: 20_000, debts: 18_000 });
    expect(amounts(sankey.targets)).toEqual({ rent: 60_000, salary: 30_000, [GAME_CLUB_LEFT]: 208_000 });
    expect(sankey.income).toBe(298_000);
    expect(total(sankey.sources)).toBe(total(sankey.targets));
    expect(sankey.targets.find((node) => node.key === GAME_CLUB_LEFT)?.amount).toBe(analysis.totals.gameClubProfit);
    // What is left over is not joined with the bar's money, so it opens nothing.
    expect(sankey.targets.find((node) => node.key === GAME_CLUB_LEFT)?.open).toBeUndefined();
    // A category here opens only its game-club payments.
    expect(sankey.targets.find((node) => node.key === 'rent')?.open).toEqual({ kind: 'category', category: 'rent', source: 'game_club' });
  });

  it('traces bar sales to goods cost, bar-paid expenses and bar profit', () => {
    const sankey = buildDrillSankey({ kind: 'bar' }, ledgers);
    expect(amounts(sankey.sources)).toEqual({ bar: 50_000 });
    expect(amounts(sankey.targets)).toEqual({ [BAR_COST_TARGET]: 30_000, supplies: 10_000, rent: 4_000, [BAR_LEFT]: 6_000 });
    expect(total(sankey.sources)).toBe(total(sankey.targets));
    expect(sankey.targets.find((node) => node.key === BAR_LEFT)?.amount).toBe(analysis.totals.barProfit);
    expect(sankey.targets.find((node) => node.key === BAR_LEFT)?.open).toBeUndefined();
  });

  it('covers a bar loss with a shortfall instead of game club money', () => {
    const losing = { ...ledgers, expenseRows: [...ledgers.expenseRows, expense('e5', '2026-09-03', 20_000, 'repairs', { payment_source: 'bar' })] };
    const bar = buildDrillSankey({ kind: 'bar' }, losing);
    expect(amounts(bar.sources)).toEqual({ bar: 50_000, shortfall: 14_000 });
    expect(bar.sources.find((node) => node.key === 'shortfall')?.open).toBeUndefined();
    expect(bar.targets.some((node) => node.key === BAR_LEFT)).toBe(false);
    expect(total(bar.sources)).toBe(total(bar.targets));

    // The game club's own flow is unaffected by the bar's loss.
    const gameClub = buildDrillSankey({ kind: 'gameClub' }, losing);
    expect(amounts(gameClub.sources)).toEqual({ computers: 260_000, playstation: 20_000, debts: 18_000 });
    expect(gameClub.targets.find((node) => node.key === GAME_CLUB_LEFT)?.amount).toBe(208_000);
  });

  it('shows a category by the money that paid it and what its payments were for', () => {
    const sankey = buildDrillSankey({ kind: 'category', category: 'rent' }, ledgers);
    expect(amounts(sankey.sources)).toEqual({ [PAID_FROM_GAME_CLUB]: 60_000, [PAID_FROM_BAR]: 4_000 });
    expect(amounts(sankey.targets)).toEqual({ [`${NOTE_PREFIX}September`]: 64_000 });

    const scoped = buildDrillSankey({ kind: 'category', category: 'rent', source: 'bar' }, ledgers);
    expect(amounts(scoped.sources)).toEqual({ [PAID_FROM_BAR]: 4_000 });
    expect(drillExpenseRows({ kind: 'category', category: 'salary' }, ledgers.expenseRows).map((row) => row.id)).toEqual(['e2']);
    expect(amounts(buildDrillSankey({ kind: 'category', category: 'salary' }, ledgers).targets)).toEqual({ [NO_COMMENT]: 30_000 });
  });

  it('folds a category with many different payments', () => {
    const rows = Array.from({ length: 9 }, (_, index) => expense(`n${index}`, '2026-09-01', 1_000 * (index + 1), 'repairs', { comment: `Fix ${index}` }));
    const sankey = buildDrillSankey({ kind: 'category', category: 'repairs' }, { ...ledgers, expenseRows: rows });
    expect(sankey.targets).toHaveLength(8);
    expect(sankey.targets.at(-1)).toEqual({ key: MORE_PAYMENTS, amount: 1_000 + 2_000 });
  });

  it('opens the folded category as the categories it holds', () => {
    const target = { kind: 'category' as const, category: OTHER_CATEGORY, named: ['rent'] };
    const sankey = buildDrillSankey(target, ledgers);
    expect(amounts(sankey.targets)).toEqual({ salary: 30_000, supplies: 10_000 });
    expect(sankey.targets[0].open).toEqual({ kind: 'category', category: 'salary', source: undefined });
    expect(drillExpenseRows(target, ledgers.expenseRows).map((row) => row.id)).toEqual(['e3', 'e2']);
  });
});
