import { describe, expect, it } from 'vitest';
import { buildMoneyReport } from '@/lib/calculations/moneyReport';
import type { MoneyCheck } from '@/lib/calculations/moneyChecks';
import type { UpcomingPayments } from '@/lib/calculations/upcomingPayments';
import {
  allowedDatasets,
  checksTable,
  upcomingTable,
  debtsTable,
  expensesTable,
  MODEL_ROW_LIMIT,
  moneyTable,
  productSalesTable,
  stockTable,
  tableForModel,
} from './datasets';

describe('allowedDatasets', () => {
  it('gives owners every dataset', () => {
    expect(allowedDatasets('owner', null)).toEqual([
      'summary', 'money', 'daily', 'monthly', 'categories', 'expenses', 'product_sales', 'checks', 'upcoming', 'stock', 'debts',
    ]);
  });

  it('follows the member feature access', () => {
    expect(allowedDatasets('admin', ['assistant', 'debts'])).toEqual(['debts']);
    expect(allowedDatasets('viewer', ['assistant', 'closing_stock'])).toEqual(['stock']);
    expect(allowedDatasets('admin', ['assistant', 'reports'])).toEqual([
      'summary', 'money', 'daily', 'monthly', 'categories', 'expenses', 'product_sales', 'checks', 'upcoming',
    ]);
    expect(allowedDatasets('admin', ['assistant'])).toEqual([]);
  });

  it('offers only what the snapshot RPCs let the member read', () => {
    // get_finance_report_snapshot needs dashboard or reports.
    expect(allowedDatasets('admin', ['assistant', 'expenses'])).toEqual([]);
    expect(allowedDatasets('admin', ['assistant', 'owner_profit'])).toEqual([]);
    // get_money_report_snapshot needs reports itself.
    expect(allowedDatasets('admin', ['assistant', 'dashboard'])).toEqual([
      'summary', 'daily', 'monthly', 'categories', 'expenses', 'product_sales', 'checks', 'upcoming',
    ]);
  });
});

describe('moneyTable', () => {
  it('matches the Reports page and keeps bar sales out of collected money', () => {
    const report = buildMoneyReport(
      [
        { date: '2026-10-01', cash_income: 6_000_000, terminal_income: 8_000_000, card_income: 0, playstation_income: 0 },
        { date: '2026-10-02', cash_income: 4_150_000, terminal_income: 5_282_000, card_income: 0, playstation_income: 0 },
      ],
      [
        { id: 'e1', date: '2026-10-01', amount: 2_993_000, category: 'salary', payment_method: 'cash', payment_source: 'game_club', comment: null, created_at: '2026-10-01T00:00:00Z' },
        { id: 'e2', date: '2026-10-02', amount: 9_487_000, category: 'rent', payment_method: 'terminal', payment_source: 'game_club', comment: null, created_at: '2026-10-01T00:00:00Z' },
      ],
      [],
      [{ date: '2026-10-01', bar_income: 2_535_520 }],
    );
    expect(moneyTable(report).rows).toEqual([
      { line: 'cash', collected: 10_150_000, expenses: 2_993_000, exchanged: 0, left: 7_157_000 },
      { line: 'terminal', collected: 13_282_000, expenses: 9_487_000, exchanged: 0, left: 3_795_000 },
      { line: 'card', collected: 0, expenses: 0, exchanged: 0, left: 0 },
      { line: 'playstation', collected: 0, expenses: 0, exchanged: 0, left: 0 },
      { line: 'gameClub', collected: 23_432_000, expenses: 12_480_000, exchanged: null, left: 10_952_000 },
      { line: 'bar', collected: null, expenses: 0, exchanged: null, left: 2_535_520 },
    ]);
  });
});

describe('productSalesTable', () => {
  it('sums each product across days and ranks by sales', () => {
    const table = productSalesTable([
      { product_id: 'a', product_name: 'Cola', sold_quantity: 2, bar_income: 20_000, bar_cost: 12_000, giveaway_quantity: 1 },
      { product_id: 'b', product_name: 'Chips', sold_quantity: 5, bar_income: 50_000, bar_cost: 30_000 },
      { product_id: 'a', product_name: 'Cola', sold_quantity: 3, bar_income: 30_000, bar_cost: 18_000, giveaway_quantity: null },
    ]);
    expect(table.rows).toEqual([
      { product: 'Chips', soldQuantity: 5, giveawayQuantity: 0, barSales: 50_000, barCost: 30_000, barProfit: 20_000 },
      { product: 'Cola', soldQuantity: 5, giveawayQuantity: 1, barSales: 50_000, barCost: 30_000, barProfit: 20_000 },
    ]);
  });
});

describe('stockTable', () => {
  it('lists active tracked products with their level, lowest first', () => {
    const table = stockTable([
      { name: 'Water', category: null, sale_price: 5_000, current_stock: 40, low_stock_threshold: 10 },
      { name: 'Cola', category: 'drinks', sale_price: 10_000, current_stock: 3, low_stock_threshold: null },
      { name: 'Tea', category: null, sale_price: 3_000, current_stock: 0, low_stock_threshold: 2 },
      { name: 'Old', category: null, sale_price: 1, current_stock: 0, low_stock_threshold: 1, is_deleted: true },
      { name: 'Service', category: null, sale_price: 1, current_stock: 0, low_stock_threshold: 1, tracks_inventory: false },
    ]);
    expect(table.rows.map((row) => [row.product, row.stockLevel, row.lowStockThreshold])).toEqual([
      ['Tea', 'out', 2],
      ['Cola', 'low', 5],
      ['Water', 'ok', 10],
    ]);
  });
});

describe('debtsTable', () => {
  it('derives the remaining amount from the ledger totals', () => {
    const table = debtsTable([
      { person_name: 'Ali', date: '2026-10-01', amount: 100_000, paid_amount: 40_000, status: 'partial', comment: null },
    ]);
    expect(table.rows[0]).toMatchObject({ person: 'Ali', remainingAmount: 60_000, debtStatus: 'partial' });
  });
});

describe('expensesTable', () => {
  it('filters by category and orders by date', () => {
    const table = expensesTable([
      { id: '2', date: '2026-10-03', amount: 50, category: 'rent', payment_method: 'cash', payment_source: 'game_club', comment: null, created_at: '' },
      { id: '1', date: '2026-10-01', amount: 70, category: 'rent', payment_method: 'card', payment_source: 'bar', comment: 'x', created_at: '' },
      { id: '3', date: '2026-10-02', amount: 10, category: 'tax', payment_method: 'cash', payment_source: 'game_club', comment: null, created_at: '' },
    ], 'rent');
    expect(table.rows.map((row) => [row.date, row.amount])).toEqual([['2026-10-01', 70], ['2026-10-03', 50]]);
  });
});

describe('tableForModel', () => {
  it('caps the rows the model sees and says so', () => {
    const rows = Array.from({ length: MODEL_ROW_LIMIT + 5 }, (_, index) => ({ n: index }));
    const result = tableForModel({ dataset: 'expenses', columns: [{ key: 'n', type: 'number' }], rows });
    expect(result.rowCount).toBe(MODEL_ROW_LIMIT + 5);
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(MODEL_ROW_LIMIT);
  });
});

describe('dataset labels', () => {
  it('has a translation in every language for each emitted metric and column', async () => {
    const { buildFinancialAnalysis } = await import('@/lib/calculations/financialAnalysis');
    const datasets = await import('./datasets');
    const analysis = buildFinancialAnalysis({ from: '2026-10-01', to: '2026-10-31' }, {
      cashRows: [], stockRows: [], purchaseRows: [], expenseRows: [], debtRows: [], debtPaymentRows: [],
    });
    const tables = [
      datasets.summaryTable(analysis),
      datasets.moneyTable(buildMoneyReport([], [])),
      datasets.dailyTable([]),
      datasets.monthlyTable([]),
      datasets.categoriesTable(analysis),
      expensesTable([]),
      productSalesTable([]),
      stockTable([]),
      debtsTable([]),
    ];
    const columns = new Set(tables.flatMap((table) => table.columns.map((column) => column.key)));
    const metrics = new Set(datasets.summaryTable(analysis).rows.map((row) => String(row.metric)));
    for (const locale of ['en', 'ru', 'uz']) {
      const { assistant } = (await import(`@/messages/${locale}.json`)).default as {
        assistant: { columns: Record<string, string>; metrics: Record<string, string> };
      };
      expect([...columns].filter((key) => !assistant.columns[key]), locale).toEqual([]);
      expect([...metrics].filter((key) => !assistant.metrics[key]), locale).toEqual([]);
    }
  });
});

describe('PlayStation in the assistant datasets', () => {
  const cashRows = [
    { date: '2026-11-01', cash_income: 1_000_000, terminal_income: 0, card_income: 0, playstation_income: 30_000 },
    { date: '2026-11-02', cash_income: 1_000_000, terminal_income: 0, card_income: 0, playstation_income: 0 },
    { date: '2026-11-03', cash_income: 1_000_000, terminal_income: 0, card_income: 0, playstation_income: 60_000 },
  ];
  const ledgers = { cashRows, stockRows: [], purchaseRows: [], expenseRows: [], debtRows: [], debtPaymentRows: [] };

  it('gives the PlayStation average per day and its share of game-club income', async () => {
    const { buildFinancialAnalysis } = await import('@/lib/calculations/financialAnalysis');
    const { summaryTable } = await import('./datasets');
    const rows = summaryTable(buildFinancialAnalysis({ from: '2026-11-01', to: '2026-11-03' }, ledgers)).rows;
    const metric = (name: string) => rows.find((row) => row.metric === name)?.value;
    expect(metric('playstation')).toBe(90_000);
    // Three counted game-club days.
    expect(metric('playstationAverageDailyIncome')).toBe(30_000);
    expect(metric('playstationSharePct')).toBe(2.9);
  });

  it('adds PlayStation money to each day and each month', async () => {
    const { buildFinancialAnalysis, buildMonthlyAnalysis } = await import('@/lib/calculations/financialAnalysis');
    const { dailyTable, monthlyTable } = await import('./datasets');
    const daily = dailyTable(buildFinancialAnalysis({ from: '2026-11-01', to: '2026-11-03' }, ledgers).daily, cashRows);
    expect(daily.columns.map((column) => column.key)).toContain('playstation');
    expect(daily.rows.map((row) => row.playstation)).toEqual([30_000, 0, 60_000]);
    const monthly = monthlyTable(buildMonthlyAnalysis('2026-11-03', ledgers, 2), cashRows);
    expect(monthly.rows.map((row) => [row.month, row.playstation])).toEqual([['2026-10', 0], ['2026-11', 90_000]]);
  });
});

describe('checksTable', () => {
  it('keeps every check on its own side, in the order given', () => {
    const checks: MoneyCheck[] = [
      { kind: 'duplicate_expense', severity: 'danger', side: 'bar', date: '2026-11-03', range: { from: '2026-11-03', to: '2026-11-03' }, category: 'rent', amount: 500_000, count: 2, recordIds: ['a', 'b'] },
      { kind: 'low_income_day', severity: 'warning', side: 'game_club', date: '2026-11-02', range: { from: '2026-11-02', to: '2026-11-02' }, amount: 300_000, usual: 900_000 },
    ];
    expect(checksTable(checks).rows).toEqual([
      { checkKind: 'duplicate_expense', severity: 'danger', side: 'bar', date: '2026-11-03', periodFrom: '2026-11-03', periodTo: '2026-11-03', category: 'rent', amount: 500_000, usual: null, count: 2 },
      { checkKind: 'low_income_day', severity: 'warning', side: 'game_club', date: '2026-11-02', periodFrom: '2026-11-02', periodTo: '2026-11-02', category: null, amount: 300_000, usual: 900_000, count: null },
    ]);
  });

  it('is empty when nothing looks off', () => {
    expect(checksTable([]).rows).toEqual([]);
  });
});

describe('upcomingTable', () => {
  const preset = (id: string, name: string, category: string, source: 'game_club' | 'bar') => ({
    id, name, category, payment_source: source, payment_method: null, monthly_amount: 1_000_000, sort_order: 0, archived_at: null,
  });

  it('lists each plan with its due state and one total per side, never both sides together', () => {
    const upcoming: UpcomingPayments = {
      gameClub: {
        remaining: 1_500_000,
        rows: [
          { preset: preset('p1', 'Rent', 'rent', 'game_club'), remaining: 1_000_000, usualDay: 5, dueDate: '2026-11-05', overdue: true },
          { preset: preset('p2', 'Internet', 'internet', 'game_club'), remaining: 500_000, usualDay: 28, dueDate: '2026-11-28', overdue: false },
          { preset: preset('p3', 'Cleaning', 'cleaning', 'game_club'), remaining: 0, usualDay: 1, dueDate: '2026-11-01', overdue: false },
        ],
      },
      bar: { remaining: 0, rows: [] },
    };
    expect(upcomingTable(upcoming).rows).toEqual([
      { side: 'game_club', plan: 'Rent', category: 'rent', remainingAmount: 1_000_000, dueDate: '2026-11-05', usualDay: 5, dueStatus: 'overdue' },
      { side: 'game_club', plan: 'Internet', category: 'internet', remainingAmount: 500_000, dueDate: '2026-11-28', usualDay: 28, dueStatus: 'due' },
      { side: 'game_club', plan: 'Cleaning', category: 'cleaning', remainingAmount: 0, dueDate: '2026-11-01', usualDay: 1, dueStatus: 'paid' },
      { side: 'game_club', plan: null, category: null, remainingAmount: 1_500_000, dueDate: null, usualDay: null, dueStatus: 'total' },
    ]);
  });

  it('has no rows for a month without anything upcoming', () => {
    expect(upcomingTable(null).rows).toEqual([]);
  });
});
