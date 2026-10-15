import { describe, expect, it } from 'vitest';
import {
  allowedDatasets,
  debtsTable,
  expensesTable,
  MODEL_ROW_LIMIT,
  productSalesTable,
  stockTable,
  tableForModel,
} from './datasets';

describe('allowedDatasets', () => {
  it('gives owners every dataset', () => {
    expect(allowedDatasets('owner', null)).toEqual([
      'summary', 'daily', 'monthly', 'categories', 'expenses', 'product_sales', 'stock', 'debts',
    ]);
  });

  it('follows the member feature access', () => {
    expect(allowedDatasets('admin', ['assistant', 'debts'])).toEqual(['debts']);
    expect(allowedDatasets('admin', ['assistant', 'expenses'])).toEqual(['expenses']);
    expect(allowedDatasets('viewer', ['assistant', 'closing_stock'])).toEqual(['product_sales', 'stock']);
    expect(allowedDatasets('admin', ['assistant', 'reports'])).toEqual([
      'summary', 'daily', 'monthly', 'categories', 'expenses', 'product_sales',
    ]);
    expect(allowedDatasets('admin', ['assistant'])).toEqual([]);
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
