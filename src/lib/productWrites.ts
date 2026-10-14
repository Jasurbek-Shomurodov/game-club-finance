import { formatUnitCurrency, parseCurrencyInput } from './formatters';
import { LOW_STOCK_DEFAULT } from './calculations/stock';

export interface ProductWriteForm {
  name: string;
  category: string;
  sale_price: string;
  cost_price: string;
  current_stock: string;
  low_stock_threshold: string;
  tracks_inventory: boolean;
  is_active: boolean;
}

/**
 * A money value prefilled into a whole-UZS input. Weighted-average costs can
 * be fractional (2108.42); the input shows them exactly, and an untouched
 * input keeps the exact stored value instead of the rounded parsed digits.
 */
export interface PrefilledAmount {
  input: string;
  value: number;
}

export function prefillAmount(value: number | string | null | undefined): PrefilledAmount | null {
  const amount = Number(value);
  if (value === null || value === undefined || value === '' || !Number.isFinite(amount)) return null;
  return { input: formatUnitCurrency(amount), value: amount };
}

/** True once the user has typed over a prefilled value (or there was none). */
export function isPrefilledAmountEdited(input: string, prefill: PrefilledAmount | null | undefined): boolean {
  return !prefill || input !== prefill.input;
}

/** The exact prefilled amount while untouched, otherwise the parsed input. */
export function resolvePrefilledAmount(input: string, prefill: PrefilledAmount | null | undefined): number {
  return isPrefilledAmountEdited(input, prefill) ? parseCurrencyInput(input) : prefill!.value;
}

export interface ProductWriteOptions {
  isOwner: boolean;
  updatedAt?: string;
  /**
   * The cost price loaded into an edit form. When the owner leaves the field
   * untouched, the update omits cost_price so the stored weighted average is
   * neither rounded nor overwritten by a stale page copy.
   */
  loadedCostPrice?: PrefilledAmount | null;
}

/** Blank or invalid input uses the default; an explicit 0 disables low-stock alerts. */
export function parseLowStockThreshold(value: string): number {
  const trimmed = String(value ?? '').trim();
  if (trimmed === '') return LOW_STOCK_DEFAULT;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : LOW_STOCK_DEFAULT;
}

export type ProductFormValidationCode = 'name_required' | 'sale_price_required';

/**
 * Every catalog product is sold through Closing Stock, so an active product
 * needs a positive sale price; a blank price would silently record zero bar
 * income. Inactive products may keep a zero price.
 */
export function validateProductForm(form: ProductWriteForm): ProductFormValidationCode | null {
  if (!form.name.trim()) return 'name_required';
  if (form.is_active && parseCurrencyInput(form.sale_price) <= 0) return 'sale_price_required';
  return null;
}

export function buildProductUpdatePayload(form: ProductWriteForm, options: ProductWriteOptions) {
  return {
    name: form.name.trim(),
    category: form.category.trim() || null,
    sale_price: parseCurrencyInput(form.sale_price),
    ...(options.isOwner && isPrefilledAmountEdited(form.cost_price, options.loadedCostPrice)
      ? { cost_price: parseCurrencyInput(form.cost_price) }
      : {}),
    low_stock_threshold: parseLowStockThreshold(form.low_stock_threshold),
    is_active: form.is_active,
    updated_at: options.updatedAt ?? new Date().toISOString(),
  };
}

export function buildProductInsertPayload(form: ProductWriteForm, options: ProductWriteOptions) {
  return {
    ...buildProductUpdatePayload(form, options),
    ...(options.isOwner ? {
      tracks_inventory: form.tracks_inventory,
      current_stock: form.tracks_inventory
        ? Math.max(0, Math.trunc(parseFloat(form.current_stock) || 0))
        : 0,
    } : {}),
  };
}

export interface ProductSortOrderWrite {
  id: string;
  sort_order: number;
}

/**
 * Plans moving one product a step up or down the catalog. With distinct saved
 * positions only the two neighbours swap (two writes); missing or duplicate
 * positions (older rows) are normalized once to their list positions.
 */
export function planProductReorder(
  products: ReadonlyArray<{ id: string; sort_order?: number | null }>,
  currentIndex: number,
  targetIndex: number,
): { order: string[]; writes: ProductSortOrderWrite[] } | null {
  if (currentIndex < 0 || targetIndex < 0 || currentIndex >= products.length || targetIndex >= products.length) {
    return null;
  }

  const order = products.map((product) => product.id);
  const [moved] = order.splice(currentIndex, 1);
  order.splice(targetIndex, 0, moved);

  const positions = products.map((product) => product.sort_order);
  const distinct = positions.every((position) => typeof position === 'number')
    && new Set(positions).size === positions.length;
  if (distinct) {
    const current = products[currentIndex];
    const target = products[targetIndex];
    return {
      order,
      writes: [
        { id: current.id, sort_order: target.sort_order as number },
        { id: target.id, sort_order: current.sort_order as number },
      ],
    };
  }

  const byId = new Map(products.map((product) => [product.id, product.sort_order]));
  return {
    order,
    writes: order.flatMap((id, index) => (byId.get(id) === index + 1 ? [] : [{ id, sort_order: index + 1 }])),
  };
}
