import { describe, expect, it } from 'vitest';
import { buildMoneyReport } from '@/lib/calculations/moneyReport';
import {
  allowedDatasets,
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
      'summary', 'money', 'daily', 'monthly', 'categories', 'expenses', 'product_sales', 'stock', 'debts',
    ]);
  });

  it('follows the member feature access', () => {
    expect(allowedDatasets('admin', ['assistant', 'debts'])).toEqual(['debts']);
    expect(allowedDatasets('admin', ['assistant', 'expenses'])).toEqual(['expenses']);
    expect(allowedDatasets('viewer', ['assistant', 'closing_stock'])).toEqual(['product_sales', 'stock']);
    expect(allowedDatasets('admin', ['assistant', 'reports'])).toEqual([
      'summary', 'money', 'daily', 'monthly', 'categories', 'expenses', 'product_sales',
    ]);
    expect(allowedDatasets('admin', ['assistant'])).toEqual([]);
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
