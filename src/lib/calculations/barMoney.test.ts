import { describe, expect, it } from 'vitest';
import {
  STOCK_PURCHASE_DEDUCTION_START_DATE,
  calculateBarMoney,
  sumStockPurchaseCost,
} from './barMoney';

describe('bar money calculations', () => {
  it('deducts stock purchases from bar sales from the configured start date', () => {
    const result = calculateBarMoney(
      [{ bar_income: 78_000 }],
      [
        { date: '2026-07-01', quantity: 10, cost_price: 10_000 },
        { date: STOCK_PURCHASE_DEDUCTION_START_DATE, quantity: 2, cost_price: 10_000 },
        { date: '2026-07-03', quantity: 3, cost_price: 5_000 },
      ],
    );

    expect(result.barSales).toBe(78_000);
    expect(result.stockPurchaseCost).toBe(35_000);
    expect(result.barMoney).toBe(43_000);
  });

  it('can return negative bar money when purchases exceed bar sales', () => {
    expect(
      calculateBarMoney(
        [{ bar_income: 20_000 }],
        [{ date: '2026-07-02', quantity: 3, cost_price: 10_000 }],
      ).barMoney,
    ).toBe(-10_000);
  });

  it('does not deduct legacy purchases before the deduction start date', () => {
    expect(
      sumStockPurchaseCost([
        { date: '2026-06-30', quantity: 5, cost_price: 10_000 },
        { date: '2026-07-01', quantity: 5, cost_price: 10_000 },
      ]),
    ).toBe(0);
  });
});

describe('bar money with incomplete rows', () => {
  it('counts a stock row without bar income as no sales', () => {
    const result = calculateBarMoney(
      [{ bar_income: 30_000 }, { bar_income: null as unknown as number }, { bar_income: '12000' as unknown as number }],
      [],
    );

    expect(result).toEqual({ barSales: 42_000, stockPurchaseCost: 0, barMoney: 42_000 });
  });

  it('charges nothing for a purchase missing its quantity or its cost', () => {
    expect(sumStockPurchaseCost([
      { date: '2026-07-05', quantity: null as unknown as number, cost_price: 10_000 },
      { date: '2026-07-05', quantity: 4, cost_price: null as unknown as number },
      { date: '2026-07-05', quantity: 2, cost_price: 3_500 },
    ])).toBe(7_000);
  });

  it('is zero with no sales and no purchases', () => {
    expect(calculateBarMoney([], [])).toEqual({ barSales: 0, stockPurchaseCost: 0, barMoney: 0 });
  });
});
