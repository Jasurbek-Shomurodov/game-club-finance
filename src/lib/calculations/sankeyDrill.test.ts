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
  PAYMENT_PREFIX,
  buildDrillSankey,
  drillDetailsHref,
  drillExpenseRows,
  type DrillTarget,
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
    expect(sankey.targets.at(-1)).toMatchObject({ key: MORE_PAYMENTS, amount: 1_000 + 2_000 });
    // The folded rest opens its own payments, one by one, each opening its details.
    const more = sankey.targets.at(-1)?.open;
    expect(more).toEqual({ kind: 'category', category: 'repairs', notes: [`${NOTE_PREFIX}Fix 1`, `${NOTE_PREFIX}Fix 0`] });
    const payments = buildDrillSankey(more!, { ...ledgers, expenseRows: rows });
    expect(amounts(payments.targets)).toEqual({ [`${PAYMENT_PREFIX}n1`]: 2_000, [`${PAYMENT_PREFIX}n0`]: 1_000 });
    expect(payments.targets.find((node) => node.key === `${PAYMENT_PREFIX}n1`)?.open).toEqual({ kind: 'payment', id: 'n1', date: '2026-09-01', category: 'repairs', source: 'game_club' });
  });

  it('opens a comment on one payment as that payment, and a shared one as its payments', () => {
    const rows = [
      expense('a', '2026-09-01', 5_000, 'repairs', { comment: 'Mouse' }),
      expense('b', '2026-09-02', 3_000, 'repairs'),
      expense('c', '2026-09-03', 2_000, 'repairs', { payment_source: 'bar' }),
    ];
    const sankey = buildDrillSankey({ kind: 'category', category: 'repairs' }, { ...ledgers, expenseRows: rows });
    const open = (key: string) => sankey.targets.find((node) => node.key === key)?.open;
    expect(open(`${NOTE_PREFIX}Mouse`)).toEqual({ kind: 'payment', id: 'a', date: '2026-09-01', category: 'repairs', source: 'game_club' });
    const shared = open(NO_COMMENT);
    expect(shared).toEqual({ kind: 'category', category: 'repairs', notes: [NO_COMMENT] });
    expect(drillExpenseRows(shared as Extract<DrillTarget, { kind: 'category' }>, rows).map((row) => row.id)).toEqual(['c', 'b']);
    // The money that paid a category opens that side's own flow.
    expect(sankey.sources.find((node) => node.key === PAID_FROM_GAME_CLUB)?.open).toEqual({ kind: 'gameClub' });
    expect(sankey.sources.find((node) => node.key === PAID_FROM_BAR)?.open).toEqual({ kind: 'bar' });

    const payment = buildDrillSankey({ kind: 'payment', id: 'c', date: '2026-09-03', category: 'repairs', source: 'bar' }, { ...ledgers, expenseRows: rows });
    expect(amounts(payment.sources)).toEqual({ [PAID_FROM_BAR]: 2_000 });
    expect(amounts(payment.targets)).toEqual({ [`${PAYMENT_PREFIX}c`]: 2_000 });
  });

  it('opens the folded category as the categories it holds', () => {
    const target = { kind: 'category' as const, category: OTHER_CATEGORY, named: ['rent'] };
    const sankey = buildDrillSankey(target, ledgers);
    expect(amounts(sankey.targets)).toEqual({ salary: 30_000, supplies: 10_000 });
    expect(sankey.targets[0].open).toEqual({ kind: 'category', category: 'salary', source: undefined });
    expect(drillExpenseRows(target, ledgers.expenseRows).map((row) => row.id)).toEqual(['e3', 'e2']);
  });
});

describe('drillDetailsHref', () => {
  const range = { from: '2026-10-01', to: '2026-10-31' };

  it('opens each side on its money details page for the period', () => {
    expect(drillDetailsHref({ kind: 'gameClub' }, range)).toBe('/game-club-money-details?from=2026-10-01&to=2026-10-31');
    expect(drillDetailsHref({ kind: 'bar' }, range)).toBe('/bar-money-details?from=2026-10-01&to=2026-10-31');
  });

  it('opens a category in reports filtered to it', () => {
    expect(drillDetailsHref({ kind: 'category', category: 'correction', source: 'game_club' }, range))
      .toBe('/reports?from=2026-10-01&to=2026-10-31&category=expense%3Acorrection&source=game_club');
    expect(drillDetailsHref({ kind: 'category', category: 'utilities', source: 'bar' }, range))
      .toBe('/reports?from=2026-10-01&to=2026-10-31&category=expense%3Autilities&source=bar');
  });

  it('opens a payment in reports on its own day, category and money', () => {
    expect(drillDetailsHref({ kind: 'payment', id: 'p', date: '2026-10-17', category: 'repairs', source: 'game_club' }, range))
      .toBe('/reports?from=2026-10-17&to=2026-10-17&category=expense%3Arepairs&source=game_club');
  });

  it('opens every expense for the folded other category', () => {
    expect(drillDetailsHref({ kind: 'category', category: OTHER_CATEGORY, named: ['rent'] }, range))
      .toBe('/reports?from=2026-10-01&to=2026-10-31&category=expense');
  });
});
