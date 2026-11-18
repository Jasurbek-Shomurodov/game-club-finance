import { describe, expect, it } from 'vitest';
import {
  NO_CATEGORY,
  defaultPurchaseFilters,
  hasActivePurchaseFilters,
  productNamesInCategory,
  purchaseCategories,
  purchaseDateBounds,
  purchaseFiltersFromParams,
  purchaseFiltersToParams,
  purchasePaymentMethods,
  purchaseProductIds,
  summarizePurchaseSpending,
  type PurchaseFilterProduct,
} from './purchaseHistory';

const TODAY = '2026-11-19';
const ALL_METHODS = ['cash', 'terminal', 'card'] as const;

const products: PurchaseFilterProduct[] = [
  { id: 'cola', name: 'Coca Cola 1L', category: 'Drinks' },
  { id: 'fuse', name: 'Fuse Tea', category: ' Drinks ' },
  { id: 'chips', name: 'Chips', category: 'Snacks' },
  { id: 'misc', name: 'Lighter', category: null },
];

describe('purchase filters in the URL', () => {
  it('defaults to every purchase with pickers on the business day', () => {
    const filters = purchaseFiltersFromParams(new URLSearchParams(), TODAY, ALL_METHODS);
    expect(filters).toEqual(defaultPurchaseFilters(TODAY));
    expect(filters).toMatchObject({ period: 'all', day: TODAY, month: '2026-11', from: '2026-11-01', to: TODAY });
    expect(hasActivePurchaseFilters(filters)).toBe(false);
  });

  it('round-trips every filter and keeps unrelated parameters', () => {
    const filters = {
      ...defaultPurchaseFilters(TODAY),
      period: 'range' as const,
      from: '2026-10-01',
      to: '2026-10-15',
      category: 'Drinks',
      product: 'Coca Cola 1L',
      paymentMethod: 'terminal' as const,
    };
    const params = purchaseFiltersToParams(filters, 'product=abc&quantity=3');
    expect(params.get('product')).toBe('abc');
    expect(params.get('quantity')).toBe('3');
    expect(params.get('day')).toBeNull();
    expect(purchaseFiltersFromParams(params, TODAY, ALL_METHODS)).toEqual(filters);
  });

  it('writes only the active period and nothing for the defaults', () => {
    expect(purchaseFiltersToParams(defaultPurchaseFilters(TODAY), 'period=day&day=2026-01-01&pay=cash').toString()).toBe('');
    const month = purchaseFiltersToParams({ ...defaultPurchaseFilters(TODAY), period: 'month', month: '2026-09' });
    expect(month.toString()).toBe('period=month&month=2026-09');
  });

  it('drops malformed dates, unknown periods and methods the club does not use', () => {
    const filters = purchaseFiltersFromParams(
      new URLSearchParams('period=week&day=2026-02-30&month=2026-13&pay=card'),
      TODAY,
      ['cash', 'terminal'],
    );
    expect(filters).toMatchObject({ period: 'all', day: TODAY, month: '2026-11', paymentMethod: '' });
  });

  it('orders a reversed range', () => {
    const filters = purchaseFiltersFromParams(new URLSearchParams('period=range&from=2026-11-10&to=2026-11-02'), TODAY, ALL_METHODS);
    expect(purchaseDateBounds(filters)).toEqual({ from: '2026-11-02', to: '2026-11-10' });
  });
});

describe('purchaseDateBounds', () => {
  const base = defaultPurchaseFilters(TODAY);
  it('covers one day, a whole month, a range or all time', () => {
    expect(purchaseDateBounds({ ...base, period: 'day', day: '2026-11-15' })).toEqual({ from: '2026-11-15', to: '2026-11-15' });
    expect(purchaseDateBounds({ ...base, period: 'month', month: '2026-02' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(purchaseDateBounds({ ...base, period: 'range', from: '2026-11-01', to: '2026-11-05' })).toEqual({ from: '2026-11-01', to: '2026-11-05' });
    expect(purchaseDateBounds(base)).toBeNull();
  });
});

describe('category and product filters', () => {
  it('lists trimmed categories once, uncategorized last', () => {
    expect(purchaseCategories(products)).toEqual(['Drinks', 'Snacks', NO_CATEGORY]);
    expect(purchaseCategories(products.slice(0, 3))).toEqual(['Drinks', 'Snacks']);
  });

  it('offers each product name of the chosen category once', () => {
    expect(productNamesInCategory(products, 'Drinks')).toEqual(['Coca Cola 1L', 'Fuse Tea']);
    expect(productNamesInCategory(products, NO_CATEGORY)).toEqual(['Lighter']);
    expect(productNamesInCategory([...products, { id: 'cola-old', name: 'Coca Cola 1L ', category: 'Drinks' }], '')).toHaveLength(4);
  });

  it('narrows purchases to product ids', () => {
    expect(purchaseProductIds(products, { category: '', product: '' })).toBeNull();
    expect(purchaseProductIds(products, { category: 'Drinks', product: '' })).toEqual(['cola', 'fuse']);
    expect(purchaseProductIds(products, { category: NO_CATEGORY, product: '' })).toEqual(['misc']);
    expect(purchaseProductIds(products, { category: '', product: 'Chips' })).toEqual(['chips']);
    expect(purchaseProductIds(products, { category: 'Drinks', product: 'Chips' })).toEqual([]);
    expect(purchaseProductIds(products, { category: '', product: 'Gone' })).toEqual([]);
    expect(purchaseProductIds(products, { category: 'Unknown', product: '' })).toEqual([]);
    // An archived copy with the same name is the same product to the owner.
    expect(purchaseProductIds([...products, { id: 'cola-old', name: 'Coca Cola 1L', category: 'Drinks' }], { category: '', product: 'Coca Cola 1L' })).toEqual(['cola', 'cola-old']);
  });

  it('narrows purchases to one payment method', () => {
    expect(purchasePaymentMethods({ paymentMethod: '' })).toBeNull();
    expect(purchasePaymentMethods({ paymentMethod: 'card' })).toEqual(['card']);
  });

  it('counts any narrowing filter as active', () => {
    const base = defaultPurchaseFilters(TODAY);
    expect(hasActivePurchaseFilters({ ...base, category: 'Drinks' })).toBe(true);
    expect(hasActivePurchaseFilters({ ...base, paymentMethod: 'cash' })).toBe(true);
    expect(hasActivePurchaseFilters({ ...base, period: 'day' })).toBe(true);
  });
});

describe('summarizePurchaseSpending', () => {
  it('totals quantity × unit cost per day and per month, newest first', () => {
    const summary = summarizePurchaseSpending([
      { date: '2026-11-15', quantity: 24, cost_price: 13542 },
      { date: '2026-11-15', quantity: 12, cost_price: 10000 },
      { date: '2026-11-02', quantity: 10, cost_price: 5000 },
      { date: '2026-10-30', quantity: 2, cost_price: 1500.5 },
    ]);
    expect(summary.total).toBe(325008 + 120000 + 50000 + 3001);
    expect(summary.quantity).toBe(48);
    expect(summary.count).toBe(4);
    expect(summary.byDay).toEqual([
      { key: '2026-11-15', total: 445008, quantity: 36, count: 2 },
      { key: '2026-11-02', total: 50000, quantity: 10, count: 1 },
      { key: '2026-10-30', total: 3001, quantity: 2, count: 1 },
    ]);
    expect(summary.byMonth).toEqual([
      { key: '2026-11', total: 495008, quantity: 46, count: 3 },
      { key: '2026-10', total: 3001, quantity: 2, count: 1 },
    ]);
  });

  it('reads numeric strings from the database and is empty for no rows', () => {
    const summary = summarizePurchaseSpending([{ date: '2026-11-01', quantity: '3' as unknown as number, cost_price: '1000' as unknown as number }]);
    expect(summary.total).toBe(3000);
    expect(summarizePurchaseSpending([])).toEqual({ total: 0, quantity: 0, count: 0, byDay: [], byMonth: [] });
  });
});
