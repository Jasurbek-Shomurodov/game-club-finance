export interface StockCountInput {
  previousStock: number;
  addedToday: number;
  adjustmentQuantity?: number;
  /** Units given away free under a promotion; they leave stock unsold. */
  giveawayQuantity?: number;
  closingStock: number;
  salePrice: number;
  costPrice: number;
}

/**
 * Giveaways carry no income. Their cost is part of `barCost` (cost of goods
 * that left stock) and repeated in `giveawayCost` for reporting.
 */
export interface StockCountResult {
  soldQuantity: number;
  giveawayQuantity: number;
  giveawayCost: number;
  barIncome: number;
  barCost: number;
  barProfit: number;
}

export interface StockCountPurchaseDeltaInput extends StockCountInput {
  quantityDelta: number;
}

export interface StockCountPurchaseDeltaResult extends StockCountResult {
  addedToday: number;
  closingStock: number;
}

export interface AverageCostInput {
  currentStock: number;
  currentCostPrice: number;
  purchasedQuantity: number;
  purchaseCostPrice: number;
}

export interface ClosingStockDefaultsInput {
  currentStock: number;
  purchasedToday: number;
}

export interface ClosingStockDefaults {
  previousStock: number;
  addedToday: number;
  closingStock: number;
}

export interface FutureStockCountInput {
  date: string;
  added_today: number;
  adjustment_quantity?: number;
  giveaway_quantity?: number;
  closing_stock: number;
  sale_price: number;
  cost_price: number;
}

export interface RecalculatedFutureStockCount extends FutureStockCountInput {
  previous_stock: number;
  sold_quantity: number;
  bar_income: number;
  bar_cost: number;
  bar_profit: number;
}

export interface StockAvailability {
  availableStock: number;
  excessClosingStock: number;
  isValid: boolean;
}

export function isWholePositiveStockQuantity(value: number): boolean {
  return Number.isFinite(value) && value > 0 && Number.isInteger(value);
}

export function calculateAvailableStock(
  previousStock: number,
  addedToday: number,
  adjustmentQuantity = 0,
): number {
  return previousStock + addedToday + adjustmentQuantity;
}

export function normalizeGiveawayQuantity(value: number | undefined): number {
  return Math.max(0, Math.trunc(value ?? 0)) || 0;
}

export function validateStockAvailability(
  previousStock: number,
  addedToday: number,
  closingStock: number,
  adjustmentQuantity = 0,
  giveawayQuantity = 0,
): StockAvailability {
  const availableStock = calculateAvailableStock(previousStock, addedToday, adjustmentQuantity);
  const excessClosingStock = Math.max(0, closingStock + normalizeGiveawayQuantity(giveawayQuantity) - availableStock);

  return {
    availableStock,
    excessClosingStock,
    isValid: availableStock >= 0 && excessClosingStock === 0,
  };
}

export function calculateSoldQuantity(
  previousStock: number,
  addedToday: number,
  closingStock: number,
  adjustmentQuantity = 0,
  giveawayQuantity = 0,
): number {
  return Math.max(0, calculateAvailableStock(previousStock, addedToday, adjustmentQuantity)
    - normalizeGiveawayQuantity(giveawayQuantity) - closingStock);
}

export function calculateClosingStockFromSold(
  previousStock: number,
  addedToday: number,
  soldQuantity: number,
  adjustmentQuantity = 0,
  giveawayQuantity = 0,
): number {
  return Math.max(0, calculateAvailableStock(previousStock, addedToday, adjustmentQuantity)
    - normalizeGiveawayQuantity(giveawayQuantity) - soldQuantity);
}

export function calculateBarIncome(soldQuantity: number, salePrice: number): number {
  return soldQuantity * salePrice;
}

/** Cost of every unit that left stock: sold plus given away. */
export function calculateBarCost(soldQuantity: number, costPrice: number, giveawayQuantity = 0): number {
  return (soldQuantity + normalizeGiveawayQuantity(giveawayQuantity)) * costPrice;
}

export function calculateGiveawayCost(giveawayQuantity: number, costPrice: number): number {
  return normalizeGiveawayQuantity(giveawayQuantity) * costPrice;
}

export function calculateBarProfit(barIncome: number, barCost: number): number {
  return barIncome - barCost;
}

export function calculateDirectSalesSummary(
  soldQuantity: number,
  salePrice: number,
  costPrice: number,
  giveawayQuantity = 0,
): StockCountResult {
  const normalizedSoldQuantity = Math.max(0, soldQuantity);
  const normalizedGiveawayQuantity = normalizeGiveawayQuantity(giveawayQuantity);
  const barIncome = calculateBarIncome(normalizedSoldQuantity, salePrice);
  const barCost = calculateBarCost(normalizedSoldQuantity, costPrice, normalizedGiveawayQuantity);

  return {
    soldQuantity: normalizedSoldQuantity,
    giveawayQuantity: normalizedGiveawayQuantity,
    giveawayCost: calculateGiveawayCost(normalizedGiveawayQuantity, costPrice),
    barIncome,
    barCost,
    barProfit: calculateBarProfit(barIncome, barCost),
  };
}

export function calculateStockCountSummary(input: StockCountInput): StockCountResult {
  const soldQuantity = calculateSoldQuantity(
    input.previousStock,
    input.addedToday,
    input.closingStock,
    input.adjustmentQuantity,
    input.giveawayQuantity,
  );
  return calculateDirectSalesSummary(soldQuantity, input.salePrice, input.costPrice, input.giveawayQuantity);
}

export function applyPurchaseDeltaToStockCount(input: StockCountPurchaseDeltaInput): StockCountPurchaseDeltaResult {
  const addedToday = Math.max(0, input.addedToday + input.quantityDelta);
  const closingStock = Math.max(0, input.closingStock + input.quantityDelta);
  const summary = calculateStockCountSummary({
    previousStock: input.previousStock,
    addedToday,
    adjustmentQuantity: input.adjustmentQuantity,
    giveawayQuantity: input.giveawayQuantity,
    closingStock,
    salePrice: input.salePrice,
    costPrice: input.costPrice,
  });

  return {
    addedToday,
    closingStock,
    ...summary,
  };
}

export function calculateWeightedAverageCost(input: AverageCostInput): number {
  const currentStock = Math.max(0, input.currentStock);
  const purchasedQuantity = Math.max(0, input.purchasedQuantity);
  const totalQuantity = currentStock + purchasedQuantity;

  if (totalQuantity === 0) return 0;
  if (currentStock === 0) return input.purchaseCostPrice;
  if (purchasedQuantity === 0) return input.currentCostPrice;

  return (
    (currentStock * input.currentCostPrice) +
    (purchasedQuantity * input.purchaseCostPrice)
  ) / totalQuantity;
}

export function calculateClosingStockDefaults(input: ClosingStockDefaultsInput): ClosingStockDefaults {
  const currentStock = Math.max(0, input.currentStock);
  const addedToday = Math.max(0, input.purchasedToday);

  return {
    previousStock: Math.max(0, currentStock - addedToday),
    addedToday,
    closingStock: currentStock,
  };
}

export function recalculateFutureStockCounts(
  startingClosingStock: number,
  rows: FutureStockCountInput[],
): RecalculatedFutureStockCount[] {
  let previousStock = startingClosingStock;

  return [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => {
      const summary = calculateStockCountSummary({
        previousStock,
        addedToday: row.added_today,
        adjustmentQuantity: row.adjustment_quantity,
        giveawayQuantity: row.giveaway_quantity,
        closingStock: row.closing_stock,
        salePrice: row.sale_price,
        costPrice: row.cost_price,
      });

      const recalculated = {
        ...row,
        previous_stock: previousStock,
        sold_quantity: summary.soldQuantity,
        bar_income: summary.barIncome,
        bar_cost: summary.barCost,
        bar_profit: summary.barProfit,
      };

      previousStock = row.closing_stock;
      return recalculated;
    });
}

export interface DatedStockClosing {
  product_id: string;
  date: string;
  closing_stock: number;
}

export interface DatedStockPurchase {
  product_id: string;
  date: string;
  quantity: number;
  cost_price: number;
}

/** Purchases on the closing date are already represented in its saved balance. */
export function calculateStockOpeningBalances(
  counts: DatedStockClosing[],
  purchases: DatedStockPurchase[],
  selectedDate: string,
  isCurrentDate: boolean,
): Record<string, number> {
  const latest = new Map<string, DatedStockClosing>();
  for (const count of counts) {
    if (count.date >= selectedDate) continue;
    const previous = latest.get(count.product_id);
    if (!previous || count.date > previous.date) latest.set(count.product_id, count);
  }
  const balances = Object.fromEntries(
    [...latest].map(([id, count]) => [id, Number(count.closing_stock)]),
  );
  for (const purchase of purchases) {
    const previous = latest.get(purchase.product_id);
    if (purchase.date >= selectedDate || (previous && purchase.date <= previous.date)) continue;
    // Without a first closing, today's opening derives from live stock. For
    // historical dates use only the ledger up to that date, never future stock.
    if (!previous && isCurrentDate) continue;
    balances[purchase.product_id] = (balances[purchase.product_id] ?? 0) + Number(purchase.quantity);
  }
  return balances;
}

/** Threshold used when a product has no explicit low-stock threshold. */
export const LOW_STOCK_DEFAULT = 5;

export type StockLevel = 'out' | 'low' | 'ok';

export function resolveLowStockThreshold(threshold: number | null | undefined): number {
  return threshold === null || threshold === undefined || !Number.isFinite(Number(threshold))
    ? LOW_STOCK_DEFAULT
    : Number(threshold);
}

/** A tracked product with some stock left at or below its threshold. */
export function isLowStock(currentStock: number, threshold: number | null | undefined): boolean {
  return currentStock > 0 && currentStock <= resolveLowStockThreshold(threshold);
}

export function stockLevel(currentStock: number, threshold: number | null | undefined): StockLevel {
  if (currentStock <= 0) return 'out';
  return isLowStock(currentStock, threshold) ? 'low' : 'ok';
}

export interface LowStockProductInput {
  name: string;
  current_stock: number | string | null;
  low_stock_threshold: number | string | null;
  tracks_inventory?: boolean | null;
  is_active?: boolean | null;
  is_deleted?: boolean | null;
}

export interface LowStockProduct {
  name: string;
  currentStock: number;
  threshold: number;
  level: Exclude<StockLevel, 'ok'>;
}

/**
 * Active, tracked products that are out of stock or at/below their threshold.
 * Out-of-stock items come first, then the lowest remaining stock.
 */
export function listLowStockProducts(products: LowStockProductInput[]): LowStockProduct[] {
  return products
    .filter((product) => product.is_active !== false && product.is_deleted !== true && product.tracks_inventory !== false)
    .map((product) => {
      const currentStock = Number(product.current_stock ?? 0) || 0;
      const threshold = resolveLowStockThreshold(product.low_stock_threshold === null ? null : Number(product.low_stock_threshold));
      return { name: product.name, currentStock, threshold, level: stockLevel(currentStock, threshold) };
    })
    .filter((product): product is LowStockProduct => product.level !== 'ok')
    .sort((a, b) => a.currentStock - b.currentStock || a.name.localeCompare(b.name, 'ru'));
}

export interface StockTotalsRowInput {
  tracksInventory: boolean;
  previousStock: number;
  addedToday: number;
  adjustmentQuantity?: number;
  giveawayQuantity?: number;
  closingStock: number;
  /** Direct sold quantity; used only for made-to-order products. */
  soldQuantity: number;
  salePrice: number;
  costPrice: number;
  /** Cost of the selected date's purchase receipts for this product. */
  purchaseCost?: number;
}

export interface StockTotals {
  sold: number;
  giveaways: number;
  giveawayCost: number;
  income: number;
  profit: number;
  stockValue: number;
  previous: number;
  added: number;
  purchaseCost: number;
}

/** Per-row sold quantity, income, cost and profit using the canonical formulas. */
export function summarizeStockRow(row: StockTotalsRowInput): StockCountResult {
  if (!row.tracksInventory) {
    return calculateDirectSalesSummary(row.soldQuantity, row.salePrice, row.costPrice, row.giveawayQuantity);
  }

  return calculateStockCountSummary({
    previousStock: row.previousStock,
    addedToday: row.addedToday,
    adjustmentQuantity: row.adjustmentQuantity,
    giveawayQuantity: row.giveawayQuantity,
    closingStock: row.closingStock,
    salePrice: row.salePrice,
    costPrice: row.costPrice,
  });
}

/**
 * Closing-stock totals. Made-to-order products contribute sales but no stock
 * quantities, stock value or purchase cost.
 */
export function summarizeStockRows(rows: StockTotalsRowInput[]): StockTotals {
  return rows.reduce<StockTotals>(
    (acc, row) => {
      const summary = summarizeStockRow(row);
      acc.sold += summary.soldQuantity;
      acc.giveaways += summary.giveawayQuantity;
      acc.giveawayCost += summary.giveawayCost;
      acc.income += summary.barIncome;
      acc.profit += summary.barProfit;
      if (row.tracksInventory) {
        acc.stockValue += row.closingStock * row.costPrice;
        acc.previous += row.previousStock;
        acc.added += row.addedToday;
        acc.purchaseCost += row.purchaseCost ?? 0;
      }
      return acc;
    },
    { sold: 0, giveaways: 0, giveawayCost: 0, income: 0, profit: 0, stockValue: 0, previous: 0, added: 0, purchaseCost: 0 },
  );
}
