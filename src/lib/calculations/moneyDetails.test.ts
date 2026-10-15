import { describe, expect, it } from 'vitest';
import { STOCK_PURCHASE_DEDUCTION_START_DATE } from './barMoney';
import { calculateDashboardTotals, type ExpenseRow } from './dashboardMetrics';
import { buildBarMoneyDetailRows, buildGameClubMoneyDetailRows } from './moneyDetails';
import { buildMoneyReport } from './moneyReport';

const cashRows = [
  { date: '2026-07-01', cash_income: 500_000, terminal_income: 200_000, card_income: 0, playstation_income: 150_000 },
  { date: '2026-07-02', cash_income: 300_000, terminal_income: 0, card_income: 100_000, playstation_income: 50_000 },
];

const debtPaymentRows = [
  { date: '2026-07-02', amount: 80_000, payment_method: 'cash' },
];

const stockRows = [
  { date: '2026-07-01', bar_income: 400_000, bar_profit: 150_000, bar_cost: 250_000, sold_quantity: 20 },
  { date: '2026-07-02', bar_income: 250_000, bar_profit: 100_000, bar_cost: 150_000, sold_quantity: 12 },
];

const purchaseRows = [
  // Before the cutoff: never deducted from bar money.
  { date: '2026-07-01', quantity: 10, cost_price: 12_000, comment: null, product_name: 'Cola' },
  // On the cutoff: deducted.
  { date: STOCK_PURCHASE_DEDUCTION_START_DATE, quantity: 5, cost_price: 9_000, comment: 'Snacks box', product_name: null },
];

const expenseRows: ExpenseRow[] = [
  {
    id: 'rent',
    date: '2026-07-01',
    amount: 120_000,
    category: 'rent',
    payment_method: 'cash',
    // No source recorded: counts as game-club money.
    payment_source: null,
    comment: null,
    created_at: '2026-07-01T10:00:00Z',
  },
  {
    id: 'bar-ice',
    date: '2026-07-01',
    amount: 30_000,
    category: 'other',
    payment_method: 'cash',
    payment_source: 'bar',
    comment: 'ice',
    created_at: '2026-07-01T11:00:00Z',
  },
  {
    id: 'salary',
    date: '2026-07-02',
    amount: 90_000,
    category: 'salary',
    payment_method: 'card',
    payment_source: 'game_club',
    comment: 'advance',
    created_at: '2026-07-02T09:00:00Z',
  },
];

const dashboard = calculateDashboardTotals(cashRows, stockRows, purchaseRows, expenseRows, [], [], debtPaymentRows);
const report = buildMoneyReport(cashRows, expenseRows, debtPaymentRows, stockRows, purchaseRows);

describe('game club money detail rows', () => {
  const rows = buildGameClubMoneyDetailRows(cashRows, debtPaymentRows, expenseRows, ['cash', 'terminal']);

  it('counts a null payment_source expense as game-club money and includes playstation income', () => {
    expect(rows.map((row) => row.date)).toEqual(['2026-07-01', '2026-07-02']);

    const [first, second] = rows;
    expect(first.collected).toEqual([
      { key: 'cash', amount: 500_000 },
      { key: 'terminal', amount: 200_000 },
      { key: 'playstation', amount: 150_000 },
      { key: 'debtPayments', amount: 0 },
    ]);
    expect(first.collectedTotal).toBe(850_000);
    expect(first.deductions).toEqual([
      { kind: 'expense', category: 'rent', comment: null, amount: 120_000 },
    ]);
    expect(first.deductionsTotal).toBe(120_000);
    expect(first.moneyLeft).toBe(730_000);

    expect(second.collected).toEqual([
      { key: 'cash', amount: 300_000 },
      { key: 'terminal', amount: 0 },
      { key: 'card', amount: 100_000 },
      { key: 'playstation', amount: 50_000 },
      { key: 'debtPayments', amount: 80_000 },
    ]);
    expect(second.deductions).toEqual([
      { kind: 'expense', category: 'salary', comment: 'advance', amount: 90_000 },
    ]);
    expect(second.moneyLeft).toBe(440_000);
  });

  it('adds up to the dashboard and money report game-club totals', () => {
    const moneyLeft = rows.reduce((sum, row) => sum + row.moneyLeft, 0);
    const deductions = rows.reduce((sum, row) => sum + row.deductionsTotal, 0);

    expect(moneyLeft).toBe(dashboard.gameClubMoneyLeft);
    expect(moneyLeft).toBe(report.totalLeft - report.barLeft);
    expect(deductions).toBe(dashboard.gameClubExpenses);
    expect(rows.map((row) => row.moneyLeft)).toEqual(
      [...report.days].reverse().map((day) => day.total),
    );
  });

  it('does not create a day for bar-paid expenses alone', () => {
    const onlyBar = buildGameClubMoneyDetailRows([], [], [expenseRows[1]], ['cash']);
    expect(onlyBar).toEqual([]);
  });

  it('accepts fallback rows without ids, timestamps, or payment methods', () => {
    const fallback = buildGameClubMoneyDetailRows(
      [{ date: '2026-07-03', cash_income: 10_000, terminal_income: 0, card_income: 0 }],
      [{ date: '2026-07-03', amount: 5_000 }],
      [{ date: '2026-07-03', amount: 2_000, category: 'other', payment_source: null, comment: null }],
      ['cash'],
    );
    expect(fallback).toHaveLength(1);
    expect(fallback[0].moneyLeft).toBe(13_000);
  });
});

describe('bar money detail rows', () => {
  const rows = buildBarMoneyDetailRows(stockRows, purchaseRows, expenseRows);

  it('deducts purchases only from the cutoff date and bar-paid expenses', () => {
    expect(rows.map((row) => row.date)).toEqual(['2026-07-01', '2026-07-02']);

    const [first, second] = rows;
    expect(first.collected).toEqual([{ key: 'barSales', amount: 400_000 }]);
    expect(first.deductions).toEqual([
      { kind: 'expense', category: 'other', comment: 'ice', amount: 30_000 },
    ]);
    expect(first.moneyLeft).toBe(370_000);

    expect(second.deductions).toEqual([
      { kind: 'purchase', name: 'Snacks box', quantity: 5, amount: 45_000 },
    ]);
    expect(second.deductionsTotal).toBe(45_000);
    expect(second.moneyLeft).toBe(205_000);
  });

  it('adds up to the dashboard and money report bar totals', () => {
    const moneyLeft = rows.reduce((sum, row) => sum + row.moneyLeft, 0);
    const sales = rows.reduce((sum, row) => sum + row.collectedTotal, 0);
    const deductions = rows.reduce((sum, row) => sum + row.deductionsTotal, 0);

    expect(moneyLeft).toBe(dashboard.barIncome);
    expect(moneyLeft).toBe(report.barLeft);
    expect(sales).toBe(dashboard.barSales);
    expect(deductions).toBe(dashboard.stockPurchaseCost + dashboard.barExpenses);
  });

  it('does not create a day for a purchase before the cutoff', () => {
    expect(buildBarMoneyDetailRows([], [purchaseRows[0]], [])).toEqual([]);
  });
});
