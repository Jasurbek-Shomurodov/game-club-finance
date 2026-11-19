import { describe, expect, it } from 'vitest';
import type { Product } from '@/types';
import {
  applyBulkStockOrder,
  applyClosingStockDraft,
  buildClosingStockUpserts,
  buildEditableClosingStockRows,
  calculateBulkStockOrderSummary,
  calculatePurchaseCostsByProduct,
  changedClosingStockRows,
  clearClosingStockDraft,
  closingStockDraftKey,
  closingStockRowTotalsInput,
  getBulkStockAvailableQuantity,
  isWholeNumberInput,
  normalizeStockAdjustment,
  normalizeStockCount,
  readClosingStockDraft,
  saveClosingStockDraft,
  validateClosingStockRows,
  type ClosingStockDraft,
  type ClosingStockRowData,
  type StorageLike,
} from './closingStock';

// Edge cases of the closing-stock helpers that closingStock.test.ts does not
// reach. Cola sells at 15 000 and costs 9 000; a row opens with 10 units.

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'cola', club_id: 'club-1', name: 'Cola', category: null, sale_price: 15_000, cost_price: 9_000,
  current_stock: 10, tracks_inventory: true, low_stock_threshold: null, sort_order: null,
  is_active: true, is_deleted: false, created_at: '', updated_at: '',
  ...overrides,
});

const row = (overrides: Partial<ClosingStockRowData> = {}): ClosingStockRowData => ({
  product: product(),
  previousStock: '10',
  addedToday: '0',
  adjustmentQuantity: '0',
  adjustmentReason: '',
  giveawayQuantity: '0',
  promotionId: null,
  closingStock: '10',
  soldQuantity: '0',
  ...overrides,
});

const madeToOrder = (overrides: Partial<ClosingStockRowData> = {}) => row({
  product: product({ id: 'tea', name: 'Tea', tracks_inventory: false, sale_price: 5_000, cost_price: 1_000, current_stock: 0 }),
  previousStock: '0',
  closingStock: '0',
  ...overrides,
});

const draftOf = (rows: ClosingStockDraft['rows']): ClosingStockDraft => ({
  version: 1, date: '2026-11-13', clubId: 'club-1', savedAt: '2026-11-13T10:00:00.000Z', rows,
});

/** The row as an older draft or caller would hand it over: without that optional field. */
function without(source: ClosingStockRowData, key: 'adjustmentReason' | 'promotionId'): ClosingStockRowData {
  const copy = { ...source };
  delete copy[key];
  return copy;
}

function memoryStorage(): StorageLike & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
}

describe('purchase cost per product', () => {
  it('sums quantity × receipt cost, reading missing values as zero and skipping unreadable ones', () => {
    expect(calculatePurchaseCostsByProduct([
      { product_id: 'cola', quantity: '3', cost_price: '2000' }, // 6 000
      { product_id: 'cola', quantity: 2, cost_price: 2_500 }, // 5 000
      { product_id: 'cola', quantity: null, cost_price: 9_000 }, // no units
      { product_id: 'fanta', quantity: 4 }, // cost unknown
      { product_id: 'tea', quantity: 'abc', cost_price: 1_000 },
    ])).toEqual({ cola: 11_000, fanta: 0 });
  });
});

describe('stock number parsing', () => {
  it('reads non-finite numbers as zero', () => {
    expect(normalizeStockCount(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizeStockCount(Number.NaN)).toBe(0);
    expect(normalizeStockAdjustment(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('uses the last separator as the decimal mark when both kinds are present', () => {
    expect(normalizeStockCount('1.000,5')).toBe(1000);
    expect(normalizeStockCount('1,000.9')).toBe(1000);
    expect(normalizeStockAdjustment('-1,000.9')).toBe(-1000);
  });

  it('refuses a number with a repeated decimal mark instead of guessing', () => {
    // "." is the decimal mark (it comes last) but appears twice.
    expect(normalizeStockCount('1.5,2.3')).toBe(0);
    expect(normalizeStockCount('1,2,3')).toBe(0);
  });
});

describe('closingStockRowTotalsInput', () => {
  it('maps the typed strings of a tracked row to numbers', () => {
    const withoutReason = without(row({
      addedToday: '2', adjustmentQuantity: '-1', giveawayQuantity: '1', closingStock: '7', soldQuantity: '3',
    }), 'adjustmentReason');

    expect(closingStockRowTotalsInput(withoutReason)).toEqual({
      tracksInventory: true,
      previousStock: 10,
      addedToday: 2,
      adjustmentQuantity: -1,
      adjustmentReason: null,
      giveawayQuantity: 1,
      closingStock: 7,
      soldQuantity: 3,
      salePrice: 15_000,
      costPrice: 9_000,
      purchaseCost: 0,
    });
  });

  it('passes the purchase cost through and marks a made-to-order row', () => {
    expect(closingStockRowTotalsInput(madeToOrder({ soldQuantity: '4' }), 12_000)).toMatchObject({
      tracksInventory: false, soldQuantity: 4, salePrice: 5_000, costPrice: 1_000, purchaseCost: 12_000,
    });
  });

  it('reads a product without prices as free and costless', () => {
    const unpriced = product({ sale_price: null as unknown as number, cost_price: null as unknown as number });
    expect(closingStockRowTotalsInput(row({ product: unpriced }))).toMatchObject({ salePrice: 0, costPrice: 0 });
  });
});

describe('changed rows: values that were never set', () => {
  it('treats a missing adjustment reason like an empty one', () => {
    const withoutReason = without(row(), 'adjustmentReason');
    expect(changedClosingStockRows([withoutReason], [row()])).toEqual([]);
  });

  it('treats a giveaway without a promotion like one with no promotion chosen', () => {
    const unlabelled = without(row({ giveawayQuantity: '1', closingStock: '9' }), 'promotionId');
    expect(changedClosingStockRows([unlabelled], [row({ giveawayQuantity: '1', closingStock: '9', promotionId: null })])).toEqual([]);
    expect(changedClosingStockRows([unlabelled], [row({ giveawayQuantity: '1', closingStock: '9', promotionId: 'promo' })])).toHaveLength(1);
  });

  it('sees a row whose counts are missing altogether as blank, so it differs from a saved zero', () => {
    const blank = row({ closingStock: undefined as unknown as string, soldQuantity: undefined as unknown as string });
    expect(changedClosingStockRows([blank], [row({ closingStock: '0', soldQuantity: '0' })])).toHaveLength(1);
    expect(changedClosingStockRows([blank], [row({ closingStock: '', soldQuantity: '' })])).toEqual([]);
  });
});

describe('bulk orders', () => {
  it('offers what is left of a tracked product and has no limit for made-to-order', () => {
    expect(getBulkStockAvailableQuantity(row({ closingStock: '7' }))).toBe(7);
    expect(getBulkStockAvailableQuantity(row({ closingStock: '' }))).toBe(0);
    expect(getBulkStockAvailableQuantity(madeToOrder())).toBeNull();
  });

  it('totals only positive quantities of listed products, adding repeated lines', () => {
    const rows = [row(), row({ product: product({ id: 'fanta', name: 'Fanta', sale_price: 9_000 }) }), madeToOrder()];

    expect(calculateBulkStockOrderSummary(rows, [
      { productId: 'cola', quantity: 2 },
      { productId: 'cola', quantity: 1 },
      { productId: 'fanta', quantity: 0 },
      { productId: 'fanta', quantity: -4 },
      { productId: 'ghost', quantity: 5 },
    ])).toEqual({ totalQuantity: 3, totalPrice: 45_000 });
  });

  it('counts the units of a product without a sale price at no charge', () => {
    const unpriced = row({ product: product({ sale_price: null as unknown as number }) });
    expect(calculateBulkStockOrderSummary([unpriced], [{ productId: 'cola', quantity: 2 }]))
      .toEqual({ totalQuantity: 2, totalPrice: 0 });
  });

  it('leaves rows untouched when an order line has no positive quantity', () => {
    const rows = [row()];
    expect(applyBulkStockOrder(rows, [{ productId: 'cola', quantity: 0 }, { productId: 'cola', quantity: -2 }])).toEqual(rows);
  });
});

describe('closing stock drafts', () => {
  it('keys a draft by club and date', () => {
    expect(closingStockDraftKey('2026-11-13', 'club-1')).toBe('closing-stock-draft:club-1:2026-11-13');
    expect(closingStockDraftKey('2026-11-13')).toBe('closing-stock-draft:2026-11-13');
  });

  it('does nothing without storage (server render, private mode)', () => {
    expect(readClosingStockDraft(null, '2026-11-13', 'club-1')).toBeNull();
    expect(readClosingStockDraft(undefined, '2026-11-13')).toBeNull();
    expect(saveClosingStockDraft(null, '2026-11-13', [row()])).toBe(false);
    expect(() => clearClosingStockDraft(undefined, '2026-11-13', 'club-1')).not.toThrow();
  });

  it('has no draft for a date nothing was saved for', () => {
    expect(readClosingStockDraft(memoryStorage(), '2026-11-13', 'club-1')).toBeNull();
  });

  it('never shows one club the draft of another', () => {
    const storage = memoryStorage();
    expect(saveClosingStockDraft(storage, '2026-11-13', [row({ soldQuantity: '3', closingStock: '7' })], '2026-11-13T10:00:00.000Z', 'club-1')).toBe(true);

    expect(readClosingStockDraft(storage, '2026-11-13', 'club-1')?.rows).toEqual([{
      productId: 'cola', previousStock: '10', addedToday: '0', adjustmentQuantity: '0', adjustmentReason: '',
      giveawayQuantity: '0', promotionId: null, closingStock: '7', soldQuantity: '3',
    }]);
    expect(readClosingStockDraft(storage, '2026-11-13', 'club-2')).toBeNull();
    expect(readClosingStockDraft(storage, '2026-11-13')).toBeNull();
    expect(readClosingStockDraft(storage, '2026-11-12', 'club-1')).toBeNull();

    // A draft copied under another club's key is still refused.
    storage.items.set(closingStockDraftKey('2026-11-13', 'club-2'), storage.items.get(closingStockDraftKey('2026-11-13', 'club-1'))!);
    expect(readClosingStockDraft(storage, '2026-11-13', 'club-2')).toBeNull();

    clearClosingStockDraft(storage, '2026-11-13', 'club-1');
    expect(readClosingStockDraft(storage, '2026-11-13', 'club-1')).toBeNull();
  });

  it('returns the rows as they are when there is no draft', () => {
    const rows = [row()];
    expect(applyClosingStockDraft(rows, null)).toBe(rows);
  });

  it('does not apply a draft to an inactive or archived product', () => {
    const inactive = row({ product: product({ is_active: false }) });
    const archived = row({ product: product({ id: 'old', is_deleted: true }) });
    const draft = draftOf([
      { productId: 'cola', previousStock: '10', addedToday: '0', closingStock: '4', soldQuantity: '6' },
      { productId: 'old', previousStock: '10', addedToday: '0', closingStock: '4', soldQuantity: '6' },
    ]);

    expect(applyClosingStockDraft([inactive, archived], draft)).toEqual([inactive, archived]);
  });

  it('keeps the row\'s adjustment, giveaway and promotion when an older draft has none', () => {
    const current = row({ adjustmentQuantity: '-1', adjustmentReason: 'shortage', giveawayQuantity: '1', promotionId: 'promo', closingStock: '8' });
    const draft = draftOf([{ productId: 'cola', previousStock: '99', addedToday: '99', closingStock: '', soldQuantity: '2' }]);

    // closing = 10 opening − 1 written off − 1 given away − 2 sold
    expect(applyClosingStockDraft([current], draft)).toEqual([{
      ...current, soldQuantity: '2', closingStock: '6',
    }]);
  });

  it('starts from no adjustment and no giveaway when neither the draft nor the row has them', () => {
    const bare: ClosingStockRowData = { product: product(), previousStock: '10', addedToday: '2', closingStock: '12', soldQuantity: '0' };
    const draft = draftOf([{ productId: 'cola', previousStock: '10', addedToday: '2', closingStock: '7', soldQuantity: '5' }]);

    expect(applyClosingStockDraft([bare], draft)).toEqual([{
      ...bare,
      adjustmentQuantity: '0', adjustmentReason: '', giveawayQuantity: '0', promotionId: null,
      soldQuantity: '5', closingStock: '7',
    }]);
  });

  it('lets the draft clear a promotion the row had', () => {
    const current = row({ giveawayQuantity: '1', promotionId: 'promo', closingStock: '9' });
    const draft = draftOf([{
      productId: 'cola', previousStock: '10', addedToday: '0', giveawayQuantity: '2', promotionId: null, closingStock: '', soldQuantity: '1',
    }]);

    // closing = 10 − 2 given away − 1 sold
    expect(applyClosingStockDraft([current], draft)[0]).toMatchObject({
      giveawayQuantity: '2', promotionId: null, soldQuantity: '1', closingStock: '7',
    });
  });

  it('keeps a blank drafted sold quantity blank so it is still asked for', () => {
    const draft = draftOf([{ productId: 'cola', previousStock: '10', addedToday: '0', closingStock: '10', soldQuantity: '' }]);
    const [restored] = applyClosingStockDraft([row()], draft, 'soldQuantity');

    expect(restored).toMatchObject({ soldQuantity: '', closingStock: '10' });
    expect(validateClosingStockRows([restored])?.code).toBe('sold_required');
  });

  it('keeps a blank drafted count blank in count entry, and derives sold from a typed one', () => {
    const blank = draftOf([{ productId: 'cola', previousStock: '10', addedToday: '0', closingStock: '', soldQuantity: '' }]);
    const [restoredBlank] = applyClosingStockDraft([row()], blank, 'closingStock');
    expect(restoredBlank.closingStock).toBe('');
    expect(validateClosingStockRows([restoredBlank])?.code).toBe('closing_required');

    // An old draft's stale sold figure is ignored: sold = 10 − 7.
    const typed = draftOf([{ productId: 'cola', previousStock: '10', addedToday: '0', closingStock: '7', soldQuantity: '9' }]);
    expect(applyClosingStockDraft([row()], typed, 'closingStock')[0]).toMatchObject({ closingStock: '7', soldQuantity: '3' });
  });

  it('restores only the sold quantity and giveaway of a made-to-order product', () => {
    const draft = draftOf([{
      productId: 'tea', previousStock: '5', addedToday: '3', adjustmentQuantity: '-3', adjustmentReason: 'shortage',
      giveawayQuantity: '1', promotionId: 'promo', closingStock: '9', soldQuantity: '4',
    }]);

    expect(applyClosingStockDraft([madeToOrder()], draft)).toEqual([{
      ...madeToOrder(),
      previousStock: '0', addedToday: '0', adjustmentQuantity: '0', adjustmentReason: '',
      giveawayQuantity: '1', promotionId: 'promo', closingStock: '0', soldQuantity: '4',
    }]);
  });

  it('leaves a made-to-order sold quantity blank when the draft has none', () => {
    const draft = draftOf([{ productId: 'tea', previousStock: '0', addedToday: '0', closingStock: '0' } as ClosingStockDraft['rows'][number]]);
    expect(applyClosingStockDraft([madeToOrder({ soldQuantity: '2' })], draft)[0].soldQuantity).toBe('');
  });
});

describe('building editable rows', () => {
  const base = { counts: [], purchases: [], previousClosings: {}, isCurrentDate: true };

  it('starts a made-to-order product at zero sold with no stock', () => {
    const tea = madeToOrder().product;
    expect(buildEditableClosingStockRows({ ...base, products: [tea] })).toEqual([{
      product: tea, previousStock: '0', addedToday: '0', adjustmentQuantity: '0', adjustmentReason: '',
      giveawayQuantity: '0', promotionId: null, closingStock: '0', soldQuantity: '0',
    }]);
  });

  it('shows a made-to-order product\'s saved sales, giveaway and saved prices', () => {
    const tea = madeToOrder().product;
    const [built] = buildEditableClosingStockRows({
      ...base,
      products: [tea],
      counts: [{ product_id: 'tea', sold_quantity: 4, giveaway_quantity: 1, promotion_id: 'promo', sale_price: 4_000, cost_price: 800 }],
    });

    expect(built).toMatchObject({
      product: { sale_price: 4_000, cost_price: 800 },
      previousStock: '0', closingStock: '0', soldQuantity: '4', giveawayQuantity: '1', promotionId: 'promo',
    });
  });

  it('reads a made-to-order count with no sold or giveaway figure as zero', () => {
    const tea = madeToOrder().product;
    const [built] = buildEditableClosingStockRows({
      ...base, products: [tea], counts: [{ product_id: 'tea', sold_quantity: null, giveaway_quantity: null }],
    });

    expect(built).toMatchObject({ soldQuantity: '0', giveawayQuantity: '0', promotionId: null, product: { sale_price: 5_000, cost_price: 1_000 } });
  });

  it('counts a purchase without a quantity as no units', () => {
    const [built] = buildEditableClosingStockRows({
      ...base,
      products: [product({ current_stock: 10 })],
      purchases: [{ product_id: 'cola', quantity: null }, { product_id: 'cola', quantity: '3' }],
    });

    // No earlier closing on the open day: opening = 10 live − 3 received today.
    expect(built).toMatchObject({ previousStock: '7', addedToday: '3', closingStock: '10', soldQuantity: '0' });
  });

  it('flags a historical count saved with no received units when purchases exist for that date', () => {
    const [built] = buildEditableClosingStockRows({
      ...base,
      isCurrentDate: false,
      products: [product()],
      counts: [{ product_id: 'cola', previous_stock: 10, added_today: null, closing_stock: 8, sold_quantity: 2 }],
      purchases: [{ product_id: 'cola', quantity: 2 }],
    });

    // The snapshot is shown as saved; only the mismatch is reported.
    expect(built).toMatchObject({
      previousStock: '10', addedToday: '0', closingStock: '8', soldQuantity: '2',
      purchaseQuantity: 2, hasPurchaseMismatch: true, adjustmentQuantity: '0', adjustmentReason: '',
      giveawayQuantity: '0', promotionId: null,
    });
  });
});

describe('validating rows', () => {
  it('refuses an adjustment that removes more than the stock on hand', () => {
    const error = validateClosingStockRows([row({
      previousStock: '2', adjustmentQuantity: '-5', adjustmentReason: 'shortage', closingStock: '0', soldQuantity: '0',
    })]);

    expect(error).toMatchObject({
      name: 'ClosingStockValidationError',
      code: 'negative_available_stock',
      productId: 'cola',
      productName: 'Cola',
      availableStock: -3,
      message: 'Cola: the adjustment makes available stock negative.',
    });
  });

  it('requires a reason when the row has an adjustment and no reason field at all', () => {
    const withoutReason = without(row({ adjustmentQuantity: '1', closingStock: '11' }), 'adjustmentReason');
    expect(validateClosingStockRows([withoutReason])).toMatchObject({ code: 'adjustment_reason_required', availableStock: 11 });
  });

  it('asks for the count and the sold quantity when a row has none', () => {
    const noCount = row({ addedToday: '2', closingStock: undefined as unknown as string });
    expect(validateClosingStockRows([noCount])).toMatchObject({ code: 'closing_required', availableStock: 12 });

    const noSold = row({ addedToday: '2', closingStock: '12', soldQuantity: undefined as unknown as string });
    expect(validateClosingStockRows([noSold])).toMatchObject({ code: 'sold_required', availableStock: 12 });
  });

  it('does not validate rows that cannot be written', () => {
    expect(validateClosingStockRows([
      row({ product: product({ is_active: false }), closingStock: '', soldQuantity: '' }),
      row({ product: product({ id: 'old', is_deleted: true }), closingStock: '99' }),
    ])).toBeNull();
  });
});

describe('building upserts', () => {
  it('saves a row that never had adjustment or giveaway fields with none', () => {
    const bare: ClosingStockRowData = { product: product(), previousStock: '10', addedToday: '2', closingStock: '9', soldQuantity: '3' };

    expect(buildClosingStockUpserts({ date: '2026-11-13', rows: [bare], createdBy: 'user-1', updatedAt: '2026-11-13T10:00:00.000Z' })).toEqual({
      upserts: [{
        date: '2026-11-13',
        product_id: 'cola',
        previous_stock: 10,
        added_today: 2,
        adjustment_quantity: 0,
        adjustment_reason: null,
        giveaway_quantity: 0,
        promotion_id: null,
        closing_stock: 9,
        sold_quantity: 3, // 10 + 2 − 9
        sale_price: 15_000,
        cost_price: 9_000,
        bar_income: 45_000, // 3 × 15 000
        bar_cost: 27_000, // 3 × 9 000
        bar_profit: 18_000,
        created_by: 'user-1',
        updated_at: '2026-11-13T10:00:00.000Z',
      }],
      savedClosings: { cola: 9 },
    });
  });

  it('charges a write-off to bar cost without income and trims its reason', () => {
    const written = row({ adjustmentQuantity: '-2', adjustmentReason: '  shortage: broken  ', closingStock: '5', soldQuantity: '3' });
    const { upserts } = buildClosingStockUpserts({ date: '2026-11-13', rows: [written], createdBy: null, updatedAt: 'now' });

    expect(upserts[0]).toMatchObject({
      adjustment_quantity: -2,
      adjustment_reason: 'shortage: broken',
      closing_stock: 5,
      sold_quantity: 3, // 10 − 2 written off − 5 left
      bar_income: 45_000,
      bar_cost: 45_000, // (3 sold + 2 written off) × 9 000
      bar_profit: 0,
      created_by: null,
    });
  });
});

describe('typed number guards', () => {
  it('accepts only digits (or nothing yet) for a count', () => {
    for (const value of ['', '0', '12', '007']) expect(isWholeNumberInput(value)).toBe(true);
    for (const value of ['-1', '1.5', '1,5', ' 1', '1 ', 'abc', '1e3', '+2']) expect(isWholeNumberInput(value)).toBe(false);
  });
});

describe('whole-number input cap', () => {
  it('rejects quantities longer than six digits', () => {
    expect(isWholeNumberInput('999999')).toBe(true);
    expect(isWholeNumberInput('1000000')).toBe(false);
  });
});
