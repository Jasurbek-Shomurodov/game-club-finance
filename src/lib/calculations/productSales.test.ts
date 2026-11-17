import { describe, expect, it } from 'vitest';
import { buildProductSalesSummary, buildPurchaseSuggestions, buildRestockList, salesPeriodStart, sumProductSalesRows } from './productSales';

const products = [
  { id: 'cola', current_stock: 20, tracks_inventory: true },
  { id: 'chips', current_stock: 3, tracks_inventory: true },
  { id: 'coffee', current_stock: 0, tracks_inventory: false },
  { id: 'gum', current_stock: 50, tracks_inventory: true },
];

describe('salesPeriodStart', () => {
  it('counts the end date as the last day of the period', () => {
    expect(salesPeriodStart('2026-11-17', 30)).toBe('2026-10-19');
    expect(salesPeriodStart('2026-11-17', 1)).toBe('2026-11-17');
    expect(salesPeriodStart('2026-03-01', 7)).toBe('2026-02-23');
    expect(salesPeriodStart('2026-01-05', 30)).toBe('2025-12-07');
  });
});

describe('buildProductSalesSummary', () => {
  const rows = [
    { product_id: 'cola', sold_quantity: 40, bar_income: 400_000, bar_cost: 240_000, days_counted: 10 },
    { product_id: 'chips', sold_quantity: '5', bar_income: '40000', bar_cost: '25000', days_counted: 4 },
    { product_id: 'coffee', sold_quantity: 30, bar_income: 300_000, bar_cost: 60_000, days_counted: 10 },
    { product_id: 'gum', sold_quantity: 0, bar_income: 0, bar_cost: 0, days_counted: 10 },
  ];

  it('totals the period and prices each product\'s margin', () => {
    const summary = buildProductSalesSummary(products, rows);
    expect(summary.countedDays).toBe(10);
    expect(summary.sold).toBe(75);
    expect(summary.income).toBe(740_000);
    expect(summary.profit).toBe(415_000);
    expect(summary.marginPercent).toBe(56.1);
    expect(summary.byProduct.get('cola')).toEqual({ sold: 40, income: 400_000, profit: 160_000, marginPercent: 40, perDay: 4, daysLeft: 5 });
  });

  it('paces every product by the days the club counted, not its own', () => {
    // 5 sold over the club's 10 counted days: half a unit a day, 3 on hand.
    expect(buildProductSalesSummary(products, rows).byProduct.get('chips')).toMatchObject({ perDay: 0.5, daysLeft: 6 });
  });

  it('gives no runway to made-to-order products, unsold products and unknown products', () => {
    const summary = buildProductSalesSummary(products, [...rows, { product_id: 'archived', sold_quantity: 2, bar_income: 10, bar_cost: 4, days_counted: 1 }]);
    expect(summary.byProduct.get('coffee')?.daysLeft).toBeNull();
    expect(summary.byProduct.get('gum')).toMatchObject({ sold: 0, marginPercent: null, daysLeft: null });
    expect(summary.byProduct.get('archived')?.daysLeft).toBeNull();
  });

  it('treats negative stock as nothing left and an empty period as no data', () => {
    const summary = buildProductSalesSummary([{ id: 'cola', current_stock: -2 }], [rows[0]]);
    expect(summary.byProduct.get('cola')?.daysLeft).toBe(0);
    expect(buildProductSalesSummary(products, [])).toMatchObject({ countedDays: 0, sold: 0, income: 0, profit: 0, marginPercent: null });
  });
});

describe('sumProductSalesRows', () => {
  it('adds a product\'s days together and counts its distinct dates', () => {
    expect(sumProductSalesRows([
      { product_id: 'cola', date: '2026-11-01', sold_quantity: 2, bar_income: 20, bar_cost: 12 },
      { product_id: 'cola', date: '2026-11-02', sold_quantity: '3', bar_income: '30', bar_cost: null },
      { product_id: 'chips', date: '2026-11-02', sold_quantity: 1, bar_income: 8, bar_cost: 5 },
    ])).toEqual([
      { product_id: 'cola', sold_quantity: 5, bar_income: 50, bar_cost: 12, days_counted: 2 },
      { product_id: 'chips', sold_quantity: 1, bar_income: 8, bar_cost: 5, days_counted: 1 },
    ]);
  });
});

describe('buildRestockList', () => {
  const catalog = [
    { id: 'cola', name: 'Cola', current_stock: 0, low_stock_threshold: 5, tracks_inventory: true, is_active: true },
    { id: 'water', name: 'Water', current_stock: 12, low_stock_threshold: 5, tracks_inventory: true, is_active: true },
    { id: 'chips', name: 'Chips', current_stock: 3, low_stock_threshold: 5, tracks_inventory: true, is_active: true },
    { id: 'gum', name: 'Gum', current_stock: 0, low_stock_threshold: null, tracks_inventory: true, is_active: true },
    { id: 'tea', name: 'Tea', current_stock: 200, low_stock_threshold: 5, tracks_inventory: true, is_active: true },
    { id: 'coffee', name: 'Coffee', current_stock: 0, low_stock_threshold: 5, tracks_inventory: false, is_active: true },
    { id: 'old', name: 'Old', current_stock: 0, low_stock_threshold: 5, tracks_inventory: true, is_active: false },
    { id: 'gone', name: 'Gone', current_stock: 0, low_stock_threshold: 5, tracks_inventory: true, is_active: true, is_deleted: true },
  ];
  const summary = buildProductSalesSummary(catalog, [
    { product_id: 'cola', sold_quantity: 50, bar_income: 500, bar_cost: 300, days_counted: 10 },
    { product_id: 'water', sold_quantity: 40, bar_income: 200, bar_cost: 100, days_counted: 10 },
    { product_id: 'chips', sold_quantity: 2, bar_income: 16, bar_cost: 10, days_counted: 10 },
    { product_id: 'tea', sold_quantity: 10, bar_income: 50, bar_cost: 20, days_counted: 10 },
    { product_id: 'coffee', sold_quantity: 30, bar_income: 300, bar_cost: 60, days_counted: 10 },
  ]);

  it('orders by the units missing for the coming week, then by what sold', () => {
    expect(buildRestockList(catalog, summary).map((item) => [item.name, item.level, item.shortfall, item.sold, item.daysLeft])).toEqual([
      // 5 a day and nothing on the shelf: 35 short for the week.
      ['Cola', 'out', 35, 50, 0],
      // Above its low-stock level, but 12 units at 4 a day are gone in 3 days: 16 short.
      ['Water', 'ok', 16, 40, 3],
      // Below its level yet enough for the week at 2 sold in the period.
      ['Chips', 'low', 0, 2, 15],
      // Nothing sold in the period: listed, but after everything that sells.
      ['Gum', 'out', 0, 0, null],
    ]);
  });

  it('ranks a busy product that is nearly out above an empty shelf that barely sold', () => {
    const products = [
      { id: 'rare', name: 'Rare', current_stock: 0, low_stock_threshold: 5, is_active: true },
      { id: 'busy', name: 'Busy', current_stock: 6, low_stock_threshold: 5, is_active: true },
    ];
    const sales = buildProductSalesSummary(products, [
      { product_id: 'rare', sold_quantity: 1, bar_income: 10, bar_cost: 5, days_counted: 30 },
      { product_id: 'busy', sold_quantity: 90, bar_income: 900, bar_cost: 500, days_counted: 30 },
    ]);
    expect(buildRestockList(products, sales).map((item) => [item.name, item.shortfall])).toEqual([['Busy', 15], ['Rare', 1]]);
  });

  it('leaves out healthy stock, made-to-order, inactive and archived products', () => {
    const names = buildRestockList(catalog, summary).map((item) => item.name);
    for (const name of ['Tea', 'Coffee', 'Old', 'Gone']) expect(names).not.toContain(name);
  });

  it('respects the horizon for products above their low-stock level', () => {
    expect(buildRestockList(catalog, summary, 2).map((item) => item.name)).toEqual(['Cola', 'Chips', 'Gum']);
  });

  it('is the plain low-stock list, lowest stock first, when sales are unknown', () => {
    for (const unknown of [null, buildProductSalesSummary(catalog, [])]) {
      expect(buildRestockList(catalog, unknown)).toEqual([
        { id: 'cola', name: 'Cola', currentStock: 0, level: 'out', sold: null, shortfall: 0, daysLeft: null },
        { id: 'gum', name: 'Gum', currentStock: 0, level: 'out', sold: null, shortfall: 0, daysLeft: null },
        { id: 'chips', name: 'Chips', currentStock: 3, level: 'low', sold: null, shortfall: 0, daysLeft: null },
      ]);
    }
  });
});

describe('buildPurchaseSuggestions', () => {
  const shelf = [
    { id: 'cola', name: 'Cola', current_stock: 2, low_stock_threshold: 5, cost_price: 6_000 },
    { id: 'chips', name: 'Chips', current_stock: 0, low_stock_threshold: 5, cost_price: '5000.5' },
    { id: 'gum', name: 'Gum', current_stock: 0, low_stock_threshold: 5, cost_price: 1_000 },
    { id: 'water', name: 'Water', current_stock: 40, low_stock_threshold: 5, cost_price: 2_000 },
    { id: 'tea', name: 'Tea', current_stock: 0, low_stock_threshold: 5, cost_price: 3_000, tracks_inventory: false },
  ];
  // Ten counted days: cola 3 a day, chips 1 a day, water 2 a day, gum never sold.
  const sales = buildProductSalesSummary(shelf, [
    { product_id: 'cola', sold_quantity: 30, bar_income: 300_000, bar_cost: 180_000, days_counted: 10 },
    { product_id: 'chips', sold_quantity: 10, bar_income: 80_000, bar_cost: 50_000, days_counted: 10 },
    { product_id: 'water', sold_quantity: 20, bar_income: 100_000, bar_cost: 40_000, days_counted: 10 },
    { product_id: 'tea', sold_quantity: 50, bar_income: 250_000, bar_cost: 100_000, days_counted: 10 },
  ]);

  it('suggests a week of each selling product that is short, with its cost', () => {
    const { items, more, totalCost } = buildPurchaseSuggestions(shelf, sales);
    // Cola needs 21 and has 2; chips need 7 and have none. Water covers the week,
    // gum did not sell and tea is made to order.
    expect(items.map((item) => [item.name, item.shortfall, item.cost])).toEqual([
      ['Cola', 19, 114_000],
      ['Chips', 7, 35_003.5],
    ]);
    expect(more).toBe(0);
    expect(totalCost).toBe(149_003.5);
  });

  it('keeps the total for everything when the list is cut short', () => {
    const { items, more, totalCost } = buildPurchaseSuggestions(shelf, sales, 1);
    expect(items.map((item) => item.name)).toEqual(['Cola']);
    expect(more).toBe(1);
    expect(totalCost).toBe(149_003.5);
  });

  it('sizes the order to the horizon asked for', () => {
    expect(buildPurchaseSuggestions(shelf, sales, 6, 14).items.map((item) => [item.name, item.shortfall])).toEqual([
      ['Cola', 40],
      ['Chips', 14],
    ]);
  });

  it('suggests nothing without sales to size an order from', () => {
    expect(buildPurchaseSuggestions(shelf, null)).toEqual({ items: [], more: 0, totalCost: 0 });
    expect(buildPurchaseSuggestions(shelf, buildProductSalesSummary(shelf, []))).toEqual({ items: [], more: 0, totalCost: 0 });
  });
});
