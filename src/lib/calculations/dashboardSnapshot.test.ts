import { describe, expect, it } from 'vitest';
import { buildDashboardDataFromSnapshot, type DashboardSnapshotPayload } from './dashboardSnapshot';

const product = {
  id: 'cola',
  club_id: 'club',
  name: 'Cola',
  category: 'Drinks',
  sale_price: 5_000,
  cost_price: 3_000,
  current_stock: 8,
  low_stock_threshold: 5,
  is_active: true,
  created_at: '',
  updated_at: '',
};

describe('buildDashboardDataFromSnapshot', () => {
  it('splits one RPC payload into current and previous dashboard periods', () => {
    const payload: DashboardSnapshotPayload = {
      cashRows: [
        { date: '2026-06-10', cash_income: 100, terminal_income: 0, card_income: 0 },
        { date: '2026-07-10', cash_income: 200, terminal_income: 0, card_income: 0 },
      ],
      stockRows: [
        { date: '2026-06-30', bar_income: 50, bar_profit: 20, bar_cost: 30, sold_quantity: 1 },
        { date: '2026-07-31', bar_income: 100, bar_profit: 40, bar_cost: 60, sold_quantity: 2 },
      ],
      inventoryRows: [
        { product_id: 'cola', date: '2026-06-30', closing_stock: 10, cost_price: 3_000 },
        { product_id: 'cola', date: '2026-07-31', closing_stock: 8, cost_price: 3_000 },
      ],
      purchaseRows: [],
      expenseRows: [],
      debtRows: [],
      debtPaymentRows: [],
      products: [product],
    };

    const result = buildDashboardDataFromSnapshot({
      period: 'month',
      range: { from: '2026-07-01', to: '2026-07-31' },
      previousRange: { from: '2026-06-01', to: '2026-06-30' },
      inventoryComparisonRange: { from: '2026-06-01', to: '2026-06-30' },
      payload,
    });

    expect(result.totals.gameClubIncome).toBe(200);
    expect(result.previousTotals.gameClubIncome).toBe(100);
    expect(result.inventoryComparisonValue).toBe(30_000);
    expect(result.hasInventoryComparisonData).toBe(true);
  });

  it('uses separate closing snapshots for last month and its comparison month', () => {
    const payload: DashboardSnapshotPayload = {
      cashRows: [],
      stockRows: [],
      inventoryRows: [
        { product_id: 'cola', date: '2026-05-31', closing_stock: 12, cost_price: 2_500 },
        { product_id: 'cola', date: '2026-06-30', closing_stock: 7, cost_price: 3_000 },
        { product_id: 'cola', date: '2026-07-31', closing_stock: 8, cost_price: 3_000 },
      ],
      purchaseRows: [],
      expenseRows: [],
      debtRows: [],
      debtPaymentRows: [],
      products: [product],
    };

    const result = buildDashboardDataFromSnapshot({
      period: 'lastMonth',
      range: { from: '2026-06-01', to: '2026-06-30' },
      previousRange: { from: '2026-05-01', to: '2026-05-31' },
      inventoryComparisonRange: { from: '2026-05-01', to: '2026-05-31' },
      payload,
    });

    expect(result.totals.inventoryValue).toBe(21_000);
    expect(result.inventoryComparisonValue).toBe(30_000);
    expect(result.hasInventoryComparisonData).toBe(true);
  });

  it('does not invent comparable inventory data when the prior range has no closing', () => {
    const payload: DashboardSnapshotPayload = {
      cashRows: [],
      stockRows: [],
      inventoryRows: [
        { product_id: 'cola', date: '2026-07-31', closing_stock: 8, cost_price: 3_000 },
      ],
      purchaseRows: [],
      expenseRows: [],
      debtRows: [],
      debtPaymentRows: [],
      products: [product],
    };

    const result = buildDashboardDataFromSnapshot({
      period: 'month',
      range: { from: '2026-08-01', to: '2026-08-31' },
      previousRange: { from: '2026-07-01', to: '2026-07-31' },
      inventoryComparisonRange: { from: '2026-06-01', to: '2026-06-30' },
      payload,
    });

    expect(result.inventoryComparisonValue).toBe(0);
    expect(result.hasInventoryComparisonData).toBe(false);
  });

  it('feeds the money flows from the same in-range rows as the cards, PlayStation included', () => {
    const payload: DashboardSnapshotPayload = {
      cashRows: [
        { date: '2026-06-10', cash_income: 100, terminal_income: 0, card_income: 0 },
        { date: '2026-07-10', cash_income: 200, terminal_income: 0, card_income: 0, playstation_income: 50 },
      ],
      stockRows: [],
      inventoryRows: [],
      purchaseRows: [],
      expenseRows: [
        { id: 'e1', date: '2026-06-15', amount: 10, category: 'utilities', payment_method: 'cash', payment_source: 'game_club', comment: null, created_at: '' },
        { id: 'e2', date: '2026-07-15', amount: 20, category: 'utilities', payment_method: 'cash', payment_source: 'bar', comment: null, created_at: '' },
      ],
      debtRows: [],
      debtPaymentRows: [],
      products: [],
    };

    const result = buildDashboardDataFromSnapshot({
      period: 'month',
      range: { from: '2026-07-01', to: '2026-07-31' },
      previousRange: { from: '2026-06-01', to: '2026-06-30' },
      inventoryComparisonRange: { from: '2026-06-01', to: '2026-06-30' },
      payload,
    });

    // The "Game Club Income" card reads gameClubIncome, which includes PlayStation.
    expect(result.totals.gameClubIncome).toBe(250);
    expect(result.ledgers.cashRows.map((row) => row.date)).toEqual(['2026-07-10']);
    expect(result.ledgers.expenseRows.map((row) => row.id)).toEqual(['e2']);
  });
});
