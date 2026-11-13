import { describe, expect, it } from 'vitest';
import {
  buildPeriodTrend,
  calculateAverageDailyIncome,
  calculateDashboardInventoryValue,
  calculateDashboardTotals,
  calculateGameClubMoneyLeftByPaymentMethod,
  calculateInventoryValue,
  calculateInventoryValueFromLatestStockCounts,
  countDashboardRangeDaysThroughDate,
  gameClubExpensePaymentBucket,
  getAverageIncomeDayCounts,
  getDashboardRange,
  percentChange,
  sumGameClubRows,
  withRunningDailyAverages,
  type ExpenseRow,
} from './dashboardMetrics';

const expense = (id: string, amount: number | null, overrides: Partial<ExpenseRow> = {}): ExpenseRow => ({
  id, date: '2026-07-10', amount: amount as number, category: 'rent', payment_method: 'cash', payment_source: 'game_club', comment: null,
  created_at: '2026-07-10T10:00:00Z', ...overrides,
});

describe('getDashboardRange', () => {
  // 15 November 2026 is a Sunday: the week it closes started on Monday the 9th.
  it('treats Sunday as the last day of its week', () => {
    expect(getDashboardRange('week', '2026-11-15')).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(getDashboardRange('lastWeek', '2026-11-15')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
  });

  it('starts the week on Monday for a midweek date', () => {
    // 13 November 2026 is a Friday.
    expect(getDashboardRange('week', '2026-11-13')).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(getDashboardRange('lastWeek', '2026-11-09')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
  });

  it('keeps a custom range in order and swaps a reversed one', () => {
    const ordered = { from: '2026-10-03', to: '2026-10-20' };
    expect(getDashboardRange('custom', '2026-11-13', ordered)).toBe(ordered);
    expect(getDashboardRange('custom', '2026-11-13', { from: '2026-10-20', to: '2026-10-03' })).toEqual(ordered);
    expect(getDashboardRange('custom', '2026-11-13', { from: '2026-10-03', to: '2026-10-03' })).toEqual({ from: '2026-10-03', to: '2026-10-03' });
  });

  it('falls back to the current month when a custom range is incomplete', () => {
    const november = { from: '2026-11-01', to: '2026-11-30' };
    expect(getDashboardRange('custom', '2026-11-13')).toEqual(november);
    expect(getDashboardRange('custom', '2026-11-13', { from: '2026-10-03', to: '' })).toEqual(november);
    expect(getDashboardRange('custom', '2026-11-13', { from: '', to: '2026-10-03' })).toEqual(november);
  });

  it('covers the whole previous month across a year boundary', () => {
    expect(getDashboardRange('lastMonth', '2027-01-10')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(getDashboardRange('yesterday', '2027-01-01')).toEqual({ from: '2026-12-31', to: '2026-12-31' });
    expect(getDashboardRange('last7Days', '2027-01-03')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });
});

describe('average daily income days', () => {
  const october = { from: '2026-10-01', to: '2026-10-31' };

  it('counts from the range start through the latest entry, never past the range', () => {
    expect(countDashboardRangeDaysThroughDate(october, '2026-10-14')).toBe(14);
    expect(countDashboardRangeDaysThroughDate(october, '2026-10-01')).toBe(1);
    // An entry after the range cannot stretch it.
    expect(countDashboardRangeDaysThroughDate(october, '2026-11-20')).toBe(31);
  });

  it('uses the full range when there is no entry in it', () => {
    expect(countDashboardRangeDaysThroughDate(october, null)).toBe(31);
    expect(countDashboardRangeDaysThroughDate(october, undefined)).toBe(31);
    expect(countDashboardRangeDaysThroughDate(october, '2026-09-30')).toBe(31);
  });

  it('measures each side by its own latest entry: cash or new debt for the club, stock count for the bar', () => {
    const counts = getAverageIncomeDayCounts(october, {
      cashRows: [{ date: '2026-10-03' }, { date: '2026-11-02' }],
      debtRows: [{ date: '2026-10-09' }, {}, { date: '2026-09-30' }],
      stockRows: [{ date: '2026-10-05' }],
    });
    expect(counts).toEqual({ gameClub: 9, bar: 5 });
    expect(getAverageIncomeDayCounts(october, { cashRows: [], stockRows: [] })).toEqual({ gameClub: 31, bar: 31 });
  });

  it('never divides by less than one day', () => {
    expect(calculateAverageDailyIncome(900, 0)).toBe(900);
    expect(calculateAverageDailyIncome(1_000, 3)).toBe(333);
  });

  it('ends each running average at that side latest entry', () => {
    const rows = [
      { date: '2026-10-01', gameClubIncome: 100, barSales: 30 },
      { date: '2026-10-02', gameClubIncome: 200, barSales: 0 },
      { date: '2026-10-03', gameClubIncome: 0, barSales: 0 },
    ];
    expect(withRunningDailyAverages(rows, { gameClub: '2026-10-02', bar: '2026-10-01' }).map((row) => [row.gameClubAverage, row.barAverage])).toEqual([
      [100, 30],
      // (100 + 200) / 2 days.
      [150, null],
      [null, null],
    ]);
    // Without a latest entry the line runs through the whole range: 300 / 3 and 30 / 3.
    expect(withRunningDailyAverages(rows, {}).at(-1)).toMatchObject({ gameClubAverage: 100, barAverage: 10 });
    expect(withRunningDailyAverages(rows, { gameClub: null, bar: null }).at(-1)).toMatchObject({ gameClubAverage: 100, barAverage: 10 });
  });
});

describe('game club collections with missing amounts', () => {
  it('counts a missing method as nothing collected', () => {
    const totals = sumGameClubRows([
      { date: '2026-07-10', cash_income: 500, terminal_income: null as never, card_income: null as never },
      { date: '2026-07-11', cash_income: null as never, terminal_income: 200, card_income: 0, playstation_income: 100 },
    ]);
    expect(totals).toEqual({
      cashIncome: 500, terminalIncome: 200, cardIncome: 0, playstationIncome: 100,
      // Computers are cash + terminal + card; PlayStation is counted apart and added for the club total.
      computerIncome: 700, gameClubIncome: 800,
    });
  });

  it('buckets any method outside cash, terminal and PlayStation as card money', () => {
    expect(gameClubExpensePaymentBucket('cash')).toBe('cash');
    expect(gameClubExpensePaymentBucket('terminal')).toBe('terminal');
    expect(gameClubExpensePaymentBucket('playstation')).toBe('playstation');
    for (const method of ['card', 'transfer', 'qr', '', null, undefined]) expect(gameClubExpensePaymentBucket(method)).toBe('card');
  });

  it('leaves a method alone for an expense or debt payment without an amount', () => {
    const left = calculateGameClubMoneyLeftByPaymentMethod(
      [{ date: '2026-07-10', cash_income: 500, terminal_income: 200, card_income: 100, playstation_income: 50 }],
      [expense('a', null), expense('b', 30, { payment_method: 'playstation' }), expense('c', 40, { payment_method: null })],
      [{ date: '2026-07-10', amount: null as never, payment_method: 'terminal' }, { date: '2026-07-10', amount: 25, payment_method: 'transfer' }],
    );
    // Card: 100 collected + 25 debt payment - 40 expense without a method.
    expect(left).toEqual({ cash: 500, terminal: 200, card: 85, playstation: 20 });
  });
});

describe('calculateDashboardTotals', () => {
  const cashRows = [{ date: '2026-07-10', cash_income: 500, terminal_income: 200, card_income: null as never, playstation_income: 100 }];
  const stockRows = [
    { date: '2026-07-10', bar_income: 400, bar_cost: 250, bar_profit: 150, sold_quantity: 10 },
    { date: '2026-07-11', bar_income: null as never, bar_cost: null as never, bar_profit: 0, sold_quantity: 0 },
  ];
  const purchases = [{ date: '2026-07-10', quantity: 4, cost_price: 20 }];
  const expenses = [expense('gc', 150), expense('bar', 60, { payment_source: 'bar' }), expense('none', null), expense('bar-none', null, { payment_source: 'bar' })];
  const products = [
    { current_stock: 3, cost_price: 10 },
    { current_stock: null as never, cost_price: 5 },
    { current_stock: 2, cost_price: null as never },
    { current_stock: 100, cost_price: 100, tracks_inventory: false },
  ];
  const debts = [
    { date: '2026-07-10', amount: 300, remaining_amount: 300, status: 'unpaid' },
    { date: '2026-07-10', remaining_amount: null as never, status: 'partial' },
    { date: '2026-07-11', amount: 50, remaining_amount: 0, status: 'paid' },
  ];
  const debtPayments = [{ date: '2026-07-11', amount: 120, payment_method: 'cash' }, { date: '2026-07-11', amount: null as never, payment_method: 'cash' }];
  const totals = calculateDashboardTotals(cashRows, stockRows, purchases, expenses, products, debts, debtPayments);

  it('counts new debts as income and debt payments only as cash collected', () => {
    expect(totals).toMatchObject({
      cashIncome: 500, terminalIncome: 200, cardIncome: 0, playstationIncome: 100,
      debtIncome: 350, debtPaymentsCollected: 120,
      // 700 from computers + 350 new debt; plus 100 PlayStation for the club.
      computerIncome: 1_050, gameClubIncome: 1_150,
    });
  });

  it('keeps Game Club profit apart from Game Club money left', () => {
    expect(totals.gameClubExpenses).toBe(150);
    // Profit: 1 150 income (with new debts) - 150 expenses.
    expect(totals.gameClubProfit).toBe(1_000);
    // Money left: 800 actually collected + 120 debt payments - 150 expenses. Unpaid debt is not cash.
    expect(totals.gameClubMoneyLeft).toBe(770);
  });

  it('keeps Bar accounting profit apart from Bar cash left', () => {
    expect(totals).toMatchObject({ barSales: 400, barCost: 250, stockPurchaseCost: 80, barExpenses: 60 });
    // Profit: 400 sales - 250 cost of goods sold - 60 Bar expense.
    expect(totals.barProfit).toBe(90);
    // Cash left: 400 sales - 80 stock bought - 60 Bar expense.
    expect(totals.barIncome).toBe(260);
  });

  it('totals every expense only for breakdowns, and values tracked stock at cost', () => {
    expect(totals.totalExpenses).toBe(210);
    expect(totals.inventoryValue).toBe(30);
  });

  it('counts unpaid and partly paid debts as active', () => {
    expect(totals).toMatchObject({ activeDebts: 300, activeDebtCount: 2 });
  });

  it('takes active debts from the all-time snapshot when one is given', () => {
    const snapshot = [
      { remaining_amount: 900, status: 'unpaid' },
      { remaining_amount: 100, status: 'partial' },
      { remaining_amount: 0, status: 'paid' },
    ];
    const withSnapshot = calculateDashboardTotals(cashRows, stockRows, purchases, expenses, products, debts, debtPayments, snapshot);
    expect(withSnapshot).toMatchObject({ activeDebts: 1_000, activeDebtCount: 2, debtIncome: 350 });
  });

  it('does not deduct a stock purchase dated before the deduction start from Bar cash', () => {
    const early = calculateDashboardTotals([], stockRows, [{ date: '2026-07-01', quantity: 4, cost_price: 20 }], [], [], []);
    expect(early).toMatchObject({ stockPurchaseCost: 0, barIncome: 400, barProfit: 150 });
  });
});

describe('inventory value', () => {
  it('skips products that do not track inventory', () => {
    expect(calculateInventoryValue([{ current_stock: 4, cost_price: 25 }, { current_stock: 9, cost_price: 9, tracks_inventory: false }, { current_stock: 1, cost_price: 5, tracks_inventory: true }])).toBe(105);
    expect(calculateInventoryValue([])).toBe(0);
  });

  const rows = [
    { product_id: 'p1', date: '2026-09-30', closing_stock: 5, cost_price: 10 },
    // An older count listed later must not replace the latest one.
    { product_id: 'p1', date: '2026-09-10', closing_stock: 99, cost_price: 10 },
    { product_id: 'p2', date: '2026-09-30', closing_stock: 8, cost_price: 10, products: [{ tracks_inventory: false }] },
    { product_id: 'p3', date: '2026-09-30', closing_stock: null as never, cost_price: 10, products: [{ tracks_inventory: true }] },
    { product_id: 'p4', date: '2026-09-30', closing_stock: 2, cost_price: null as never, products: null },
    { product_id: 'p5', date: '2026-09-30', closing_stock: 6, cost_price: 10, products: { tracks_inventory: false } },
    { product_id: 'p6', date: '2026-09-29', closing_stock: 3, cost_price: 7, products: [] },
    { product_id: 'p6', date: '2026-10-02', closing_stock: 1, cost_price: 7, products: {} },
  ];

  it('values each tracked product at its latest count', () => {
    // p1: 5 x 10; p6: latest count is 1 x 7; the untracked and unpriced ones add nothing.
    expect(calculateInventoryValueFromLatestStockCounts(rows)).toBe(57);
  });

  it('uses last month counts only for the last-month period', () => {
    const september = { from: '2026-09-01', to: '2026-09-30' };
    // Within September p6's latest count is 3 x 7.
    expect(calculateDashboardInventoryValue('lastMonth', 12_345, rows, september)).toBe(71);
    expect(calculateDashboardInventoryValue('month', 12_345, rows, september)).toBe(12_345);
    expect(calculateDashboardInventoryValue('custom', 12_345, rows, september)).toBe(12_345);
  });
});

describe('percentChange', () => {
  it('has no percentage against an empty previous period', () => {
    expect(percentChange(500, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });

  it('measures against the size of a negative previous value', () => {
    // From -100 to 50 is an improvement of 150.
    expect(percentChange(50, -100)).toBe(150);
    expect(percentChange(-150, -100)).toBe(-50);
    expect(percentChange(150, 100)).toBe(50);
  });
});

describe('buildPeriodTrend', () => {
  it('lists every day of the range with each side own income, new debts on their issue date', () => {
    const trend = buildPeriodTrend(
      { from: '2026-10-30', to: '2026-11-01' },
      [
        { date: '2026-10-30', cash_income: 100, terminal_income: 50, card_income: 0, playstation_income: 10 },
        { date: '2026-10-30', cash_income: 40, terminal_income: 0, card_income: 0 },
        { date: '2026-11-02', cash_income: 9_999, terminal_income: 0, card_income: 0 },
      ],
      [
        { date: '2026-10-31', bar_income: 70, bar_cost: 40, bar_profit: 30, sold_quantity: 3 },
        { date: '2026-10-31', bar_income: null as never, bar_cost: 0, bar_profit: 0, sold_quantity: 0 },
      ],
      [{ date: '2026-10-31', amount: 25, remaining_amount: 25, status: 'unpaid' }, { date: '2026-10-31', remaining_amount: 0, status: 'unpaid' }],
    );
    expect(trend).toEqual([
      { date: '2026-10-30', gameClubIncome: 200, barSales: 0 },
      { date: '2026-10-31', gameClubIncome: 25, barSales: 70 },
      { date: '2026-11-01', gameClubIncome: 0, barSales: 0 },
    ]);
  });

  it('is one day for a single-date or reversed range', () => {
    expect(buildPeriodTrend({ from: '2026-10-30', to: '2026-10-30' }, [], [])).toEqual([{ date: '2026-10-30', gameClubIncome: 0, barSales: 0 }]);
    expect(buildPeriodTrend({ from: '2026-10-30', to: '2026-10-20' }, [], [])).toHaveLength(1);
  });
});
