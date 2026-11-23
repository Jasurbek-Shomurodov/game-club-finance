import type { MoneyCheck } from '@/lib/calculations/moneyChecks';

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

/** One employee's salary page: their months, payments and balance. */
export function employeeSalaryHref(employeeId: string): string {
  return `/salaries/employees/${encodeURIComponent(employeeId)}`;
}

/** The purchase form opened on a product, with the units still missing filled in. */
export function stockPurchaseHref(product: { id: string; shortfall?: number }): string {
  const params = new URLSearchParams({ product: product.id });
  if (product.shortfall && product.shortfall > 0) params.set('quantity', String(Math.ceil(product.shortfall)));
  return `/stock-purchase?${params.toString()}`;
}

/** Purchases recorded on one day, in the purchase history below the form. */
export function purchaseHistoryHref(day: string): string {
  return `/stock-purchase?${new URLSearchParams({ period: 'day', day }).toString()}`;
}

/** Financial Analysis for a month (`YYYY-MM`). */
export function financialAnalysisHref(month: string): string {
  return `/financial-analysis?${new URLSearchParams({ month }).toString()}`;
}

/** The owner reserve's own ledger. */
export function reserveHistoryHref(): string {
  return '/reserve?view=history';
}

/** The product list with each product's stock. */
export function productsHref(): string {
  return '/products';
}

/** Customer debts. */
export function debtsHref(): string {
  return '/debts';
}

/** Owner Profit: what the owner withdrew each month and what is left to take. */
export function ownerProfitHref(): string {
  return '/money-taken';
}

/** Cash shortages live on Owner Profit, beside the money they were taken from. */
export function cashShortagesHref(): string {
  return ownerProfitHref();
}

/**
 * Where a money check opens: the records behind it, on a page the member may
 * open; otherwise nothing. Owner Profit lists shortages only for the owner and
 * only for the current business month, so any other shortage check opens its
 * shortage expenses in Reports.
 */
export function moneyCheckHref(check: MoneyCheck, access: {
  canOpen: (path: string) => boolean;
  isOwner: boolean;
  /** The club's current business month, `YYYY-MM`. */
  businessMonth: string;
}): string | undefined {
  const expenses = (category: string) => (access.canOpen('/reports')
    ? reportsHref(check.range, { category: `expense:${category}`, source: check.side })
    : undefined);
  switch (check.kind) {
    case 'duplicate_expense':
    case 'category_spike':
      return check.category ? expenses(check.category) : undefined;
    case 'low_income_day':
      return check.date && access.canOpen('/daily-report') ? dailyReportHref(check.date) : undefined;
    case 'repeated_shortage':
      return access.isOwner && access.canOpen('/money-taken') && check.range.to.slice(0, 7) === access.businessMonth
        ? cashShortagesHref()
        : expenses('shortage');
  }
}

/** Where a money-details line opens: the closing count for bar sales and purchases, otherwise that day in Reports. */
export function moneyDetailLineHref(
  side: MoneySide,
  date: string,
  line: { kind: 'purchase' } | { kind: 'expense'; category: string } | { kind: 'reserve' } | { kind: 'collected'; key: string },
): string {
  if (line.kind === 'purchase') return closingStockHref(date);
  // Money moved into the owner reserve is listed in the reserve's own history.
  if (line.kind === 'reserve') return reserveHistoryHref();
  if (line.kind === 'expense') return reportsHref(dayRange(date), { category: `expense:${line.category}`, source: side });
  if (line.key === 'barSales') return closingStockHref(date);
  return reportsHref(dayRange(date), { category: line.key === 'debtPayments' ? 'debt_payment' : 'income' });
}
