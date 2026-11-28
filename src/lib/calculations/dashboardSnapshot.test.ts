import { describe, expect, it } from 'vitest';
import {
  buildDashboardDataFromSnapshot,
  debtsOpenAsOf,
  getDashboardSnapshotRanges,
  latestCountPerProduct,
  productsNeedingEarlierCounts,
  type DashboardSnapshotPayload,
} from './dashboardSnapshot';

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

describe('getDashboardSnapshotRanges', () => {
  it('covers the current month to date, compared with the same days of last month', () => {
    expect(getDashboardSnapshotRanges('2026-10-14')).toEqual({
      period: 'month',
      range: { from: '2026-10-01', to: '2026-10-31' },
      previousRange: { from: '2026-09-01', to: '2026-09-14' },
      inventoryComparisonRange: { from: '2026-09-01', to: '2026-09-30' },
    });
  });

  it('covers a whole earlier month, compared with the whole month before it', () => {
    expect(getDashboardSnapshotRanges('2026-10-14', '2026-03')).toEqual({
      period: 'lastMonth',
      range: { from: '2026-03-01', to: '2026-03-31' },
      previousRange: { from: '2026-02-01', to: '2026-02-28' },
      inventoryComparisonRange: { from: '2026-02-01', to: '2026-02-28' },
    });
    // January looks back across the year.
    expect(getDashboardSnapshotRanges('2026-10-14', '2026-01').previousRange).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('treats the current month, a future month and nonsense as the current month', () => {
    const current = getDashboardSnapshotRanges('2026-10-14');
    for (const month of ['2026-10', '2026-11', '2027-01', '', 'March', '2026-3']) {
      expect(getDashboardSnapshotRanges('2026-10-14', month)).toEqual(current);
    }
  });

  it("values an earlier month's stock at its own last closing count, not the live stock", () => {
    const ranges = getDashboardSnapshotRanges('2026-10-14', '2026-07');
    const data = buildDashboardDataFromSnapshot({
      ...ranges,
      payload: {
        cashRows: [], stockRows: [], purchaseRows: [], expenseRows: [], debtRows: [], debtPaymentRows: [],
        inventoryRows: [
          { product_id: 'cola', date: '2026-06-30', closing_stock: 10, cost_price: 3_000 },
          { product_id: 'cola', date: '2026-07-31', closing_stock: 4, cost_price: 3_000 },
        ],
        products: [product],
      },
    });
    expect(data.totals.inventoryValue).toBe(12_000);
    expect(data.inventoryComparisonValue).toBe(30_000);
  });
});

const emptyPayload: DashboardSnapshotPayload = {
  cashRows: [], stockRows: [], inventoryRows: [], purchaseRows: [], expenseRows: [], debtRows: [], debtPaymentRows: [], products: [],
};

describe('debtsOpenAsOf', () => {
  const debt = (id: string, date: string, amount: number, remaining: number, status: string) => (
    { id, person_name: id, date, amount, remaining_amount: remaining, status }
  );

  it('rebuilds each debt\'s balance at a date from its live balance and the payments made after it', () => {
    const debts = [
      debt('a', '2026-08-10', 100, 0, 'paid'), // paid off in October
      debt('b', '2026-09-05', 200, 50, 'partial'), // 150 paid in October
      debt('c', '2026-09-20', 80, 80, 'unpaid'),
      debt('d', '2026-10-02', 60, 60, 'unpaid'), // after the date
      debt('e', '2026-07-01', 40, 0, 'paid'), // paid before the date
    ];
    const later = [
      { debt_id: 'a', date: '2026-10-03', amount: 100 },
      { debt_id: 'b', date: '2026-10-04', amount: 150 },
      // On the date itself: already in the balance at its end.
      { debt_id: 'c', date: '2026-09-30', amount: 30 },
    ];

    expect(debtsOpenAsOf(debts, later, '2026-09-30')).toEqual([
      { ...debts[0], remaining_amount: 100, status: 'unpaid' },
      { ...debts[1], remaining_amount: 200, status: 'unpaid' },
      { ...debts[2], remaining_amount: 80, status: 'unpaid' },
    ]);
  });

  it('keeps a partly paid balance partial, caps it at the principal and counts a repeated debt once', () => {
    const partial = debt('b', '2026-09-05', 200, 0, 'paid');
    const open = debtsOpenAsOf([partial, partial], [{ debt_id: 'b', date: '2026-10-04', amount: 120 }, { debt_id: 'b', date: '2026-10-09', amount: 500 }], '2026-09-30');
    expect(open).toEqual([{ ...partial, remaining_amount: 200, status: 'unpaid' }]);
    expect(debtsOpenAsOf([partial], [{ debt_id: 'b', date: '2026-10-04', amount: 120 }], '2026-09-30'))
      .toEqual([{ ...partial, remaining_amount: 120, status: 'partial' }]);
  });
});

describe('dashboard figures that follow the month', () => {
  it('shows a past month\'s debts as they stood at its end', () => {
    const ranges = getDashboardSnapshotRanges('2026-10-14', '2026-09');
    const data = buildDashboardDataFromSnapshot({
      ...ranges,
      businessToday: '2026-10-14',
      payload: {
        ...emptyPayload,
        debtRows: [
          { id: 'open', person_name: 'Ali', date: '2026-09-10', amount: 70, remaining_amount: 70, status: 'unpaid' },
          { id: 'later', person_name: 'Bek', date: '2026-10-05', amount: 90, remaining_amount: 90, status: 'unpaid' },
        ],
        laterPaidDebts: [{ id: 'old', person_name: 'Vali', date: '2026-05-01', amount: 300, remaining_amount: 0, status: 'paid' }],
        laterDebtPayments: [{ debt_id: 'old', date: '2026-10-02', amount: 300 }],
      },
    });
    // Today's open debts would be 160; at the end of September it was 70 + 300.
    expect(data.totals.activeDebts).toBe(370);
    expect(data.totals.activeDebtCount).toBe(2);
    expect(data.debtors.map((debtor) => debtor.name)).toEqual(['Vali', 'Ali']);
  });

  it('keeps today\'s open debts on the current month', () => {
    const data = buildDashboardDataFromSnapshot({
      ...getDashboardSnapshotRanges('2026-10-14'),
      payload: {
        ...emptyPayload,
        debtRows: [{ id: 'd', date: '2026-03-01', amount: 50, remaining_amount: 20, status: 'partial' }],
      },
    });
    expect(data.totals.activeDebts).toBe(20);
  });

  it('values deactivated products still holding stock, without putting them on the restock list', () => {
    const data = buildDashboardDataFromSnapshot({
      ...getDashboardSnapshotRanges('2026-10-14'),
      payload: {
        ...emptyPayload,
        products: [product],
        inactiveStockProducts: [{ current_stock: 2, cost_price: 1_000 }, { current_stock: 5, cost_price: 1_000, tracks_inventory: false }],
      },
    });
    // 8 × 3 000 active + 2 × 1 000 deactivated; untracked stock has no value.
    expect(data.totals.inventoryValue).toBe(26_000);
    expect(data.stockProducts.map((item) => item.id)).toEqual(['cola']);
  });

  it('compares each side through its own latest entered day while the month runs', () => {
    const ranges = getDashboardSnapshotRanges('2026-10-14');
    const data = buildDashboardDataFromSnapshot({
      ...ranges,
      businessToday: '2026-10-14',
      payload: {
        ...emptyPayload,
        cashRows: [
          { date: '2026-09-10', cash_income: 100, terminal_income: 0, card_income: 0, playstation_income: 10 },
          // The 14th of last month was a whole day; this month's 14th is not entered yet.
          { date: '2026-09-14', cash_income: 900, terminal_income: 0, card_income: 0, playstation_income: 90 },
          { date: '2026-10-13', cash_income: 150, terminal_income: 0, card_income: 0, playstation_income: 15 },
        ],
        stockRows: [
          { date: '2026-09-05', bar_income: 40, bar_profit: 10, bar_cost: 30, sold_quantity: 1 },
          { date: '2026-09-12', bar_income: 400, bar_profit: 100, bar_cost: 300, sold_quantity: 1 },
          { date: '2026-10-06', bar_income: 60, bar_profit: 20, bar_cost: 40, sold_quantity: 1 },
        ],
        expenseRows: [
          // Entered today, after the latest daily cash: outside the game club's compared days.
          { id: 'e1', date: '2026-10-14', amount: 50, category: 'rent', payment_method: 'cash', payment_source: 'game_club', comment: null, created_at: '' },
        ],
      },
    });

    // Game club: 1-13 October against 1-13 September.
    expect(data.comparison.gameClub.current.gameClubIncome).toBe(165);
    expect(data.comparison.gameClub.previous.gameClubIncome).toBe(110);
    expect(data.comparison.gameClub.previous.playstationIncome).toBe(10);
    expect(data.comparison.gameClub.current.gameClubProfit).toBe(165);
    // Bar: 1-6 October against 1-6 September.
    expect(data.comparison.bar.current.barSales).toBe(60);
    expect(data.comparison.bar.previous.barSales).toBe(40);
    // The headline figures still cover the month so far.
    expect(data.totals.gameClubProfit).toBe(115);
    expect(data.previousTotals.gameClubIncome).toBe(1_100);
  });

  it('compares the whole periods without a business date', () => {
    const data = buildDashboardDataFromSnapshot({
      ...getDashboardSnapshotRanges('2026-10-14'),
      payload: { ...emptyPayload, cashRows: [{ date: '2026-09-14', cash_income: 900, terminal_income: 0, card_income: 0 }] },
    });
    expect(data.comparison.gameClub.previous).toEqual(data.previousTotals);
    expect(data.comparison.bar.current).toEqual(data.totals);
  });
});

describe('stock values from each product\'s latest count however old', () => {
  // Chips were deactivated in August with 10 left (4 000 each) and never counted again.
  const chipsCount = { product_id: 'chips', date: '2026-08-20', closing_stock: 10, cost_price: 4_000 };
  const colaSeptember = { product_id: 'cola', date: '2026-09-30', closing_stock: 5, cost_price: 3_000 };
  const colaOctober = { product_id: 'cola', date: '2026-10-31', closing_stock: 4, cost_price: 3_000 };

  it('counts a product deactivated two months ago in last month\'s value, like the live value', () => {
    const data = buildDashboardDataFromSnapshot({
      ...getDashboardSnapshotRanges('2026-10-14'),
      payload: {
        ...emptyPayload,
        inventoryRows: [colaSeptember],
        earlierInventoryRows: [chipsCount],
        products: [{ ...product, current_stock: 5 }],
        inactiveStockProducts: [{ current_stock: 10, cost_price: 4_000 }],
      },
    });
    // Live: 5 × 3 000 cola + 10 × 4 000 chips; last month's end: the same units.
    expect(data.totals.inventoryValue).toBe(55_000);
    expect(data.inventoryComparisonValue).toBe(55_000);
    expect(data.hasInventoryComparisonData).toBe(true);
  });

  it('counts it in a past month and in the month before', () => {
    const data = buildDashboardDataFromSnapshot({
      ...getDashboardSnapshotRanges('2026-11-14', '2026-10'),
      payload: { ...emptyPayload, inventoryRows: [colaSeptember, colaOctober], earlierInventoryRows: [chipsCount], products: [product] },
    });
    expect(data.totals.inventoryValue).toBe(52_000);
    expect(data.inventoryComparisonValue).toBe(55_000);
  });

  it('asks for older counts only for tracked products with none in the window and not deleted before it', () => {
    const catalog = [
      { id: 'cola' },
      { id: 'chips', deleted_at: null },
      { id: 'tea', tracks_inventory: false },
      { id: 'kurt', deleted_at: '2026-07-10T12:00:00Z' },
      // Deleted on the window's first day: its last count still stands the day before.
      { id: 'juice', deleted_at: '2026-09-01T03:00:00Z' },
    ];
    const window = { from: '2026-09-01', to: '2026-09-30' };
    expect(productsNeedingEarlierCounts(catalog, [colaSeptember, colaOctober], window)).toEqual(['chips', 'juice']);
    // A count after the window does not cover it.
    expect(productsNeedingEarlierCounts([{ id: 'cola' }], [colaOctober], window)).toEqual(['cola']);
  });

  it('keeps each product\'s latest count', () => {
    expect(latestCountPerProduct([chipsCount, { ...chipsCount, date: '2026-07-01', closing_stock: 30 }, colaSeptember, colaOctober]))
      .toEqual([chipsCount, colaOctober]);
  });
});
