import { describe, it, expect } from 'vitest';
import {
  calculateStockOpeningBalances,
  calculateSoldQuantity,
  calculateClosingStockFromSold,
  calculateBarIncome,
  calculateBarCost,
  calculateBarProfit,
  calculateDirectSalesSummary,
  calculateStockCountSummary,
  applyPurchaseDeltaToStockCount,
  calculateWeightedAverageCost,
  calculateClosingStockDefaults,
  calculateAvailableStock,
  validateStockAvailability,
  isWholePositiveStockQuantity,
  recalculateFutureStockCounts,
  isLowStock,
  listLowStockProducts,
  LOW_STOCK_DEFAULT,
  stockLevel,
  summarizeStockRows,
} from './stock';

describe('calculateSoldQuantity', () => {
  it('returns correct sold quantity', () => {
    expect(calculateSoldQuantity(100, 20, 80)).toBe(40);
  });

  it('returns 0 when closing stock exceeds opening + added', () => {
    expect(calculateSoldQuantity(10, 0, 20)).toBe(0);
  });

  it('returns 0 when nothing was sold', () => {
    expect(calculateSoldQuantity(50, 10, 60)).toBe(0);
  });

  it('includes an explicit signed inventory adjustment', () => {
    expect(calculateSoldQuantity(10, 0, 13, 5)).toBe(2);
    expect(calculateSoldQuantity(10, 5, 8, -2)).toBe(5);
  });
});

describe('stock availability validation', () => {
  it('identifies unexplained inventory increases', () => {
    expect(validateStockAvailability(10, 0, 13)).toEqual({
      availableStock: 10,
      excessClosingStock: 3,
      isValid: false,
    });
  });

  it('accepts a closing count covered by an explicit adjustment', () => {
    expect(calculateAvailableStock(10, 0, 5)).toBe(15);
    expect(validateStockAvailability(10, 0, 13, 5)).toEqual({
      availableStock: 15,
      excessClosingStock: 0,
      isValid: true,
    });
  });

  it('rejects an adjustment that makes available stock negative', () => {
    expect(validateStockAvailability(2, 0, 0, -3).isValid).toBe(false);
  });
});

describe('stock purchase quantity validation', () => {
  it('accepts only positive whole units', () => {
    expect(isWholePositiveStockQuantity(1)).toBe(true);
    expect(isWholePositiveStockQuantity(306)).toBe(true);
    expect(isWholePositiveStockQuantity(0)).toBe(false);
    expect(isWholePositiveStockQuantity(-1)).toBe(false);
    expect(isWholePositiveStockQuantity(0.01)).toBe(false);
    expect(isWholePositiveStockQuantity(305.99)).toBe(false);
  });
});

describe('calculateClosingStockFromSold', () => {
  it('calculates ending stock from previous stock, added stock and sold quantity', () => {
    expect(calculateClosingStockFromSold(20, 50, 0)).toBe(70);
    expect(calculateClosingStockFromSold(20, 50, 7)).toBe(63);
  });

  it('does not allow ending stock to become negative', () => {
    expect(calculateClosingStockFromSold(20, 50, 80)).toBe(0);
  });

  it('includes an inventory adjustment when deriving closing stock', () => {
    expect(calculateClosingStockFromSold(10, 0, 2, 5)).toBe(13);
  });
});

describe('calculateBarIncome', () => {
  it('multiplies sold quantity by sale price', () => {
    expect(calculateBarIncome(10, 5000)).toBe(50000);
  });

  it('returns 0 when nothing was sold', () => {
    expect(calculateBarIncome(0, 5000)).toBe(0);
  });
});

describe('calculateBarCost', () => {
  it('multiplies sold quantity by cost price', () => {
    expect(calculateBarCost(10, 3000)).toBe(30000);
  });
});

describe('calculateBarProfit', () => {
  it('subtracts cost from income', () => {
    expect(calculateBarProfit(50000, 30000)).toBe(20000);
  });

  it('can return negative profit', () => {
    expect(calculateBarProfit(1000, 2000)).toBe(-1000);
  });
});

describe('calculateDirectSalesSummary', () => {
  it('calculates made-to-order revenue and cost without stock limits', () => {
    expect(calculateDirectSalesSummary(4, 25_000, 11_000)).toEqual({
      soldQuantity: 4,
      giveawayQuantity: 0,
      giveawayCost: 0,
      barIncome: 100_000,
      barCost: 44_000,
      barProfit: 56_000,
    });
  });
});

describe('calculateStockCountSummary', () => {
  it('returns full summary correctly', () => {
    const result = calculateStockCountSummary({
      previousStock: 100,
      addedToday: 20,
      closingStock: 80,
      salePrice: 5000,
      costPrice: 3000,
    });
    expect(result.soldQuantity).toBe(40);
    expect(result.barIncome).toBe(200000);
    expect(result.barCost).toBe(120000);
    expect(result.barProfit).toBe(80000);
  });

  it('scenario: prev=100 added=20 closing=90 → soldQty=30', () => {
    const result = calculateStockCountSummary({
      previousStock: 100,
      addedToday: 20,
      closingStock: 90,
      salePrice: 15000,
      costPrice: 7000,
    });
    expect(result.soldQuantity).toBe(30);
    expect(result.barIncome).toBe(450000);
    expect(result.barCost).toBe(210000);
    expect(result.barProfit).toBe(240000);
  });

  it('zero sale calculates correctly', () => {
    const result = calculateStockCountSummary({
      previousStock: 50,
      addedToday: 0,
      closingStock: 50,
      salePrice: 5000,
      costPrice: 2000,
    });
    expect(result.soldQuantity).toBe(0);
    expect(result.barIncome).toBe(0);
    expect(result.barCost).toBe(0);
    expect(result.barProfit).toBe(0);
  });

  it('calculates sales after an explicit positive adjustment', () => {
    expect(calculateStockCountSummary({
      previousStock: 10,
      addedToday: 0,
      adjustmentQuantity: 5,
      closingStock: 13,
      salePrice: 10_000,
      costPrice: 6_000,
    })).toEqual({
      soldQuantity: 2,
      giveawayQuantity: 0,
      giveawayCost: 0,
      barIncome: 20_000,
      barCost: 12_000,
      barProfit: 8_000,
    });
  });
});

describe('applyPurchaseDeltaToStockCount', () => {
  it('adds a same-day purchase to saved added and closing stock without changing sold quantity', () => {
    expect(applyPurchaseDeltaToStockCount({
      previousStock: 10,
      addedToday: 5,
      closingStock: 12,
      quantityDelta: 3,
      salePrice: 15000,
      costPrice: 9000,
    })).toEqual({
      addedToday: 8,
      closingStock: 15,
      soldQuantity: 3,
      giveawayQuantity: 0,
      giveawayCost: 0,
      barIncome: 45000,
      barCost: 27000,
      barProfit: 18000,
    });
  });

  it('removes a deleted purchase from saved added and closing stock and clamps at zero', () => {
    expect(applyPurchaseDeltaToStockCount({
      previousStock: 10,
      addedToday: 2,
      closingStock: 1,
      quantityDelta: -5,
      salePrice: 10000,
      costPrice: 6000,
    })).toEqual({
      addedToday: 0,
      closingStock: 0,
      soldQuantity: 10,
      giveawayQuantity: 0,
      giveawayCost: 0,
      barIncome: 100000,
      barCost: 60000,
      barProfit: 40000,
    });
  });
});

describe('calculateWeightedAverageCost', () => {
  it('calculates weighted average when existing and purchased quantities are equal', () => {
    expect(calculateWeightedAverageCost({
      currentStock: 10,
      currentCostPrice: 8200,
      purchasedQuantity: 10,
      purchaseCostPrice: 7200,
    })).toBe(7700);
  });

  it('weights by quantity when purchase quantity differs from current stock', () => {
    expect(calculateWeightedAverageCost({
      currentStock: 5,
      currentCostPrice: 10000,
      purchasedQuantity: 15,
      purchaseCostPrice: 6000,
    })).toBe(7000);
  });

  it('uses purchase cost when there is no existing stock', () => {
    expect(calculateWeightedAverageCost({
      currentStock: 0,
      currentCostPrice: 8200,
      purchasedQuantity: 10,
      purchaseCostPrice: 7200,
    })).toBe(7200);
  });

  it('keeps current cost when purchased quantity is zero', () => {
    expect(calculateWeightedAverageCost({
      currentStock: 10,
      currentCostPrice: 8200,
      purchasedQuantity: 0,
      purchaseCostPrice: 7200,
    })).toBe(8200);
  });

  it('returns zero when no stock exists before or after purchase', () => {
    expect(calculateWeightedAverageCost({
      currentStock: 0,
      currentCostPrice: 8200,
      purchasedQuantity: 0,
      purchaseCostPrice: 7200,
    })).toBe(0);
  });

  it('treats negative quantities as zero', () => {
    expect(calculateWeightedAverageCost({
      currentStock: -10,
      currentCostPrice: 8200,
      purchasedQuantity: 10,
      purchaseCostPrice: 7200,
    })).toBe(7200);
  });
});

describe('calculateClosingStockDefaults', () => {
  it('splits current stock into previous stock and purchases made today', () => {
    expect(calculateClosingStockDefaults({
      currentStock: 124,
      purchasedToday: 24,
    })).toEqual({
      previousStock: 100,
      addedToday: 24,
      closingStock: 124,
    });
  });

  it('keeps added today at zero when no purchases were made today', () => {
    expect(calculateClosingStockDefaults({
      currentStock: 79,
      purchasedToday: 0,
    })).toEqual({
      previousStock: 79,
      addedToday: 0,
      closingStock: 79,
    });
  });

  it('does not allow previous stock to become negative', () => {
    expect(calculateClosingStockDefaults({
      currentStock: 10,
      purchasedToday: 24,
    })).toEqual({
      previousStock: 0,
      addedToday: 24,
      closingStock: 10,
    });
  });
});

describe('recalculateFutureStockCounts', () => {
  it('chains previous stock from the edited closing stock into later saved days', () => {
    expect(recalculateFutureStockCounts(66, [
      {
        date: '2026-06-03',
        added_today: 10,
        adjustment_quantity: 2,
        closing_stock: 70,
        sale_price: 15000,
        cost_price: 10000,
      },
      {
        date: '2026-06-02',
        added_today: 0,
        closing_stock: 60,
        sale_price: 15000,
        cost_price: 10000,
      },
    ])).toEqual([
      {
        date: '2026-06-02',
        previous_stock: 66,
        added_today: 0,
        closing_stock: 60,
        sold_quantity: 6,
        sale_price: 15000,
        cost_price: 10000,
        bar_income: 90000,
        bar_cost: 60000,
        bar_profit: 30000,
      },
      {
        date: '2026-06-03',
        previous_stock: 60,
        added_today: 10,
        adjustment_quantity: 2,
        closing_stock: 70,
        sold_quantity: 2,
        sale_price: 15000,
        cost_price: 10000,
        bar_income: 30000,
        bar_cost: 20000,
        bar_profit: 10000,
      },
    ]);
  });
});

describe('opening stock between closings', () => {
  it('uses each product’s latest closing and excludes both interval boundaries', () => {
    expect(calculateStockOpeningBalances([
      { product_id: 'a', date: '2026-09-10', closing_stock: 100 },
      { product_id: 'a', date: '2026-09-12', closing_stock: 3 },
      { product_id: 'b', date: '2026-09-14', closing_stock: 4 },
      { product_id: 'a', date: '2026-09-15', closing_stock: 999 },
    ], [
      { product_id: 'a', date: '2026-09-12', quantity: 50, cost_price: 1 },
      { product_id: 'a', date: '2026-09-13', quantity: 2, cost_price: 1 },
      { product_id: 'a', date: '2026-09-14', quantity: 4, cost_price: 1 },
      { product_id: 'a', date: '2026-09-15', quantity: 20, cost_price: 1 },
      { product_id: 'a', date: '2026-09-16', quantity: 30, cost_price: 1 },
      { product_id: 'b', date: '2026-09-14', quantity: 50, cost_price: 1 },
    ], '2026-09-15', true)).toEqual({ a: 9, b: 4 });
  });

  it('keeps current live-stock defaults before the first closing and uses earlier receipts for historical dates', () => {
    const receipts = [
      { product_id: 'new', date: '2026-09-13', quantity: 6, cost_price: 1 },
      { product_id: 'new', date: '2026-09-15', quantity: 12, cost_price: 1 },
    ];
    expect(calculateStockOpeningBalances([], receipts, '2026-09-14', true)).toEqual({});
    expect(calculateStockOpeningBalances([], receipts, '2026-09-14', false)).toEqual({ new: 6 });
  });
});

describe('low stock', () => {
  it('uses the default threshold only when none is set and keeps an explicit zero', () => {
    expect(LOW_STOCK_DEFAULT).toBe(5);
    expect(isLowStock(5, null)).toBe(true);
    expect(isLowStock(6, undefined)).toBe(false);
    expect(isLowStock(1, 0)).toBe(false);
    expect(isLowStock(0, 10)).toBe(false);
    expect(stockLevel(0, 10)).toBe('out');
    expect(stockLevel(3, 10)).toBe('low');
    expect(stockLevel(30, 10)).toBe('ok');
  });

  it('lists active tracked products that are out or low, emptiest first', () => {
    const base = { tracks_inventory: true, is_active: true, is_deleted: false };
    expect(listLowStockProducts([
      { ...base, name: 'Cola', current_stock: 3, low_stock_threshold: null },
      { ...base, name: 'Water', current_stock: '0', low_stock_threshold: '10' },
      { ...base, name: 'Chips', current_stock: 20, low_stock_threshold: 10 },
      { ...base, name: 'Snickers', current_stock: 3, low_stock_threshold: 4 },
      { ...base, name: 'Tea', current_stock: 0, low_stock_threshold: 5, tracks_inventory: false },
      { ...base, name: 'Old', current_stock: 0, low_stock_threshold: 5, is_deleted: true },
      { ...base, name: 'Paused', current_stock: 1, low_stock_threshold: 5, is_active: false },
      { name: 'Legacy', current_stock: 2, low_stock_threshold: 0 },
    ])).toEqual([
      { name: 'Water', currentStock: 0, threshold: 10, level: 'out' },
      { name: 'Cola', currentStock: 3, threshold: 5, level: 'low' },
      { name: 'Snickers', currentStock: 3, threshold: 4, level: 'low' },
    ]);
  });
});

describe('summarizeStockRows', () => {
  it('totals tracked and made-to-order rows with the canonical formulas', () => {
    expect(summarizeStockRows([
      {
        tracksInventory: true,
        previousStock: 10,
        addedToday: 5,
        adjustmentQuantity: -1,
        closingStock: 4,
        soldQuantity: 999,
        salePrice: 100,
        costPrice: 60,
        purchaseCost: 300,
      },
      {
        tracksInventory: false,
        previousStock: 7,
        addedToday: 7,
        closingStock: 7,
        soldQuantity: 3,
        salePrice: 50,
        costPrice: 20,
        purchaseCost: 1_000,
      },
    ])).toEqual({
      sold: 13,
      giveaways: 0,
      giveawayCost: 0,
      income: 1_150,
      profit: 490,
      stockValue: 240,
      previous: 10,
      added: 5,
      purchaseCost: 300,
    });
  });

  it('returns zero totals for no rows', () => {
    expect(summarizeStockRows([])).toEqual({
      sold: 0, giveaways: 0, giveawayCost: 0, income: 0, profit: 0, stockValue: 0, previous: 0, added: 0, purchaseCost: 0,
    });
  });
});

describe('promo giveaways', () => {
  it('removes given-away units from sold quantity and charges their cost without income', () => {
    expect(calculateSoldQuantity(10, 2, 4, 0, 3)).toBe(5);
    expect(calculateClosingStockFromSold(10, 2, 5, 0, 3)).toBe(4);
    expect(validateStockAvailability(10, 0, 8, 0, 3)).toEqual({ availableStock: 10, excessClosingStock: 1, isValid: false });
    expect(calculateStockCountSummary({
      previousStock: 10, addedToday: 2, giveawayQuantity: 3, closingStock: 4, salePrice: 15_000, costPrice: 9_000,
    })).toEqual({
      soldQuantity: 5,
      giveawayQuantity: 3,
      giveawayCost: 27_000,
      barIncome: 75_000,
      barCost: 72_000,
      barProfit: 3_000,
    });
    expect(calculateDirectSalesSummary(4, 5_000, 1_000, 2)).toMatchObject({ barIncome: 20_000, barCost: 6_000, giveawayCost: 2_000 });
    // Negative or fractional giveaways never add stock back.
    expect(calculateSoldQuantity(10, 0, 4, 0, -2)).toBe(6);
    expect(calculateSoldQuantity(10, 0, 4, 0, 1.9)).toBe(5);
  });

  it('carries giveaways through forward recalculation and totals', () => {
    const [row] = recalculateFutureStockCounts(10, [
      { date: '2026-06-29', added_today: 0, giveaway_quantity: 2, closing_stock: 6, sale_price: 100, cost_price: 40 },
    ]);
    expect(row).toMatchObject({ previous_stock: 10, sold_quantity: 2, bar_income: 200, bar_cost: 160, bar_profit: 40 });
    expect(summarizeStockRows([
      { tracksInventory: true, previousStock: 10, addedToday: 0, giveawayQuantity: 2, closingStock: 6, soldQuantity: 0, salePrice: 100, costPrice: 40 },
    ])).toMatchObject({ sold: 2, giveaways: 2, giveawayCost: 80, income: 200, profit: 40 });
  });
});
