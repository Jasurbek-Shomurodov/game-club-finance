import type { Promotion } from '@/types';
import { parseCurrencyInput } from './formatters';

export interface PromotionForm {
  name: string;
  product_id: string;
  free_quantity: string;
  min_spend: string;
  starts_on: string;
  ends_on: string;
  is_active: boolean;
}

export type PromotionFormError =
  | 'name_required'
  | 'product_required'
  | 'free_quantity_invalid'
  | 'min_spend_invalid'
  | 'starts_on_required'
  | 'period_invalid';

export function validatePromotionForm(form: PromotionForm): PromotionFormError | null {
  if (!form.name.trim()) return 'name_required';
  if (!form.product_id) return 'product_required';
  const freeQuantity = Number(form.free_quantity);
  if (!Number.isInteger(freeQuantity) || freeQuantity <= 0) return 'free_quantity_invalid';
  const minSpend = parseCurrencyInput(form.min_spend);
  if (!Number.isFinite(minSpend) || minSpend < 0) return 'min_spend_invalid';
  if (!form.starts_on) return 'starts_on_required';
  if (form.ends_on && form.ends_on < form.starts_on) return 'period_invalid';
  return null;
}

/** Validated form → columns written to `promotions` (club_id/created_by added by the caller). */
export function buildPromotionPayload(form: PromotionForm) {
  return {
    name: form.name.trim(),
    product_id: form.product_id,
    free_quantity: Number(form.free_quantity),
    min_spend: parseCurrencyInput(form.min_spend),
    starts_on: form.starts_on,
    ends_on: form.ends_on || null,
    is_active: form.is_active,
  };
}

/** Active and inside its date range on the given club business date. */
export function isPromotionActiveOn(promotion: Pick<Promotion, 'is_active' | 'starts_on' | 'ends_on'>, date: string): boolean {
  return promotion.is_active
    && promotion.starts_on <= date
    && (promotion.ends_on === null || promotion.ends_on === undefined || promotion.ends_on >= date);
}

/** Promotions a closing-stock row can pick from: active on that date for that product, name order. */
export function promotionsForProduct(promotions: Promotion[], productId: string, date: string): Promotion[] {
  return promotions
    .filter((promotion) => promotion.product_id === productId && isPromotionActiveOn(promotion, date))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type PromotionStatus = 'active' | 'scheduled' | 'ended' | 'inactive';

export function promotionStatus(promotion: Pick<Promotion, 'is_active' | 'starts_on' | 'ends_on'>, date: string): PromotionStatus {
  if (!promotion.is_active) return 'inactive';
  if (promotion.starts_on > date) return 'scheduled';
  if (promotion.ends_on && promotion.ends_on < date) return 'ended';
  return 'active';
}
