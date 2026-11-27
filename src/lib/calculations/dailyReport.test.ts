import { describe, it, expect } from 'vitest';
import {
  calculateManualIncome,
  calculateFinancialReportTotals,
  sumDebtIncome,
} from './dailyReport';
import { calculateDashboardTotals } from './dashboardMetrics';
import { buildBarMoneyDetailRows } from './moneyDetails';
import type { ReserveMove } from './reserveMoves';

describe('calculateManualIncome', () => {
  it('sums game club payment method fields', () => {
    const entry = {
      cash_income: 100000,
      terminal_income: 50000,
      card_income: 30000,
      playstation_income: 20000,
    };
    expect(calculateManualIncome(entry)).toBe(200000);
  });

  it('returns 0 when all fields are 0', () => {
    const entry = {
      cash_income: 0,
      terminal_income: 0,
      card_income: 0,
      playstation_income: 0,
    };
    expect(calculateManualIncome(entry)).toBe(0);
  });
});

describe('calculateFinancialReportTotals', () => {
  it('keeps game-club profit, bar profit, and bar cash left separate', () => {
    expect(calculateFinancialReportTotals({
      manualIncome: 415000,
      debtIncome: 120000,
      stockRows: [
        { bar_income: 80000, bar_cost: 30000 },
        { bar_income: 20000, bar_cost: 7500 },
      ],
      purchaseRows: [
        { date: '2026-07-03', quantity: 10, cost_price: 4000 },
      ],
      expenseRows: [
        { amount: 10000, payment_source: 'bar' },
        { amount: 50000, payment_source: 'game_club' },
      ],
    })).toEqual({
      manualIncome: 415000,
      debtIncome: 120000,
      gameClubIncome: 535000,
      barUnitsSold: 0,
      barGrossProfit: 0,
      barSales: 100000,
      barCost: 37500,
      stockPurchaseCost: 40000,
      barExpenses: 10000,
      gameClubExpenses: 50000,
      barCashLeft: 50000,
      gameClubProfit: 485000,
      barProfit: 52500,
    });
  });

  it('does not subtract inventory purchases from bar profit', () => {
    const totals = calculateFinancialReportTotals({
      manualIncome: 0,
      stockRows: [{ bar_income: 100000, bar_cost: 25000 }],
      purchaseRows: [{ date: '2026-07-03', quantity: 20, cost_price: 3000 }],
      expenseRows: [],
    });

    expect(totals.barCashLeft).toBe(40000);
    expect(totals.barProfit).toBe(75000);
    expect(totals.gameClubProfit).toBe(0);
  });

  it('subtracts each expense only from the side of the club that paid it', () => {
    const totals = calculateFinancialReportTotals({
      manualIncome: 200000,
      stockRows: [{ bar_income: 50000, bar_cost: 15000 }],
      purchaseRows: [],
      expenseRows: [
        { amount: 5000, payment_source: 'bar' },
        { amount: 20000, payment_source: 'game_club' },
      ],
    });

    expect(totals.barExpenses).toBe(5000);
    expect(totals.gameClubExpenses).toBe(20000);
    expect(totals.barCashLeft).toBe(45000);
    expect(totals.gameClubProfit).toBe(180000);
    expect(totals.barProfit).toBe(30000);
  });

  it('matches the dashboard game-club, bar, and bar-cash definitions', () => {
    const cashRows = [{
      date: '2026-07-03',
      cash_income: 100000,
      terminal_income: 50000,
      card_income: 25000,
      playstation_income: 10000,
    }];
    const stockRows = [{
      date: '2026-07-03',
      bar_income: 80000,
      bar_cost: 30000,
      bar_profit: 50000,
      sold_quantity: 10,
    }];
    const purchaseRows = [{ date: '2026-07-03', quantity: 5, cost_price: 4000 }];
    const expenseRows = [{
      id: 'expense-1',
      date: '2026-07-03',
      amount: 10000,
      category: 'other',
      payment_source: 'bar' as const,
      comment: null,
      created_at: '2026-07-03T12:00:00Z',
    }];
    const debtRows = [{
      date: '2026-07-03',
      amount: 120000,
      remaining_amount: 120000,
      status: 'active',
    }];

    const dashboard = calculateDashboardTotals(
      cashRows,
      stockRows,
      purchaseRows,
      expenseRows,
      [],
      debtRows,
    );
    const report = calculateFinancialReportTotals({
      manualIncome: calculateManualIncome(cashRows[0]),
      debtIncome: 120000,
      stockRows,
      purchaseRows,
      expenseRows,
    });

    expect(report.barSales).toBe(dashboard.barSales);
    expect(report.barCost).toBe(dashboard.barCost);
    expect(report.barCashLeft).toBe(dashboard.barIncome);
    expect(report.gameClubExpenses).toBe(dashboard.gameClubExpenses);
    expect(report.gameClubProfit).toBe(dashboard.gameClubProfit);
    expect(report.barProfit).toBe(dashboard.barProfit);
    expect(report.gameClubProfit).toBe(305000);
    expect(report.barProfit).toBe(40000);
  });
});

describe('bar cash left with the owner reserve (156)', () => {
  // A bar deposit into the reserve, a bar purchase the reserve's sums paid and one its dollars paid.
  const stockRows = [{ date: '2026-11-10', bar_income: 900_000, bar_cost: 400_000, bar_profit: 500_000, sold_quantity: 30 }];
  const purchaseRows = [{ date: '2026-11-10', quantity: 10, cost_price: 20_000, comment: null }];
  const expenseRows = [
    { id: 'bar-own', date: '2026-11-10', amount: 50_000, category: 'cleaning', payment_source: 'bar' as const, payment_method: 'cash', comment: null, created_at: '2026-11-10T09:00:00Z' },
    { id: 'bar-reserve', date: '2026-11-10', amount: 300_000, category: 'equipment', payment_source: 'bar' as const, payment_method: 'cash', paid_from_reserve: true, comment: null, created_at: '2026-11-10T10:00:00Z' },
    { id: 'bar-usd', date: '2026-11-10', amount: 120_000, category: 'equipment', payment_source: 'bar' as const, payment_method: 'usd', comment: null, created_at: '2026-11-10T11:00:00Z' },
    { id: 'club', date: '2026-11-10', amount: 70_000, category: 'rent', payment_source: 'game_club' as const, payment_method: 'cash', comment: null, created_at: '2026-11-10T12:00:00Z' },
  ];
  const reserveMoves: ReserveMove[] = [
    { date: '2026-11-10', source: 'bar', method: null, amount: 250_000 },
    // Game Club moves never touch the bar.
    { date: '2026-11-10', source: 'game_club', method: 'cash', amount: 1_000_000 },
  ];

  it('takes bar deposits out and leaves purchases the reserve paid in, as the dashboard and bar money details do', () => {
    const report = calculateFinancialReportTotals({ manualIncome: 0, stockRows, purchaseRows, expenseRows, reserveMoves });
    const dashboard = calculateDashboardTotals([], stockRows, purchaseRows, expenseRows, [], [], [], [], reserveMoves);
    const details = buildBarMoneyDetailRows(stockRows, purchaseRows, expenseRows, reserveMoves);

    // 900 000 sales − 200 000 purchases − 50 000 bar-paid expense − 250 000 into the reserve.
    expect(report.barCashLeft).toBe(400_000);
    expect(report.barCashLeft).toBe(dashboard.barIncome);
    expect(report.barCashLeft).toBe(details.reduce((sum, row) => sum + row.moneyLeft, 0));
    // Accounting profit is unchanged: reserve-paid purchases stay bar expenses.
    expect(report.barExpenses).toBe(470_000);
    expect(report.barProfit).toBe(900_000 - 400_000 - 470_000);
    expect(report.barProfit).toBe(dashboard.barProfit);
  });

  it('adds back money the reserve returned to the bar', () => {
    const totals = calculateFinancialReportTotals({
      manualIncome: 0,
      stockRows,
      purchaseRows: [],
      expenseRows: [],
      reserveMoves: [{ date: '2026-11-10', source: 'bar', method: null, amount: -100_000 }],
    });
    expect(totals.barCashLeft).toBe(1_000_000);
  });
});

describe('report totals with incomplete rows', () => {
  it('counts a day without PlayStation income from the other three methods only', () => {
    expect(calculateManualIncome({ cash_income: 100_000, terminal_income: 50_000, card_income: 30_000 })).toBe(180_000);
  });

  it('reads missing costs and amounts as zero and unassigned expenses as game-club expenses', () => {
    const totals = calculateFinancialReportTotals({
      manualIncome: 500_000,
      stockRows: [
        { bar_income: 100_000, bar_cost: 40_000 },
        { bar_income: 20_000, bar_cost: null as unknown as number },
      ],
      purchaseRows: [{ date: '2026-07-10', quantity: 5, cost_price: 6_000 }],
      expenseRows: [
        { amount: 70_000, payment_source: 'bar' },
        { amount: null as unknown as number, payment_source: 'bar' },
        { amount: 50_000 },
        { amount: 25_000, payment_source: null },
        { amount: null as unknown as number, payment_source: 'game_club' },
      ],
    });

    expect(totals).toEqual({
      manualIncome: 500_000,
      debtIncome: 0,
      gameClubIncome: 500_000,
      barUnitsSold: 0,
      barGrossProfit: 0,
      barSales: 120_000,
      barCost: 40_000,
      stockPurchaseCost: 30_000,
      barExpenses: 70_000,
      gameClubExpenses: 75_000,
      barCashLeft: 20_000, // 120 000 sales − 30 000 purchases − 70 000 bar expenses
      gameClubProfit: 425_000, // 500 000 − 75 000
      barProfit: 10_000, // 120 000 − 40 000 cost of goods − 70 000
    });
  });
});

describe('sumDebtIncome', () => {
  it('adds the debt rows the way the report pages did inline', () => {
    const rows = [{ amount: 120_000 }, { amount: '30000' }, { amount: null }, {}];
    expect(sumDebtIncome(rows)).toBe(150_000);
    expect(sumDebtIncome(rows)).toBe(rows.reduce((sum, debt) => sum + Number(debt.amount ?? 0), 0));
    expect(sumDebtIncome([])).toBe(0);
  });
});

describe('report totals: game club income, bar units sold and bar gross profit', () => {
  const stockRows = [
    { bar_income: 80_000, bar_cost: 30_000, sold_quantity: 8, bar_profit: 50_000 },
    { bar_income: 20_000, bar_cost: 27_500, sold_quantity: 2.5, bar_profit: -7_500 },
  ];
  const totals = calculateFinancialReportTotals({
    manualIncome: 415_000,
    debtIncome: 120_000,
    stockRows,
    purchaseRows: [],
    expenseRows: [{ amount: 10_000, payment_source: 'bar' }],
  });

  it('match the sums the daily report used to compute inline', () => {
    expect(totals.gameClubIncome).toBe(415_000 + 120_000);
    expect(totals.barUnitsSold).toBe(stockRows.reduce((sum, row) => sum + row.sold_quantity, 0));
    expect(totals.barGrossProfit).toBe(stockRows.reduce((sum, row) => sum + row.bar_profit, 0));
    expect(totals.barUnitsSold).toBe(10.5);
    expect(totals.barGrossProfit).toBe(42_500);
  });

  it('leave the existing figures untouched', () => {
    expect(totals).toMatchObject({ barSales: 100_000, barCost: 57_500, barExpenses: 10_000, barProfit: 32_500, gameClubProfit: 535_000 });
  });

  it('add up over days to the month figure the monthly report showed', () => {
    const days = [{ manualIncome: 100_000, debtIncome: 20_000 }, { manualIncome: 250_000, debtIncome: 0 }]
      .map((day) => calculateFinancialReportTotals({ ...day, stockRows: [], purchaseRows: [], expenseRows: [] }));
    const month = days.reduce((sum, day) => sum + day.gameClubIncome, 0);
    expect(month).toBe(days.reduce((sum, day) => sum + day.manualIncome, 0) + days.reduce((sum, day) => sum + day.debtIncome, 0));
  });

  it('read rows without a quantity or profit (month totals) as zero', () => {
    const month = calculateFinancialReportTotals({ manualIncome: 0, stockRows: [{ bar_income: 5, bar_cost: 2 }], purchaseRows: [], expenseRows: [] });
    expect(month.barUnitsSold).toBe(0);
    expect(month.barGrossProfit).toBe(0);
  });
});
