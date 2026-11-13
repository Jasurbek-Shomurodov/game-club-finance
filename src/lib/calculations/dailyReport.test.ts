import { describe, it, expect } from 'vitest';
import {
  calculateManualIncome,
  calculateFinancialReportTotals,
} from './dailyReport';
import { calculateDashboardTotals } from './dashboardMetrics';

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
