import { describe, expect, it } from 'vitest';
import {
  buildPeriodTrend,
  calculateAverageDailyIncome,
  calculateDashboardInventoryValue,
  calculateDashboardTotals,
  calculateGameClubMoneyLeftByPaymentMethod,
  calculateInventoryValue,
  calculateInventoryValueFromLatestStockCounts,
  countDashboardRangeDays,
  countDashboardRangeDaysThroughDate,
  getDashboardAverageDayCount,
  getDashboardComparisonRange,
  getDashboardRange,
  getLatestRowDateInRange,
  getPreviousDashboardRange,
  localIsoDate,
  percentChange,
} from './dashboardMetrics';

describe('dashboard metrics', () => {
  it('includes daily cash entry in game club income and profit', () => {
    const totals = calculateDashboardTotals(
      [
        {
          date: '2026-06-03',
          cash_income: 3_222_222,
          terminal_income: 100_000,
          card_income: 50_000,
          playstation_income: 200_000,
        },
      ],
      [],
      [],
      [],
      [],
      [],
    );

    expect(totals.cashIncome).toBe(3_222_222);
    expect(totals.computerIncome).toBe(3_372_222);
    expect(totals.playstationIncome).toBe(200_000);
    expect(totals.gameClubIncome).toBe(3_572_222);
    expect(totals.gameClubProfit).toBe(3_572_222);
    expect(totals.gameClubMoneyLeft).toBe(3_572_222);
  });

  it('deducts stock purchases from July 2 onward from closing stock bar income', () => {
    const totals = calculateDashboardTotals(
      [],
      [
        {
          date: '2026-07-02',
          bar_income: 30_000,
          bar_profit: 9_600,
          bar_cost: 20_400,
          sold_quantity: 2,
        },
        {
          date: '2026-07-02',
          bar_income: 48_000,
          bar_profit: 17_314.285714285714,
          bar_cost: 30_685.714285714286,
          sold_quantity: 4,
        },
      ],
      [
        { date: '2026-07-01', quantity: 10, cost_price: 10_000 },
        { date: '2026-07-02', quantity: 2, cost_price: 10_000 },
      ],
      [],
      [],
      [],
    );

    expect(totals.barSales).toBe(78_000);
    expect(totals.barCost).toBeCloseTo(51_085.714285714286);
    expect(totals.stockPurchaseCost).toBe(20_000);
    expect(totals.barIncome).toBe(58_000);
    expect(totals.barProfit).toBeCloseTo(26_914.285714285714);
    expect(totals.gameClubProfit).toBe(0);
  });

  it('combines cash, closing stock, expenses, inventory, and debts per side of the club', () => {
    const totals = calculateDashboardTotals(
      [
        {
          date: '2026-07-02',
          cash_income: 3_222_222,
          terminal_income: 0,
          card_income: 0,
          playstation_income: 100_000,
        },
      ],
      [
        {
          date: '2026-07-02',
          bar_income: 78_000,
          bar_profit: 26_914.285714285714,
          bar_cost: 51_085.714285714286,
          sold_quantity: 6,
        },
      ],
      [{ date: '2026-07-02', quantity: 2, cost_price: 10_000 }],
      [
        {
          id: 'expense-1',
          date: '2026-07-02',
          amount: 120_000,
          category: 'cleaning',
          comment: null,
          created_at: '2026-07-02T04:11:28.668588+00:00',
        },
      ],
      [{ current_stock: 20, cost_price: 7_671.428571428572 }],
      [
        { remaining_amount: 100_000, status: 'unpaid' },
        { remaining_amount: 50_000, status: 'paid' },
      ],
    );

    expect(totals.gameClubIncome).toBe(3_322_222);
    expect(totals.barSales).toBe(78_000);
    expect(totals.stockPurchaseCost).toBe(20_000);
    expect(totals.barIncome).toBe(58_000);
    expect(totals.barProfit).toBeCloseTo(26_914.285714285714);
    expect(totals.totalExpenses).toBe(120_000);
    expect(totals.gameClubExpenses).toBe(120_000);
    expect(totals.barExpenses).toBe(0);
    expect(totals.gameClubMoneyLeft).toBe(3_202_222);
    expect(totals.gameClubProfit).toBe(3_202_222);
    expect(totals.inventoryValue).toBeCloseTo(153_428.57142857145);
    expect(totals.activeDebts).toBe(100_000);
    expect(totals.activeDebtCount).toBe(1);
  });

  it('recognizes issued debt as revenue but not as collected money', () => {
    const debt = {
      date: '2026-07-04',
      amount: 120_000,
      remaining_amount: 120_000,
      status: 'unpaid',
    };
    const totals = calculateDashboardTotals([], [], [], [], [], [debt]);

    expect(totals.debtIncome).toBe(120_000);
    expect(totals.computerIncome).toBe(120_000);
    expect(totals.gameClubIncome).toBe(120_000);
    expect(totals.gameClubProfit).toBe(120_000);
    expect(totals.gameClubMoneyLeft).toBe(0);
    expect(totals.activeDebts).toBe(120_000);
  });

  it('treats repayments as collections without recognizing income twice', () => {
    const totals = calculateDashboardTotals(
      [],
      [],
      [],
      [],
      [],
      [],
      [{ date: '2026-07-05', amount: 50_000, payment_method: 'cash' }],
    );

    expect(totals.debtIncome).toBe(0);
    expect(totals.debtPaymentsCollected).toBe(50_000);
    expect(totals.gameClubProfit).toBe(0);
    expect(totals.gameClubMoneyLeft).toBe(50_000);
  });

  it('calculates percentage changes against negative previous values', () => {
    expect(percentChange(8_902_000, -700_000)).toBe(1372);
    expect(percentChange(-1_000, -500)).toBe(-100);
    expect(percentChange(-500, -1_000)).toBe(50);
    expect(percentChange(8_902_000, 0)).toBeNull();
  });

  it('compares calendar months without leaking a day from the month before', () => {
    // A finished month (today is later) compares in full.
    expect(
      getDashboardComparisonRange('month', { from: '2026-07-01', to: '2026-07-31' }, '2026-08-10'),
    ).toEqual({ from: '2026-06-01', to: '2026-06-30' });
    expect(
      getDashboardComparisonRange('lastMonth', { from: '2026-06-01', to: '2026-06-30' }, '2026-07-14'),
    ).toEqual({ from: '2026-05-01', to: '2026-05-31' });
    // The month's last day is already the full month.
    expect(
      getDashboardComparisonRange('month', { from: '2026-07-01', to: '2026-07-31' }, '2026-07-31'),
    ).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });

  it('compares month-to-date with the same days of the previous month', () => {
    expect(
      getDashboardComparisonRange('month', { from: '2026-10-01', to: '2026-10-31' }, '2026-10-14'),
    ).toEqual({ from: '2026-09-01', to: '2026-09-14' });
    // The previous month's last day clamps a later day-of-month.
    expect(
      getDashboardComparisonRange('month', { from: '2026-03-01', to: '2026-03-31' }, '2026-03-30'),
    ).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(
      getDashboardComparisonRange('month', { from: '2026-05-01', to: '2026-05-31' }, '2026-05-01'),
    ).toEqual({ from: '2026-04-01', to: '2026-04-01' });
  });

  it('compares other in-progress ranges with the same elapsed days', () => {
    // Wednesday of the week 2026-06-01..07 compares with last Monday..Wednesday.
    expect(
      getDashboardComparisonRange('week', { from: '2026-06-01', to: '2026-06-07' }, '2026-06-03'),
    ).toEqual({ from: '2026-05-25', to: '2026-05-27' });
    // A range that ends today is already complete.
    expect(
      getDashboardComparisonRange('last7Days', { from: '2026-06-01', to: '2026-06-07' }, '2026-06-07'),
    ).toEqual({ from: '2026-05-25', to: '2026-05-31' });
  });

  it('calculates inventory value from latest closing stock per product', () => {
    expect(
      calculateInventoryValueFromLatestStockCounts([
        { product_id: 'cola', date: '2026-06-01', closing_stock: 10, cost_price: 4_000 },
        { product_id: 'cola', date: '2026-06-30', closing_stock: 7, cost_price: 4_500 },
        { product_id: 'water', date: '2026-06-12', closing_stock: 12, cost_price: 2_000 },
      ]),
    ).toBe(55_500);
  });

  it('uses the selected month closing stock for the last-month dashboard', () => {
    const rows = [
      { product_id: 'cola', date: '2026-06-30', closing_stock: 9, cost_price: 4_000 },
      { product_id: 'cola', date: '2026-07-31', closing_stock: 7, cost_price: 4_500 },
      { product_id: 'water', date: '2026-07-15', closing_stock: 12, cost_price: 2_000 },
      { product_id: 'cola', date: '2026-08-01', closing_stock: 6, cost_price: 4_500 },
    ];
    const july = { from: '2026-07-01', to: '2026-07-31' };

    expect(calculateDashboardInventoryValue('month', 99_000, rows, july)).toBe(99_000);
    expect(calculateDashboardInventoryValue('lastMonth', 99_000, rows, july)).toBe(55_500);
  });

  it('excludes made-to-order products from current and historical inventory value', () => {
    expect(calculateInventoryValue([
      { current_stock: 10, cost_price: 4_000, tracks_inventory: true },
      { current_stock: 922, cost_price: 11_000, tracks_inventory: false },
    ])).toBe(40_000);

    expect(calculateInventoryValueFromLatestStockCounts([
      {
        product_id: 'hot-dog',
        date: '2026-07-22',
        closing_stock: 922,
        cost_price: 11_000,
        products: { tracks_inventory: false },
      },
      {
        product_id: 'cola',
        date: '2026-07-22',
        closing_stock: 10,
        cost_price: 4_000,
        products: { tracks_inventory: true },
      },
    ])).toBe(40_000);
  });

  it('subtracts expenses from the selected money source only', () => {
    const totals = calculateDashboardTotals(
      [
        {
          date: '2026-07-04',
          cash_income: 500_000,
          terminal_income: 0,
          card_income: 0,
          playstation_income: 0,
        },
      ],
      [{ date: '2026-07-04', bar_income: 300_000, bar_profit: 100_000, bar_cost: 200_000, sold_quantity: 10 }],
      [{ date: '2026-07-04', quantity: 2, cost_price: 50_000 }],
      [
        {
          id: 'game-club-expense',
          date: '2026-07-04',
          amount: 120_000,
          category: 'salary',
          payment_source: 'game_club',
          comment: null,
          created_at: '2026-07-04T10:00:00Z',
        },
        {
          id: 'bar-expense',
          date: '2026-07-04',
          amount: 40_000,
          category: 'repair',
          payment_source: 'bar',
          comment: null,
          created_at: '2026-07-04T11:00:00Z',
        },
      ],
      [],
      [],
    );

    expect(totals.stockPurchaseCost).toBe(100_000);
    expect(totals.gameClubExpenses).toBe(120_000);
    expect(totals.barExpenses).toBe(40_000);
    expect(totals.gameClubMoneyLeft).toBe(380_000);
    expect(totals.barIncome).toBe(160_000);
    expect(totals.barProfit).toBe(60_000);
    expect(totals.totalExpenses).toBe(160_000);
    expect(totals.gameClubProfit).toBe(380_000);
  });

  it('breaks game club money left down by payment method', () => {
    const breakdown = calculateGameClubMoneyLeftByPaymentMethod(
      [
        {
          date: '2026-07-04',
          cash_income: 500_000,
          terminal_income: 300_000,
          card_income: 100_000,
          playstation_income: 50_000,
        },
      ],
      [
        {
          id: 'cash-expense',
          date: '2026-07-04',
          amount: 120_000,
          category: 'salary',
          payment_method: 'cash',
          payment_source: 'game_club',
          comment: null,
          created_at: '2026-07-04T10:00:00Z',
        },
        {
          id: 'terminal-expense',
          date: '2026-07-04',
          amount: 50_000,
          category: 'repair',
          payment_method: 'terminal',
          payment_source: 'game_club',
          comment: null,
          created_at: '2026-07-04T11:00:00Z',
        },
        {
          id: 'transfer-expense',
          date: '2026-07-04',
          amount: 40_000,
          category: 'internet',
          payment_method: 'transfer',
          payment_source: 'game_club',
          comment: null,
          created_at: '2026-07-04T12:00:00Z',
        },
        {
          id: 'bar-expense',
          date: '2026-07-04',
          amount: 10_000,
          category: 'cleaning',
          payment_method: 'cash',
          payment_source: 'bar',
          comment: null,
          created_at: '2026-07-04T13:00:00Z',
        },
      ],
    );

    expect(breakdown).toEqual({
      cash: 380_000,
      terminal: 250_000,
      card: 60_000,
      playstation: 50_000,
    });
    expect(Object.values(breakdown).reduce((sum, value) => sum + value, 0)).toBe(740_000);
  });

  it('adds debt collections to the selected money-left payment bucket', () => {
    const breakdown = calculateGameClubMoneyLeftByPaymentMethod(
      [],
      [],
      [
        { date: '2026-07-04', amount: 30_000, payment_method: 'cash' },
        { date: '2026-07-04', amount: 20_000, payment_method: 'terminal' },
        { date: '2026-07-04', amount: 10_000, payment_method: 'transfer' },
      ],
    );

    expect(breakdown).toEqual({ cash: 30_000, terminal: 20_000, card: 10_000, playstation: 0 });
  });

  it('builds a trend that keeps game club income and bar sales apart', () => {
    const trend = buildPeriodTrend(
      { from: '2026-06-26', to: '2026-07-02' },
      [{ date: '2026-07-02', cash_income: 1_000, terminal_income: 2_000, card_income: 3_000, playstation_income: 5_000 }],
      [{ date: '2026-07-02', bar_income: 4_000, bar_profit: 1_000, bar_cost: 3_000, sold_quantity: 1 }],
    );

    expect(trend).toHaveLength(7);
    expect(trend[0]).toEqual({ date: '2026-06-26', gameClubIncome: 0, barSales: 0 });
    expect(trend[6]).toEqual({ date: '2026-07-02', gameClubIncome: 11_000, barSales: 4_000 });
  });

  it('builds a month trend from the selected month range, including early-month data', () => {
    const range = getDashboardRange('month', '2026-06-03');
    const trend = buildPeriodTrend(
      range,
      [{ date: '2026-06-03', cash_income: 5_000_000, terminal_income: 775_000, card_income: 1_840_000, playstation_income: 200_000 }],
      [{ date: '2026-06-03', bar_income: 126_000, bar_profit: 60_000, bar_cost: 66_000, sold_quantity: 3 }],
    );

    expect(trend).toHaveLength(30);
    expect(trend[0]).toEqual({ date: '2026-06-01', gameClubIncome: 0, barSales: 0 });
    expect(trend[2]).toEqual({ date: '2026-06-03', gameClubIncome: 7_815_000, barSales: 126_000 });
    expect(trend[29]).toEqual({ date: '2026-06-30', gameClubIncome: 0, barSales: 0 });
  });

  it('builds a week trend for the exact selected dashboard week', () => {
    const range = getDashboardRange('week', '2026-06-03');
    const trend = buildPeriodTrend(
      range,
      [{ date: '2026-06-01', cash_income: 100, terminal_income: 200, card_income: 300 }],
      [{ date: '2026-06-07', bar_income: 50, bar_profit: 20, bar_cost: 30, sold_quantity: 1 }],
    );

    expect(trend).toHaveLength(7);
    expect(trend[0]).toEqual({ date: '2026-06-01', gameClubIncome: 600, barSales: 0 });
    expect(trend[6]).toEqual({ date: '2026-06-07', gameClubIncome: 0, barSales: 50 });
  });

  it('builds a today trend for only the selected date', () => {
    const range = getDashboardRange('today', '2026-06-03');
    const trend = buildPeriodTrend(
      range,
      [{ date: '2026-06-03', cash_income: 1_000, terminal_income: 0, card_income: 0 }],
      [],
    );

    expect(trend).toEqual([{ date: '2026-06-03', gameClubIncome: 1_000, barSales: 0 }]);
  });

  it('includes debt revenue on its issue date in the game club trend', () => {
    const trend = buildPeriodTrend(
      { from: '2026-06-03', to: '2026-06-03' },
      [],
      [],
      [{ date: '2026-06-03', amount: 75_000, remaining_amount: 75_000, status: 'unpaid' }],
    );

    expect(trend).toEqual([{ date: '2026-06-03', gameClubIncome: 75_000, barSales: 0 }]);
  });

  it('uses local dates instead of UTC conversion for ranges', () => {
    const localDate = new Date(2026, 5, 3, 1, 0, 0);

    expect(localIsoDate(localDate)).toBe('2026-06-03');
    expect(getDashboardRange('today', '2026-06-03')).toEqual({
      from: '2026-06-03',
      to: '2026-06-03',
    });
    expect(getDashboardRange('yesterday', '2026-06-03')).toEqual({
      from: '2026-06-02',
      to: '2026-06-02',
    });
    expect(getDashboardRange('last7Days', '2026-06-03')).toEqual({
      from: '2026-05-28',
      to: '2026-06-03',
    });
    expect(getDashboardRange('week', '2026-06-03')).toEqual({
      from: '2026-06-01',
      to: '2026-06-07',
    });
    expect(getDashboardRange('lastWeek', '2026-06-03')).toEqual({
      from: '2026-05-25',
      to: '2026-05-31',
    });
    expect(getDashboardRange('month', '2026-06-03')).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
    });
    expect(getDashboardRange('lastMonth', '2026-06-03')).toEqual({
      from: '2026-05-01',
      to: '2026-05-31',
    });
    expect(getDashboardRange('custom', '2026-06-03', { from: '2026-06-10', to: '2026-06-03' })).toEqual({
      from: '2026-06-03',
      to: '2026-06-10',
    });
    expect(getPreviousDashboardRange({ from: '2026-06-01', to: '2026-06-07' })).toEqual({
      from: '2026-05-25',
      to: '2026-05-31',
    });
  });

  it('counts average days for current periods through the selected date', () => {
    expect(countDashboardRangeDays({ from: '2026-07-01', to: '2026-07-31' })).toBe(31);
    expect(
      getDashboardAverageDayCount(
        'month',
        { from: '2026-07-01', to: '2026-07-31' },
        '2026-07-06',
      ),
    ).toBe(6);
    expect(
      getDashboardAverageDayCount(
        'week',
        { from: '2026-07-06', to: '2026-07-12' },
        '2026-07-08',
      ),
    ).toBe(3);
    expect(
      getDashboardAverageDayCount(
        'lastMonth',
        { from: '2026-06-01', to: '2026-06-30' },
        '2026-07-06',
      ),
    ).toBe(30);
    expect(calculateAverageDailyIncome(10_000, 3)).toBe(3_333);
  });

  it('averages game club income through the latest daily cashier entry date', () => {
    const range = { from: '2026-07-01', to: '2026-07-05' };
    const latestCashierEntryDate = getLatestRowDateInRange(
      [
        { date: '2026-07-01', cash_income: 1_000, terminal_income: 0, card_income: 0 },
        { date: '2026-07-04', cash_income: 1_000, terminal_income: 0, card_income: 0 },
      ],
      range,
    );

    expect(latestCashierEntryDate).toBe('2026-07-04');
    expect(countDashboardRangeDaysThroughDate(range, latestCashierEntryDate)).toBe(4);
    expect(calculateAverageDailyIncome(10_254_000, 4)).toBe(2_563_500);
  });
});
