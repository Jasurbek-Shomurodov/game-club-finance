import { stockLevel, type StockLevel } from './stock';

/** One product's bar sales over a period, as `get_bar_product_sales` returns them. */
export interface ProductSalesRow {
  product_id: string;
  sold_quantity: number | string | null;
  bar_income: number | string | null;
  bar_cost: number | string | null;
  /** Dates in the period with a saved count for this product. */
  days_counted: number | string | null;
}

export interface ProductSalesInsight {
  sold: number;
  income: number;
  /** Sales minus the cost of the goods sold. */
  profit: number;
  /** Profit as a share of sales, in percent; null with no sales. */
  marginPercent: number | null;
  /** Units sold per counted day. */
  perDay: number;
  /**
   * Whole days the current stock lasts at that pace; null for made-to-order
   * products, products that did not sell, and periods with no counted day.
   */
  daysLeft: number | null;
}

export interface ProductSalesSummary {
  /** Days in the period on which the club saved a closing count. */
  countedDays: number;
  sold: number;
  income: number;
  profit: number;
  marginPercent: number | null;
  byProduct: Map<string, ProductSalesInsight>;
}

interface StockedProduct {
  id: string;
  current_stock: number | string | null;
  tracks_inventory?: boolean | null;
}

const amount = (value: number | string | null | undefined) => Number(value ?? 0) || 0;
const margin = (income: number, profit: number) => (income > 0 ? Math.round((profit / income) * 1000) / 10 : null);

/** The first date of a period of `days` days ending on `to` (both ISO dates). */
export function salesPeriodStart(to: string, days: number): string {
  const [year, month, day] = to.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day - (Math.max(1, days) - 1)));
  return start.toISOString().slice(0, 10);
}

/**
 * Per-product sales pace and how long the stock on hand lasts.
 *
 * The pace divides by the days the club actually counted, not the calendar
 * length of the period: a club that closed its stock on 10 of 30 days sold its
 * units on those 10 days, and dividing by 30 would promise three times the
 * runway. A product counted on fewer days than the club (added mid-period)
 * still uses the club's days, since it sold nothing on the others.
 */
export function buildProductSalesSummary(
  products: ReadonlyArray<StockedProduct>,
  rows: ReadonlyArray<ProductSalesRow>,
): ProductSalesSummary {
  const countedDays = rows.reduce((most, row) => Math.max(most, amount(row.days_counted)), 0);
  const productById = new Map(products.map((product) => [product.id, product]));
  const byProduct = new Map<string, ProductSalesInsight>();
  let sold = 0;
  let income = 0;
  let profit = 0;

  for (const row of rows) {
    const rowSold = amount(row.sold_quantity);
    const rowIncome = amount(row.bar_income);
    const rowProfit = rowIncome - amount(row.bar_cost);
    sold += rowSold;
    income += rowIncome;
    profit += rowProfit;

    const perDay = countedDays > 0 ? rowSold / countedDays : 0;
    const product = productById.get(row.product_id);
    const tracked = product ? product.tracks_inventory !== false : false;
    byProduct.set(row.product_id, {
      sold: rowSold,
      income: rowIncome,
      profit: rowProfit,
      marginPercent: margin(rowIncome, rowProfit),
      perDay,
      daysLeft: tracked && perDay > 0 ? Math.floor(Math.max(0, amount(product?.current_stock)) / perDay) : null,
    });
  }

  return { countedDays, sold, income, profit, marginPercent: margin(income, profit), byProduct };
}

/** Collapses one-row-per-day stock counts into the per-product rows the RPC returns. */
export function sumProductSalesRows(
  counts: ReadonlyArray<{ product_id: string; date: string; sold_quantity: number | string | null; bar_income: number | string | null; bar_cost: number | string | null }>,
): ProductSalesRow[] {
  const byProduct = new Map<string, { row: ProductSalesRow; dates: Set<string> }>();
  for (const count of counts) {
    let entry = byProduct.get(count.product_id);
    if (!entry) {
      entry = { row: { product_id: count.product_id, sold_quantity: 0, bar_income: 0, bar_cost: 0, days_counted: 0 }, dates: new Set() };
      byProduct.set(count.product_id, entry);
    }
    entry.row.sold_quantity = amount(entry.row.sold_quantity) + amount(count.sold_quantity);
    entry.row.bar_income = amount(entry.row.bar_income) + amount(count.bar_income);
    entry.row.bar_cost = amount(entry.row.bar_cost) + amount(count.bar_cost);
    entry.dates.add(count.date);
    entry.row.days_counted = entry.dates.size;
  }
  return [...byProduct.values()].map((entry) => entry.row);
}

export interface RestockItem {
  id: string;
  name: string;
  currentStock: number;
  level: StockLevel;
  /** Units sold in the period; null when its sales are not known. */
  sold: number | null;
  /** Units missing to cover `horizonDays` at the recent pace; 0 when the stock covers it or nothing sold. */
  shortfall: number;
  /** Whole days the stock lasts at that pace; null when it did not sell or the pace is unknown. */
  daysLeft: number | null;
}

interface RestockProduct extends StockedProduct {
  name: string;
  low_stock_threshold: number | string | null;
  is_active?: boolean | null;
  is_deleted?: boolean | null;
}

/**
 * What to buy, most urgent first: products on sale that are out of stock, at
 * or below their low-stock level, or will run out within `horizonDays` at
 * their recent pace. They are ordered by how many units are missing to cover
 * those days, so an empty shelf of a best seller comes before one of a product
 * that sold twice a month, and both before an empty shelf nobody buys from.
 * A product that was out of stock for the whole period shows no sales and so
 * ranks low: the list measures demand that was seen, not demand that was lost.
 * Without sales data (`summary` null) it is the plain low-stock list, lowest
 * stock first.
 */
export function buildRestockList(
  products: ReadonlyArray<RestockProduct>,
  summary: ProductSalesSummary | null,
  horizonDays = 7,
): RestockItem[] {
  const known = summary !== null && summary.countedDays > 0;
  const items: RestockItem[] = [];
  for (const product of products) {
    if (product.is_active === false || product.is_deleted === true || product.tracks_inventory === false) continue;
    const currentStock = amount(product.current_stock);
    const threshold = product.low_stock_threshold === null ? null : Number(product.low_stock_threshold);
    const level = stockLevel(currentStock, threshold);
    const insight = known ? summary.byProduct.get(product.id) : undefined;
    const daysLeft = insight?.daysLeft ?? null;
    if (level === 'ok' && (daysLeft === null || daysLeft > horizonDays)) continue;
    const shortfall = Math.max(0, Math.ceil((insight?.perDay ?? 0) * horizonDays - Math.max(0, currentStock)));
    items.push({ id: product.id, name: product.name, currentStock, level, sold: known ? insight?.sold ?? 0 : null, shortfall, daysLeft });
  }
  return items.sort((a, b) => (
    b.shortfall - a.shortfall
    || (b.sold ?? 0) - (a.sold ?? 0)
    || a.currentStock - b.currentStock
    || a.name.localeCompare(b.name, 'ru')
  ));
}
