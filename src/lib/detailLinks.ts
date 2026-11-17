/**
 * Links a tapped figure or row opens: the page that lists the records behind it.
 * Each target page reads these query parameters; keep them in step.
 */

export interface DateRange {
  from: string;
  to: string;
}

export type MoneySide = 'game_club' | 'bar';

/** The game club's or the bar's money details (`?from&to`). */
export function moneyDetailsHref(side: MoneySide, range: DateRange): string {
  return `/${side === 'bar' ? 'bar' : 'game-club'}-money-details?${new URLSearchParams({ from: range.from, to: range.to }).toString()}`;
}

/** Reports narrowed to a period and, optionally, a category, the side that paid, or a tab. */
export function reportsHref(range: DateRange, filters: { category?: string; source?: MoneySide | null; view?: string } = {}): string {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (filters.view) params.set('view', filters.view);
  if (filters.category) params.set('category', filters.category);
  if (filters.source) params.set('source', filters.source);
  return `/reports?${params.toString()}`;
}

/** A single day as a range. */
export function dayRange(date: string): DateRange {
  return { from: date, to: date };
}

/** The closing stock count recorded on a day. */
export function closingStockHref(date: string): string {
  return `/closing-stock?date=${encodeURIComponent(date)}`;
}

/** The daily report for a day. */
export function dailyReportHref(date: string): string {
  return `/daily-report?date=${encodeURIComponent(date)}`;
}

/** The purchase form opened on a product, with the units still missing filled in. */
export function stockPurchaseHref(product: { id: string; shortfall?: number }): string {
  const params = new URLSearchParams({ product: product.id });
  if (product.shortfall && product.shortfall > 0) params.set('quantity', String(Math.ceil(product.shortfall)));
  return `/stock-purchase?${params.toString()}`;
}

/** The debts page filtered to one person; the plain page when the name is unknown. */
export function debtsSearchHref(base: string, name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? `${base}?${new URLSearchParams({ search: trimmed }).toString()}` : base;
}
