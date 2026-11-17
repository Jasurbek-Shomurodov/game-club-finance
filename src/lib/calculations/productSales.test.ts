import { describe, expect, it } from 'vitest';
import { buildProductSalesSummary, salesPeriodStart, sumProductSalesRows } from './productSales';

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
