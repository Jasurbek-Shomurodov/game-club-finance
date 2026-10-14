import { describe, expect, it } from 'vitest';
import type { Promotion } from '@/types';
import {
  buildPromotionPayload,
  isPromotionActiveOn,
  promotionStatus,
  promotionsForProduct,
  validatePromotionForm,
  type PromotionForm,
} from './promotions';

const form = (overrides: Partial<PromotionForm> = {}): PromotionForm => ({
  name: 'Coke for 50k',
  product_id: 'cola',
  free_quantity: '1',
  min_spend: '50 000',
  starts_on: '2026-10-01',
  ends_on: '',
  is_active: true,
  ...overrides,
});

const promo = (overrides: Partial<Promotion> = {}): Promotion => ({
  id: 'p1', club_id: 'c1', product_id: 'cola', name: 'Coke for 50k', free_quantity: 1, min_spend: 50_000,
  starts_on: '2026-10-01', ends_on: null, is_active: true, created_by: null, created_at: '', updated_at: '',
  ...overrides,
});

describe('promotion forms', () => {
  it('validates every field and parses formatted money', () => {
    expect(validatePromotionForm(form())).toBeNull();
    expect(validatePromotionForm(form({ name: '  ' }))).toBe('name_required');
    expect(validatePromotionForm(form({ product_id: '' }))).toBe('product_required');
    expect(validatePromotionForm(form({ free_quantity: '0' }))).toBe('free_quantity_invalid');
    expect(validatePromotionForm(form({ free_quantity: '1.5' }))).toBe('free_quantity_invalid');
    // CurrencyInput keeps digits only, so a blank spend is simply zero.
    expect(buildPromotionPayload(form({ min_spend: '' })).min_spend).toBe(0);
    expect(validatePromotionForm(form({ starts_on: '' }))).toBe('starts_on_required');
    expect(validatePromotionForm(form({ ends_on: '2026-09-30' }))).toBe('period_invalid');
    expect(buildPromotionPayload(form({ name: ' Coke ', ends_on: '2026-12-31' }))).toEqual({
      name: 'Coke', product_id: 'cola', free_quantity: 1, min_spend: 50_000,
      starts_on: '2026-10-01', ends_on: '2026-12-31', is_active: true,
    });
    expect(buildPromotionPayload(form()).ends_on).toBeNull();
  });
});

describe('promotion dates', () => {
  it('is active only inside its period while switched on', () => {
    expect(isPromotionActiveOn(promo(), '2026-10-15')).toBe(true);
    expect(isPromotionActiveOn(promo(), '2026-09-30')).toBe(false);
    expect(isPromotionActiveOn(promo({ ends_on: '2026-10-10' }), '2026-10-10')).toBe(true);
    expect(isPromotionActiveOn(promo({ ends_on: '2026-10-10' }), '2026-10-11')).toBe(false);
    expect(isPromotionActiveOn(promo({ is_active: false }), '2026-10-15')).toBe(false);
    expect(promotionStatus(promo(), '2026-10-15')).toBe('active');
    expect(promotionStatus(promo(), '2026-09-15')).toBe('scheduled');
    expect(promotionStatus(promo({ ends_on: '2026-10-10' }), '2026-10-15')).toBe('ended');
    expect(promotionStatus(promo({ is_active: false }), '2026-10-15')).toBe('inactive');
  });

  it('lists the product’s promotions active on a date in name order', () => {
    const list = [
      promo({ id: 'b', name: 'Zeta' }),
      promo({ id: 'a', name: 'Alpha' }),
      promo({ id: 'other', product_id: 'fanta' }),
      promo({ id: 'off', is_active: false }),
    ];
    expect(promotionsForProduct(list, 'cola', '2026-10-15').map((item) => item.id)).toEqual(['a', 'b']);
    expect(promotionsForProduct(list, 'cola', '2026-01-01')).toEqual([]);
  });
});
