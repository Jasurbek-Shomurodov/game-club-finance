import { describe, expect, it } from 'vitest';
import type { Product } from '@/types';
import { summarizeStockRow } from './calculations/stock';
import { buildClosingStockUpserts, closingStockRowTotalsInput, validateClosingStockRows, type ClosingStockRowData } from './closingStock';
import {
  applyStockWriteOff,
  formatWriteOffReason,
  maxWriteOffQuantity,
  parseWriteOffReason,
  rowWriteOff,
  StockWriteOffError,
  summarizeStockWriteOffs,
} from './stockWriteOffs';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'coke',
    club_id: 'club-1',
    name: 'Coke',
    category: 'bar',
    sale_price: 10_000,
    cost_price: 6_000,
    current_stock: 0,
    tracks_inventory: true,
    low_stock_threshold: null,
    sort_order: null,
    is_active: true,
    is_deleted: false,
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function row(overrides: Partial<ClosingStockRowData> = {}): ClosingStockRowData {
  return {
    product: product(),
    previousStock: '10',
    addedToday: '2',
    closingStock: '9',
    soldQuantity: '3',
    adjustmentQuantity: '0',
    adjustmentReason: '',
    giveawayQuantity: '0',
    promotionId: null,
    ...overrides,
  };
}

describe('write-off reasons', () => {
  it('round-trips the kind and an optional note', () => {
    expect(formatWriteOffReason('expired', '  sour milk ')).toBe('expired: sour milk');
    expect(formatWriteOffReason('shortage')).toBe('shortage');
    expect(parseWriteOffReason('expired: sour milk')).toEqual({ kind: 'expired', note: 'sour milk' });
    expect(parseWriteOffReason('shortage')).toEqual({ kind: 'shortage', note: '' });
  });

  it('reads an older free-text adjustment reason as "other"', () => {
    expect(parseWriteOffReason('broken bottle')).toEqual({ kind: 'other', note: 'broken bottle' });
  });
});

describe('applyStockWriteOff', () => {
  it('removes units from closing stock, keeps sales and charges the cost to bar profit', () => {
    const before = row();
    const after = applyStockWriteOff(before, { kind: 'shortage', quantity: 2, note: 'missing' });

    expect(after).toMatchObject({
      adjustmentQuantity: '-2',
      adjustmentReason: 'shortage: missing',
      closingStock: '7',
      soldQuantity: '3',
    });
    const was = summarizeStockRow(closingStockRowTotalsInput(before));
    const now = summarizeStockRow(closingStockRowTotalsInput(after));
    expect(now).toMatchObject({
      soldQuantity: was.soldQuantity,
      barIncome: was.barIncome,
      writeOffQuantity: 2,
      writeOffCost: 12_000,
      barCost: was.barCost + 12_000,
      barProfit: was.barProfit - 12_000,
    });
    expect(validateClosingStockRows([after])).toBeNull();
    expect(rowWriteOff(after)).toEqual({ quantity: 2, kind: 'shortage', note: 'missing' });
  });

  it('replaces an earlier write-off by the difference and clears it at zero', () => {
    const first = applyStockWriteOff(row(), { kind: 'expired', quantity: 2 });
    const changed = applyStockWriteOff(first, { kind: 'expired', quantity: 5 });
    expect(changed).toMatchObject({ adjustmentQuantity: '-5', closingStock: '4' });

    const cleared = applyStockWriteOff(changed, { kind: 'expired', quantity: 0 });
    expect(cleared).toMatchObject({ adjustmentQuantity: '0', adjustmentReason: '', closingStock: '9' });
    expect(rowWriteOff(cleared)).toBeNull();
  });

  it('sends the write-off as an adjustment with its reason', () => {
    const written = applyStockWriteOff(row(), { kind: 'expired', quantity: 1 });
    const { upserts } = buildClosingStockUpserts({ date: '2026-11-13', rows: [written], createdBy: null });
    expect(upserts[0]).toMatchObject({
      adjustment_quantity: -1, adjustment_reason: 'expired', closing_stock: 8, sold_quantity: 3,
      bar_income: 30_000, bar_cost: 24_000, bar_profit: 6_000,
    });
  });

  it('refuses more than the remaining stock', () => {
    const written = applyStockWriteOff(row(), { kind: 'shortage', quantity: 4 });
    expect(maxWriteOffQuantity(written)).toBe(9);
    expect(() => applyStockWriteOff(written, { kind: 'shortage', quantity: 10 }))
      .toThrow(expect.objectContaining({ code: 'exceeds_stock', availableQuantity: 9 }));
  });

  it('refuses made-to-order products and rows with a positive adjustment', () => {
    expect(() => applyStockWriteOff(row({ product: product({ tracks_inventory: false }) }), { kind: 'shortage', quantity: 1 }))
      .toThrow(StockWriteOffError);
    expect(() => applyStockWriteOff(row({ adjustmentQuantity: '3', adjustmentReason: 'found' }), { kind: 'shortage', quantity: 1 }))
      .toThrow(expect.objectContaining({ code: 'positive_adjustment' }));
  });
});

describe('summarizeStockWriteOffs', () => {
  it('totals negative adjustments at their saved cost by kind', () => {
    const summary = summarizeStockWriteOffs([
      { date: '2026-11-12', product_id: 'coke', adjustment_quantity: -2, adjustment_reason: 'shortage', cost_price: 6_000, products: { name: 'Coke' } },
      { date: '2026-11-13', product_id: 'milk', adjustment_quantity: '-3', adjustment_reason: 'expired: sour', cost_price: '4000.5', products: { name: 'Milk' } },
      { date: '2026-11-11', product_id: 'chips', adjustment_quantity: -1, adjustment_reason: 'broken', cost_price: 2_000, products: { name: 'Chips' } },
      { date: '2026-11-11', product_id: 'tea', adjustment_quantity: 4, adjustment_reason: 'found', cost_price: 3_000, products: { name: 'Tea' } },
      { date: '2026-11-11', product_id: 'water', adjustment_quantity: 0, adjustment_reason: null, cost_price: 1_000, products: null },
    ]);

    expect(summary.entries.map((entry) => entry.productName)).toEqual(['Milk', 'Coke', 'Chips']);
    expect(summary.entries[0]).toMatchObject({ kind: 'expired', note: 'sour', quantity: 3, cost: 12_001.5 });
    expect(summary.byKind.shortage).toEqual({ quantity: 2, cost: 12_000 });
    expect(summary.byKind.expired).toEqual({ quantity: 3, cost: 12_001.5 });
    expect(summary.byKind.other).toEqual({ quantity: 1, cost: 2_000 });
    expect(summary.total).toEqual({ quantity: 6, cost: 26_001.5 });
  });
});
