import { describe, expect, it } from 'vitest';
import {
  buildProductInsertPayload,
  buildProductUpdatePayload,
  isPrefilledAmountEdited,
  parseLowStockThreshold,
  planProductReorder,
  prefillAmount,
  resolvePrefilledAmount,
  validateProductForm,
  type ProductWriteForm,
} from './productWrites';

const form: ProductWriteForm = {
  name: ' Cola ',
  category: ' Drinks ',
  sale_price: '15 000',
  cost_price: '9 000',
  current_stock: '42',
  low_stock_threshold: '5',
  tracks_inventory: true,
  is_active: true,
};

describe('product write payloads', () => {
  it('never includes ledger-controlled fields in an existing product update', () => {
    const payload = buildProductUpdatePayload(form, {
      isOwner: true,
      updatedAt: '2026-08-27T00:00:00.000Z',
    });

    expect(payload).toEqual({
      name: 'Cola',
      category: 'Drinks',
      sale_price: 15_000,
      cost_price: 9_000,
      low_stock_threshold: 5,
      is_active: true,
      updated_at: '2026-08-27T00:00:00.000Z',
    });
    expect(payload).not.toHaveProperty('current_stock');
    expect(payload).not.toHaveProperty('tracks_inventory');
  });

  it('allows an owner to choose opening stock and tracking mode at creation', () => {
    expect(buildProductInsertPayload(form, {
      isOwner: true,
      updatedAt: '2026-08-27T00:00:00.000Z',
    })).toMatchObject({
      current_stock: 42,
      tracks_inventory: true,
    });
  });

  it('forces made-to-order opening stock to zero at creation', () => {
    expect(buildProductInsertPayload({ ...form, tracks_inventory: false }, {
      isOwner: true,
      updatedAt: '2026-08-27T00:00:00.000Z',
    })).toMatchObject({
      current_stock: 0,
      tracks_inventory: false,
    });
  });
});


it('omits cost price from admin catalog updates and inserts even if a changed value is submitted', () => {
  expect(buildProductUpdatePayload(form, { isOwner: false })).not.toHaveProperty('cost_price');
  expect(buildProductInsertPayload(form, { isOwner: false })).not.toHaveProperty('cost_price');
});

describe('low stock threshold', () => {
  it('preserves an explicit zero and defaults only a blank value', () => {
    expect(buildProductUpdatePayload({ ...form, low_stock_threshold: '0' }, { isOwner: true }).low_stock_threshold).toBe(0);
    expect(buildProductUpdatePayload({ ...form, low_stock_threshold: '' }, { isOwner: true }).low_stock_threshold).toBe(5);
    expect(parseLowStockThreshold('12')).toBe(12);
    expect(parseLowStockThreshold('abc')).toBe(5);
  });
});

describe('validateProductForm', () => {
  it('requires a name and a positive sale price for active products', () => {
    expect(validateProductForm(form)).toBeNull();
    expect(validateProductForm({ ...form, name: '  ' })).toBe('name_required');
    expect(validateProductForm({ ...form, sale_price: '' })).toBe('sale_price_required');
    expect(validateProductForm({ ...form, sale_price: '0' })).toBe('sale_price_required');
  });

  it('lets an inactive product keep a zero sale price', () => {
    expect(validateProductForm({ ...form, sale_price: '', is_active: false })).toBeNull();
  });
});

describe('loaded cost price', () => {
  it('omits an untouched fractional cost so the stored average is not rounded', () => {
    const loadedCostPrice = prefillAmount(2108.42);
    expect(loadedCostPrice).toEqual({ input: '2 108,42', value: 2108.42 });
    const payload = buildProductUpdatePayload(
      { ...form, cost_price: loadedCostPrice!.input },
      { isOwner: true, loadedCostPrice },
    );
    expect(payload).not.toHaveProperty('cost_price');
  });

  it('writes the cost once the owner edits it', () => {
    const loadedCostPrice = prefillAmount(2108.42);
    expect(buildProductUpdatePayload(
      { ...form, cost_price: '2 200' },
      { isOwner: true, loadedCostPrice },
    )).toMatchObject({ cost_price: 2200 });
  });

  it('resolves an untouched prefill to its exact value and an edit to the parsed input', () => {
    const prefill = prefillAmount(5833.33);
    expect(resolvePrefilledAmount(prefill!.input, prefill)).toBe(5833.33);
    expect(resolvePrefilledAmount('6 000', prefill)).toBe(6000);
    expect(resolvePrefilledAmount('6 000', null)).toBe(6000);
    expect(isPrefilledAmountEdited(prefill!.input, prefill)).toBe(false);
    expect(prefillAmount(null)).toBeNull();
  });
});

describe('planProductReorder', () => {
  it('swaps only the two neighbours when positions are distinct, even after a gap', () => {
    const products = [
      { id: 'a', sort_order: 1 },
      { id: 'b', sort_order: 5 },
      { id: 'c', sort_order: 9 },
      { id: 'd', sort_order: 12 },
    ];
    expect(planProductReorder(products, 1, 2)).toEqual({
      order: ['a', 'c', 'b', 'd'],
      writes: [{ id: 'b', sort_order: 9 }, { id: 'c', sort_order: 5 }],
    });
  });

  it('normalizes missing or duplicate positions once', () => {
    expect(planProductReorder([
      { id: 'a', sort_order: null },
      { id: 'b', sort_order: 2 },
      { id: 'c', sort_order: 2 },
    ], 2, 1)).toEqual({
      order: ['a', 'c', 'b'],
      writes: [{ id: 'a', sort_order: 1 }, { id: 'b', sort_order: 3 }],
    });
  });

  it('rejects out-of-range moves', () => {
    expect(planProductReorder([{ id: 'a', sort_order: 1 }], 0, 1)).toBeNull();
  });
});
