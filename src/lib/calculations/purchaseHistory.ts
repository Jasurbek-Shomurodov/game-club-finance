import { PAYMENT_METHODS, type EntryPaymentMethod } from '@/types';
import { isoDateParam, monthRange } from '@/lib/utils';

/**
 * Filters and spending totals for the Bar page's purchase history. The page
 * applies the filters in its club-scoped queries; these helpers only decide
 * what the filters mean, how they live in the URL and how rows add up.
 */

export const PURCHASE_PERIODS = ['all', 'day', 'month', 'range'] as const;
export type PurchasePeriod = typeof PURCHASE_PERIODS[number];

/** Category filter value for products that have no category. */
export const NO_CATEGORY = '__none__';

export interface PurchaseHistoryFilters {
  period: PurchasePeriod;
  /** YYYY-MM-DD for the 'day' period. */
  day: string;
  /** YYYY-MM for the 'month' period. */
  month: string;
  /** YYYY-MM-DD bounds for the 'range' period, from <= to. */
  from: string;
  to: string;
  /** A product category, NO_CATEGORY, or '' for every category. */
  category: string;
  /** A product name (every product of that name, archived copies too), or '' for every product. */
  product: string;
  /** A payment method, or '' for every method. */
  paymentMethod: EntryPaymentMethod | '';
}

interface SearchParamReader {
  get(name: string): string | null;
}

/** URL parameter names; `product`/`quantity` already prefill the purchase form. */
export const PURCHASE_FILTER_PARAMS = {
  period: 'period',
  day: 'day',
  month: 'month',
  from: 'from',
  to: 'to',
  category: 'category',
  product: 'item',
  paymentMethod: 'pay',
} as const;

function yearMonthParam(value: string | null): string | null {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return null;
  return value;
}

/** Filters with no restriction, with the day and month pickers on the business day. */
export function defaultPurchaseFilters(businessToday: string): PurchaseHistoryFilters {
  return {
    period: 'all',
    day: businessToday,
    month: businessToday.slice(0, 7),
    from: monthRange(businessToday.slice(0, 7)).from,
    to: businessToday,
    category: '',
    product: '',
    paymentMethod: '',
  };
}

/** Reads filters from the URL, dropping values that are malformed or not enabled for the club. */
export function purchaseFiltersFromParams(
  params: SearchParamReader,
  businessToday: string,
  enabledMethods: readonly EntryPaymentMethod[],
): PurchaseHistoryFilters {
  const defaults = defaultPurchaseFilters(businessToday);
  const names = PURCHASE_FILTER_PARAMS;
  const period = PURCHASE_PERIODS.find((value) => value === params.get(names.period)) ?? defaults.period;
  const from = isoDateParam(params.get(names.from));
  const to = isoDateParam(params.get(names.to));
  const method = params.get(names.paymentMethod);
  const range = from && to
    ? (from <= to ? { from, to } : { from: to, to: from })
    : { from: from ?? defaults.from, to: to ?? defaults.to };
  return {
    period,
    day: isoDateParam(params.get(names.day)) ?? defaults.day,
    month: yearMonthParam(params.get(names.month)) ?? defaults.month,
    from: range.from <= range.to ? range.from : range.to,
    to: range.from <= range.to ? range.to : range.from,
    category: params.get(names.category)?.trim() ?? '',
    product: params.get(names.product)?.trim() ?? '',
    paymentMethod: enabledMethods.find((value) => value === method) ?? '',
  };
}

/**
 * Writes the filters onto a copy of `base`, keeping its other parameters.
 * Only the active period's dates are written, and empty filters are removed.
 */
export function purchaseFiltersToParams(filters: PurchaseHistoryFilters, base: URLSearchParams | string = ''): URLSearchParams {
  const params = new URLSearchParams(base);
  const names = PURCHASE_FILTER_PARAMS;
  Object.values(names).forEach((name) => params.delete(name));
  if (filters.period !== 'all') params.set(names.period, filters.period);
  if (filters.period === 'day') params.set(names.day, filters.day);
  if (filters.period === 'month') params.set(names.month, filters.month);
  if (filters.period === 'range') {
    params.set(names.from, filters.from);
    params.set(names.to, filters.to);
  }
  if (filters.category) params.set(names.category, filters.category);
  if (filters.product) params.set(names.product, filters.product);
  if (filters.paymentMethod) params.set(names.paymentMethod, filters.paymentMethod);
  return params;
}

/** The inclusive date bounds the filters select, or null for all time. */
export function purchaseDateBounds(filters: PurchaseHistoryFilters): { from: string; to: string } | null {
  switch (filters.period) {
    case 'day': return { from: filters.day, to: filters.day };
    case 'month': return monthRange(filters.month);
    case 'range': return filters.from <= filters.to
      ? { from: filters.from, to: filters.to }
      : { from: filters.to, to: filters.from };
    default: return null;
  }
}

/** True when anything narrows the list beyond "every purchase". */
export function hasActivePurchaseFilters(filters: PurchaseHistoryFilters): boolean {
  return filters.period !== 'all' || Boolean(filters.category || filters.product || filters.paymentMethod);
}

export interface PurchaseFilterProduct {
  id: string;
  name: string;
  category: string | null;
}

function categoryOf(product: Pick<PurchaseFilterProduct, 'category'>): string {
  return product.category?.trim() || NO_CATEGORY;
}

/** Distinct categories in name order, with NO_CATEGORY last when any product lacks one. */
export function purchaseCategories(products: readonly PurchaseFilterProduct[]): string[] {
  const named = new Set<string>();
  let uncategorized = false;
  for (const product of products) {
    const category = categoryOf(product);
    if (category === NO_CATEGORY) uncategorized = true;
    else named.add(category);
  }
  const sorted = [...named].sort((a, b) => a.localeCompare(b));
  return uncategorized ? [...sorted, NO_CATEGORY] : sorted;
}

/** Product names the product picker offers: those in the chosen category, once each, by name. */
export function productNamesInCategory(products: readonly PurchaseFilterProduct[], category: string): string[] {
  const names = new Set(products
    .filter((product) => !category || categoryOf(product) === category)
    .map((product) => product.name.trim()));
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * The product ids a purchase must have, or null when products do not narrow
 * the list. An empty array means no purchase can match.
 */
export function purchaseProductIds(
  products: readonly PurchaseFilterProduct[],
  filters: Pick<PurchaseHistoryFilters, 'category' | 'product'>,
): string[] | null {
  if (!filters.category && !filters.product) return null;
  return products
    .filter((product) => !filters.category || categoryOf(product) === filters.category)
    .filter((product) => !filters.product || product.name.trim() === filters.product)
    .map((product) => product.id);
}

/** The payment methods a purchase must have, or null when any method matches. */
export function purchasePaymentMethods(filters: Pick<PurchaseHistoryFilters, 'paymentMethod'>): EntryPaymentMethod[] | null {
  return filters.paymentMethod && PAYMENT_METHODS.includes(filters.paymentMethod) ? [filters.paymentMethod] : null;
}

export interface PurchaseSpendingRow {
  date: string;
  quantity: number;
  cost_price: number;
}

export interface PurchaseSpendingGroup {
  /** YYYY-MM-DD for a day, YYYY-MM for a month. */
  key: string;
  total: number;
  quantity: number;
  count: number;
}

export interface PurchaseSpendingSummary {
  total: number;
  quantity: number;
  count: number;
  /** Newest first. */
  byDay: PurchaseSpendingGroup[];
  /** Newest first. */
  byMonth: PurchaseSpendingGroup[];
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addTo(groups: Map<string, PurchaseSpendingGroup>, key: string, total: number, quantity: number) {
  const group = groups.get(key) ?? { key, total: 0, quantity: 0, count: 0 };
  group.total += total;
  group.quantity += quantity;
  group.count += 1;
  groups.set(key, group);
}

function newestFirst(groups: Map<string, PurchaseSpendingGroup>): PurchaseSpendingGroup[] {
  return [...groups.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

/** What the rows cost in all, per business date and per month (quantity × unit cost). */
export function summarizePurchaseSpending(rows: readonly PurchaseSpendingRow[]): PurchaseSpendingSummary {
  const days = new Map<string, PurchaseSpendingGroup>();
  const months = new Map<string, PurchaseSpendingGroup>();
  let total = 0;
  let quantity = 0;
  for (const row of rows) {
    const rowQuantity = numeric(row.quantity);
    const rowTotal = rowQuantity * numeric(row.cost_price);
    total += rowTotal;
    quantity += rowQuantity;
    addTo(days, row.date, rowTotal, rowQuantity);
    addTo(months, row.date.slice(0, 7), rowTotal, rowQuantity);
  }
  return { total, quantity, count: rows.length, byDay: newestFirst(days), byMonth: newestFirst(months) };
}
