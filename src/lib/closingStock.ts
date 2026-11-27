import type { Product } from '../types';
import { MAX_QUANTITY_INPUT_DIGITS } from './formatters';
import {
  calculateAvailableStock,
  calculateClosingStockDefaults,
  calculateClosingStockFromSold,
  calculateDirectSalesSummary,
  calculateStockCountSummary,
  validateStockAvailability,
  type StockTotalsRowInput,
} from './calculations/stock';

export interface ClosingStockRowData {
  product: Product;
  previousStock: string;
  addedToday: string;
  purchaseQuantity?: number;
  hasPurchaseMismatch?: boolean;
  adjustmentQuantity?: string;
  adjustmentReason?: string;
  /** Units given away free under a promotion (whole number as typed). */
  giveawayQuantity?: string;
  promotionId?: string | null;
  closingStock: string;
  soldQuantity: string;
}

export interface ClosingStockDraft {
  version: 1;
  date: string;
  clubId?: string;
  savedAt: string;
  rows: Array<{
    productId: string;
    previousStock: string;
    addedToday: string;
    adjustmentQuantity?: string;
    adjustmentReason?: string;
    giveawayQuantity?: string;
    promotionId?: string | null;
    closingStock: string;
    soldQuantity: string;
  }>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type ClosingStockEntryMode = 'closingStock' | 'soldQuantity';

export interface ClosingStockUpsert {
  date: string;
  product_id: string;
  previous_stock: number;
  added_today: number;
  adjustment_quantity: number;
  adjustment_reason: string | null;
  giveaway_quantity: number;
  promotion_id: string | null;
  closing_stock: number;
  sold_quantity: number;
  sale_price: number;
  cost_price: number;
  bar_income: number;
  bar_cost: number;
  bar_profit: number;
  created_by: string | null;
  updated_at: string;
}

export interface ClosingStockExistingCount {
  sale_price?: number;
  cost_price?: number;
  product_id: string;
  previous_stock?: number | string | null;
  added_today?: number | string | null;
  adjustment_quantity?: number | string | null;
  adjustment_reason?: string | null;
  giveaway_quantity?: number | string | null;
  promotion_id?: string | null;
  closing_stock?: number | string | null;
  sold_quantity?: number | string | null;
}

export interface BulkStockOrderItem {
  productId: string;
  quantity: number;
}

export interface BulkStockOrderSummary {
  totalQuantity: number;
  totalPrice: number;
}

export class BulkStockAvailabilityError extends Error {
  constructor(
    public readonly productId: string,
    public readonly productName: string,
    public readonly requestedQuantity: number,
    public readonly availableQuantity: number,
  ) {
    super(`${productName}: requested ${requestedQuantity}, but only ${availableQuantity} units are available.`);
    this.name = 'BulkStockAvailabilityError';
  }
}

export interface ClosingStockPurchaseQuantity {
  product_id: string;
  quantity: number | string | null;
  cost_price?: number | string | null;
}

export interface BuildEditableClosingStockRowsInput {
  products: Product[];
  counts: ClosingStockExistingCount[];
  purchases: ClosingStockPurchaseQuantity[];
  // Opening balances: last closing plus purchases on intervening unclosed dates.
  previousClosings: Record<string, number>;
  isCurrentDate: boolean;
}

export function calculatePurchaseCostsByProduct(
  purchases: ClosingStockPurchaseQuantity[],
): Record<string, number> {
  return purchases.reduce<Record<string, number>>((costs, purchase) => {
    const quantity = Number(purchase.quantity ?? 0);
    const costPrice = Number(purchase.cost_price ?? 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(costPrice)) return costs;

    costs[purchase.product_id] = (costs[purchase.product_id] ?? 0) + quantity * costPrice;
    return costs;
  }, {});
}

const THOUSANDS_GROUP = /^\d{3}$/;

/**
 * Normalizes "," and "." to one decimal point. With both present, the last
 * one is the decimal mark ("1.000,5", "1,000.5"). A single kind of separator
 * whose every following group has exactly three digits is a thousands
 * separator ("1,000", "1.000", "1,000,000"); otherwise one separator is a
 * decimal mark ("1,5") and repeated irregular groups are invalid.
 */
function normalizeDecimalSeparators(value: string): string | null {
  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    const [whole, ...fraction] = value.split(decimal);
    if (fraction.length !== 1) return null;
    return `${whole.split(thousands).join('')}.${fraction[0]}`;
  }

  const separator = lastComma >= 0 ? ',' : lastDot >= 0 ? '.' : null;
  if (!separator) return value;
  const groups = value.split(separator);
  if (groups.slice(1).every((group) => THOUSANDS_GROUP.test(group))) return groups.join('');
  return groups.length === 2 ? groups.join('.') : null;
}

function parseClosingStockNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, '').replace(/'/g, '');
  const normalized = normalizeDecimalSeparators(compact);
  if (normalized === null) return null;

  const digits = normalized.replace(/[^\d.-]/g, '');
  // Text with no number in it ("n/a", "нет") is not a count: Number('') would
  // read it as 0, i.e. every unit sold.
  if (!/\d/.test(digits)) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeStockCount(value: unknown): number {
  const parsed = parseClosingStockNumber(value);
  return parsed === null ? 0 : Math.max(0, Math.trunc(parsed));
}

export function normalizeStockAdjustment(value: unknown): number {
  const parsed = parseClosingStockNumber(value);
  return parsed === null ? 0 : Math.trunc(parsed);
}

/** Maps an editable closing-stock row to the pure totals input. */
export function closingStockRowTotalsInput(
  row: ClosingStockRowData,
  purchaseCost = 0,
): StockTotalsRowInput {
  return {
    tracksInventory: row.product.tracks_inventory !== false,
    previousStock: normalizeStockCount(row.previousStock),
    addedToday: normalizeStockCount(row.addedToday),
    adjustmentQuantity: normalizeStockAdjustment(row.adjustmentQuantity),
    adjustmentReason: row.adjustmentReason ?? null,
    giveawayQuantity: normalizeStockCount(row.giveawayQuantity),
    closingStock: normalizeStockCount(row.closingStock),
    soldQuantity: normalizeStockCount(row.soldQuantity),
    salePrice: Number(row.product.sale_price ?? 0),
    costPrice: Number(row.product.cost_price ?? 0),
    purchaseCost,
  };
}

/** Sold quantity derived from the row's stock movement, including promo giveaways. */
function derivedSoldQuantity(row: ClosingStockRowData): string {
  return String(calculateStockCountSummary({
    previousStock: normalizeStockCount(row.previousStock),
    addedToday: normalizeStockCount(row.addedToday),
    adjustmentQuantity: normalizeStockAdjustment(row.adjustmentQuantity),
    giveawayQuantity: normalizeStockCount(row.giveawayQuantity),
    closingStock: normalizeStockCount(row.closingStock),
    salePrice: row.product.sale_price,
    costPrice: row.product.cost_price,
  }).soldQuantity);
}

/** Count entry: staff type the closing stock and the sold quantity follows. */
export function withClosingStock(row: ClosingStockRowData, value: string): ClosingStockRowData {
  const nextRow = { ...row, closingStock: value };
  return { ...nextRow, soldQuantity: derivedSoldQuantity(nextRow) };
}

/** Sold entry: staff type the sold quantity and the closing stock follows. */
export function withSoldQuantity(row: ClosingStockRowData, value: string): ClosingStockRowData {
  if (row.product.tracks_inventory === false) {
    return {
      ...row,
      soldQuantity: value,
      previousStock: '0',
      addedToday: '0',
      closingStock: '0',
    };
  }
  return {
    ...row,
    soldQuantity: value,
    closingStock: String(calculateClosingStockFromSold(
      normalizeStockCount(row.previousStock),
      normalizeStockCount(row.addedToday),
      normalizeStockCount(value),
      normalizeStockAdjustment(row.adjustmentQuantity),
      normalizeStockCount(row.giveawayQuantity),
    )),
  };
}

/**
 * Free units leave stock unsold. When staff count closing stock, the sold
 * quantity shrinks; when they enter sold quantities, closing stock shrinks.
 */
export function withGiveaway(row: ClosingStockRowData, value: string, soldEntry = false): ClosingStockRowData {
  const nextRow = { ...row, giveawayQuantity: value };
  if (row.product.tracks_inventory === false) return nextRow;
  if (soldEntry) return withSoldQuantity(nextRow, nextRow.soldQuantity);
  return { ...nextRow, soldQuantity: derivedSoldQuantity(nextRow) };
}

/** What a saved count records for a row; a blank number stays blank so validation still sees it. */
function closingRowFingerprint(row: ClosingStockRowData): string {
  const count = (value: unknown) => (String(value ?? '').trim() === '' ? '' : String(normalizeStockCount(value)));
  const giveaway = normalizeStockCount(row.giveawayQuantity);
  return JSON.stringify([
    count(row.closingStock),
    count(row.soldQuantity),
    normalizeStockAdjustment(row.adjustmentQuantity),
    String(row.adjustmentReason ?? '').trim(),
    giveaway,
    giveaway > 0 ? row.promotionId ?? null : null,
  ]);
}

/** The rows whose recorded values differ from the loaded snapshot. */
export function changedClosingStockRows(
  rows: ClosingStockRowData[],
  snapshot: ClosingStockRowData[],
): ClosingStockRowData[] {
  const saved = new Map(snapshot.map((row) => [row.product.id, closingRowFingerprint(row)]));
  return rows.filter((row) => saved.get(row.product.id) !== closingRowFingerprint(row));
}

/**
 * Whether the sheet holds counts the database does not: edits that differ
 * from the rows that loaded, or a browser draft applied on load. A write-off
 * saves one product from its saved count (migration 188), so it is refused
 * until those counts are saved; otherwise they would be lost on the reload
 * that follows, and a draft would stop re-applying once the day has a count.
 */
export function hasUnsavedSheetCounts(
  rows: ClosingStockRowData[],
  loaded: ClosingStockRowData[],
  draftApplied: boolean,
): boolean {
  return draftApplied || changedClosingStockRows(rows, loaded).length > 0;
}

export function getBulkStockAvailableQuantity(row: ClosingStockRowData): number | null {
  return row.product.tracks_inventory === false
    ? null
    : normalizeStockCount(row.closingStock);
}

function normalizeBulkOrderItems(items: BulkStockOrderItem[]): Map<string, number> {
  return items.reduce<Map<string, number>>((quantities, item) => {
    const quantity = normalizeStockCount(item.quantity);
    if (quantity > 0) {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + quantity);
    }
    return quantities;
  }, new Map());
}

export function calculateBulkStockOrderSummary(
  rows: ClosingStockRowData[],
  items: BulkStockOrderItem[],
): BulkStockOrderSummary {
  const quantities = normalizeBulkOrderItems(items);

  return rows.reduce<BulkStockOrderSummary>((summary, row) => {
    const quantity = quantities.get(row.product.id) ?? 0;
    summary.totalQuantity += quantity;
    summary.totalPrice += quantity * Number(row.product.sale_price ?? 0);
    return summary;
  }, { totalQuantity: 0, totalPrice: 0 });
}

/**
 * Archived and inactive products keep their saved counts on screen but cannot
 * be written: save_closing_stock_counts accepts only active, non-deleted
 * products, and it leaves rows missing from the payload untouched.
 */
export function isReadOnlyClosingStockProduct(
  product: Pick<Product, 'is_active' | 'is_deleted'>,
): boolean {
  return Boolean(product.is_deleted) || product.is_active === false;
}

export function applyBulkStockOrder(
  rows: ClosingStockRowData[],
  items: BulkStockOrderItem[],
): ClosingStockRowData[] {
  const quantities = normalizeBulkOrderItems(items);

  return rows.map((row) => {
    if (isReadOnlyClosingStockProduct(row.product)) return row;
    const quantity = quantities.get(row.product.id) ?? 0;
    if (quantity === 0) return row;

    if (row.product.tracks_inventory === false) {
      return {
        ...row,
        previousStock: '0',
        addedToday: '0',
        closingStock: '0',
        soldQuantity: String(normalizeStockCount(row.soldQuantity) + quantity),
      };
    }

    const availableQuantity = getBulkStockAvailableQuantity(row) ?? 0;
    if (quantity > availableQuantity) {
      throw new BulkStockAvailabilityError(
        row.product.id,
        row.product.name,
        quantity,
        availableQuantity,
      );
    }

    const soldQuantity = normalizeStockCount(row.soldQuantity) + quantity;
    const closingStock = calculateClosingStockFromSold(
      normalizeStockCount(row.previousStock),
      normalizeStockCount(row.addedToday),
      soldQuantity,
      normalizeStockAdjustment(row.adjustmentQuantity),
      normalizeStockCount(row.giveawayQuantity),
    );

    return {
      ...row,
      closingStock: String(closingStock),
      soldQuantity: String(soldQuantity),
    };
  });
}

function formatStockValue(value: unknown): string {
  return String(normalizeStockCount(value));
}

function formatEditableStockValue(value: unknown): string {
  return String(value ?? '').trim() === '' ? '' : formatStockValue(value);
}

function refreshRowPurchasedToday(
  row: ClosingStockRowData,
  purchasedToday: number | undefined,
  openingStock: number | undefined,
): ClosingStockRowData {
  const previousStock = openingStock ?? normalizeStockCount(row.previousStock);
  const addedToday = normalizeStockCount(purchasedToday ?? row.addedToday);
  const addedDelta = addedToday - normalizeStockCount(row.addedToday)
    + previousStock - normalizeStockCount(row.previousStock);
  const closingStock = Math.max(0, normalizeStockCount(row.closingStock) + addedDelta);
  const summary = calculateStockCountSummary({
    previousStock,
    addedToday,
    adjustmentQuantity: normalizeStockAdjustment(row.adjustmentQuantity),
    giveawayQuantity: normalizeStockCount(row.giveawayQuantity),
    closingStock,
    salePrice: row.product.sale_price,
    costPrice: row.product.cost_price,
  });

  return {
    ...row,
    previousStock: formatStockValue(previousStock),
    addedToday: formatStockValue(addedToday),
    closingStock: formatStockValue(closingStock),
    soldQuantity: formatStockValue(summary.soldQuantity),
  };
}

export function closingStockDraftKey(date: string, clubId?: string): string {
  return clubId ? `closing-stock-draft:${clubId}:${date}` : `closing-stock-draft:${date}`;
}

function createClosingStockDraft(
  date: string,
  rows: ClosingStockRowData[],
  savedAt = new Date().toISOString(),
  clubId?: string,
): ClosingStockDraft {
  return {
    version: 1,
    date,
    clubId,
    savedAt,
    rows: rows.map((row) => ({
      productId: row.product.id,
      previousStock: row.previousStock,
      addedToday: row.addedToday,
      adjustmentQuantity: row.adjustmentQuantity,
      adjustmentReason: row.adjustmentReason,
      giveawayQuantity: row.giveawayQuantity,
      promotionId: row.promotionId,
      closingStock: row.closingStock,
      soldQuantity: row.soldQuantity,
    })),
  };
}

export function readClosingStockDraft(storage: StorageLike | null | undefined, date: string, clubId?: string): ClosingStockDraft | null {
  if (!storage) return null;

  try {
    const raw = storage.getItem(closingStockDraftKey(date, clubId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClosingStockDraft;
    return parsed.version === 1 && parsed.date === date && parsed.clubId === clubId && Array.isArray(parsed.rows)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function saveClosingStockDraft(
  storage: StorageLike | null | undefined,
  date: string,
  rows: ClosingStockRowData[],
  savedAt = new Date().toISOString(),
  clubId?: string,
): boolean {
  if (!storage) return false;

  try {
    storage.setItem(closingStockDraftKey(date, clubId), JSON.stringify(createClosingStockDraft(date, rows, savedAt, clubId)));
    return true;
  } catch {
    return false;
  }
}

export function clearClosingStockDraft(storage: StorageLike | null | undefined, date: string, clubId?: string): void {
  if (!storage) return;

  try {
    storage.removeItem(closingStockDraftKey(date, clubId));
  } catch {
    // The submitted data is already persisted remotely.
  }
}

export function applyClosingStockDraft(
  rows: ClosingStockRowData[],
  draft: ClosingStockDraft | null,
  entryMode: ClosingStockEntryMode = 'soldQuantity',
): ClosingStockRowData[] {
  if (!draft) return rows;

  const draftByProduct = new Map(draft.rows.map((row) => [row.productId, row]));
  return rows.map((row) => {
    if (isReadOnlyClosingStockProduct(row.product)) return row;
    const draftRow = draftByProduct.get(row.product.id);
    if (!draftRow) return row;
    const adjustmentQuantity = String(draftRow.adjustmentQuantity ?? row.adjustmentQuantity ?? '0');
    const adjustmentReason = String(draftRow.adjustmentReason ?? row.adjustmentReason ?? '');
    const giveawayQuantity = String(draftRow.giveawayQuantity ?? row.giveawayQuantity ?? '0');
    const promotionId = draftRow.promotionId === undefined ? row.promotionId ?? null : draftRow.promotionId;

    if (row.product.tracks_inventory === false) {
      return {
        ...row,
        previousStock: '0',
        addedToday: '0',
        adjustmentQuantity: '0',
        adjustmentReason: '',
        giveawayQuantity,
        promotionId,
        closingStock: '0',
        soldQuantity: formatEditableStockValue(draftRow.soldQuantity),
      };
    }

    const draftedRow: ClosingStockRowData = {
      ...row,
      // Opening stock and purchases are authoritative derived values. A draft
      // must never restore stale copies after an earlier day or purchase is
      // corrected.
      previousStock: row.previousStock,
      addedToday: row.addedToday,
      adjustmentQuantity,
      adjustmentReason,
      giveawayQuantity,
      promotionId,
    };

    if (entryMode === 'soldQuantity') {
      const soldQuantity = formatEditableStockValue(draftRow.soldQuantity);
      return {
        ...draftedRow,
        soldQuantity,
        closingStock: formatStockValue(calculateClosingStockFromSold(
          normalizeStockCount(row.previousStock),
          normalizeStockCount(row.addedToday),
          normalizeStockCount(soldQuantity),
          normalizeStockAdjustment(adjustmentQuantity),
          normalizeStockCount(giveawayQuantity),
        )),
      };
    }

    const closingStock = formatEditableStockValue(draftRow.closingStock);
    return {
      ...draftedRow,
      closingStock,
      soldQuantity: formatStockValue(calculateStockCountSummary({
        previousStock: normalizeStockCount(row.previousStock),
        addedToday: normalizeStockCount(row.addedToday),
        adjustmentQuantity: normalizeStockAdjustment(adjustmentQuantity),
        giveawayQuantity: normalizeStockCount(giveawayQuantity),
        closingStock: normalizeStockCount(closingStock),
        salePrice: row.product.sale_price,
        costPrice: row.product.cost_price,
      }).soldQuantity),
    };
  });
}

export function buildEditableClosingStockRows({
  products,
  counts,
  purchases,
  previousClosings,
  isCurrentDate,
}: BuildEditableClosingStockRowsInput): ClosingStockRowData[] {
  const purchasesByProduct = purchases.reduce<Record<string, number>>(
    (acc, purchase) => {
      acc[purchase.product_id] = (acc[purchase.product_id] ?? 0) + Number(purchase.quantity ?? 0);
      return acc;
    },
    {},
  );

  const countsByProduct = new Map(counts.map((count) => [count.product_id, count]));

  return products.map((product) => {
    const existing = countsByProduct.get(product.id);
    // save_closing_stock_counts keeps an existing row's saved prices, so the
    // row, KPIs and save toast must use them too, not later catalog prices.
    if (existing) {
      product = {
        ...product,
        sale_price: Number(existing.sale_price ?? product.sale_price),
        cost_price: Number(existing.cost_price ?? product.cost_price),
      };
    }

    if (product.tracks_inventory === false) {
      return {
        product,
        previousStock: '0',
        addedToday: '0',
        adjustmentQuantity: '0',
        adjustmentReason: '',
        giveawayQuantity: formatStockValue(existing?.giveaway_quantity ?? 0),
        promotionId: existing?.promotion_id ?? null,
        closingStock: '0',
        soldQuantity: formatStockValue(existing?.sold_quantity ?? 0),
      };
    }

    const purchasedToday = purchasesByProduct[product.id];
    const addedToday = purchasedToday ?? 0;
    const defaults = calculateClosingStockDefaults({
      currentStock: product.current_stock,
      purchasedToday: addedToday,
    });
    const previousClosing = previousClosings[product.id];
    const previousStock = previousClosing ?? (isCurrentDate ? defaults.previousStock : 0);
    const closingStock = previousClosing === undefined && isCurrentDate
      ? defaults.closingStock
      : previousStock + addedToday;

    if (existing) {
      const purchaseQuantity = Number(purchasedToday ?? 0);
      const savedRow: ClosingStockRowData = {
        product,
        previousStock: formatStockValue(existing.previous_stock),
        addedToday: formatStockValue(existing.added_today),
        purchaseQuantity,
        hasPurchaseMismatch: !isCurrentDate
          && Number(existing.added_today ?? 0) !== purchaseQuantity,
        adjustmentQuantity: String(normalizeStockAdjustment(existing.adjustment_quantity)),
        adjustmentReason: String(existing.adjustment_reason ?? ''),
        giveawayQuantity: formatStockValue(existing.giveaway_quantity ?? 0),
        promotionId: existing.promotion_id ?? null,
        closingStock: formatStockValue(existing.closing_stock),
        soldQuantity: formatStockValue(existing.sold_quantity),
      };

      // An already-saved historical row is an accounting snapshot. Purchases
      // may have been entered or corrected later, so display the mismatch but
      // never synthesize different added/closing values for that old count.
      return isCurrentDate && !isReadOnlyClosingStockProduct(product)
        ? refreshRowPurchasedToday(savedRow, purchasedToday, previousClosing)
        : savedRow;
    }

    return {
      product,
      previousStock: formatStockValue(previousStock),
      addedToday: formatStockValue(defaults.addedToday),
      adjustmentQuantity: '0',
      adjustmentReason: '',
      giveawayQuantity: '0',
      promotionId: null,
      closingStock: formatStockValue(closingStock),
      soldQuantity: '0',
    };
  });
}

export type ClosingStockValidationCode =
  | 'closing_required'
  | 'sold_required'
  | 'adjustment_reason_required'
  | 'closing_exceeds_available'
  | 'negative_available_stock'
  | 'sold_quantity_mismatch';

export class ClosingStockValidationError extends Error {
  constructor(
    public readonly code: ClosingStockValidationCode,
    public readonly productId: string,
    public readonly productName: string,
    public readonly availableStock: number,
  ) {
    super(
      code === 'closing_required'
        ? `${productName}: enter the closing stock count.`
        : code === 'sold_required'
          ? `${productName}: enter the sold quantity.`
          : code === 'adjustment_reason_required'
        ? `${productName}: an inventory adjustment requires a reason.`
        : code === 'negative_available_stock'
          ? `${productName}: the adjustment makes available stock negative.`
          : code === 'sold_quantity_mismatch'
            ? `${productName}: sold quantity does not match the stock movement.`
            : `${productName}: closing stock cannot exceed the ${availableStock} units available without an explicit adjustment.`,
    );
    this.name = 'ClosingStockValidationError';
  }
}

export function validateClosingStockRows(rows: ClosingStockRowData[]): ClosingStockValidationError | null {
  for (const row of rows) {
    if (isReadOnlyClosingStockProduct(row.product)) continue;
    if (row.product.tracks_inventory === false) continue;

    // A blank count must never be read as zero: for a tracked product that
    // would silently record every available unit as sold.
    if (String(row.closingStock ?? '').trim() === '') {
      return new ClosingStockValidationError(
        'closing_required',
        row.product.id,
        row.product.name,
        calculateAvailableStock(
          normalizeStockCount(row.previousStock),
          normalizeStockCount(row.addedToday),
          normalizeStockAdjustment(row.adjustmentQuantity),
        ),
      );
    }
    if (String(row.soldQuantity ?? '').trim() === '') {
      return new ClosingStockValidationError(
        'sold_required',
        row.product.id,
        row.product.name,
        calculateAvailableStock(
          normalizeStockCount(row.previousStock),
          normalizeStockCount(row.addedToday),
          normalizeStockAdjustment(row.adjustmentQuantity),
        ),
      );
    }

    const previousStock = normalizeStockCount(row.previousStock);
    const addedToday = normalizeStockCount(row.addedToday);
    const adjustmentQuantity = normalizeStockAdjustment(row.adjustmentQuantity);
    const giveawayQuantity = normalizeStockCount(row.giveawayQuantity);
    const closingStock = normalizeStockCount(row.closingStock);
    const requestedSoldQuantity = normalizeStockCount(row.soldQuantity);
    const availability = validateStockAvailability(
      previousStock,
      addedToday,
      closingStock,
      adjustmentQuantity,
      giveawayQuantity,
    );

    if (adjustmentQuantity !== 0 && !String(row.adjustmentReason ?? '').trim()) {
      return new ClosingStockValidationError(
        'adjustment_reason_required',
        row.product.id,
        row.product.name,
        availability.availableStock,
      );
    }

    if (availability.availableStock < 0) {
      return new ClosingStockValidationError(
        'negative_available_stock',
        row.product.id,
        row.product.name,
        availability.availableStock,
      );
    }

    if (!availability.isValid) {
      return new ClosingStockValidationError(
        'closing_exceeds_available',
        row.product.id,
        row.product.name,
        availability.availableStock,
      );
    }

    const expectedSoldQuantity = calculateAvailableStock(
      previousStock,
      addedToday,
      adjustmentQuantity,
    ) - giveawayQuantity - closingStock;
    if (requestedSoldQuantity !== expectedSoldQuantity) {
      return new ClosingStockValidationError(
        'sold_quantity_mismatch',
        row.product.id,
        row.product.name,
        availability.availableStock,
      );
    }
  }

  return null;
}

export function buildClosingStockUpserts({
  date,
  rows,
  createdBy,
  updatedAt = new Date().toISOString(),
}: {
  date: string;
  rows: ClosingStockRowData[];
  createdBy: string | null;
  updatedAt?: string;
}): { upserts: ClosingStockUpsert[]; savedClosings: Record<string, number> } {
  rows = rows.filter((row) => !isReadOnlyClosingStockProduct(row.product));
  const validationError = validateClosingStockRows(rows);
  if (validationError) throw validationError;

  const upserts = rows.map((row) => {
    const giveawayQuantity = normalizeStockCount(row.giveawayQuantity);
    const promotionId = giveawayQuantity > 0 ? row.promotionId ?? null : null;

    if (row.product.tracks_inventory === false) {
      const summary = calculateDirectSalesSummary(
        normalizeStockCount(row.soldQuantity),
        row.product.sale_price,
        row.product.cost_price,
        giveawayQuantity,
      );

      return {
        date,
        product_id: row.product.id,
        previous_stock: 0,
        added_today: 0,
        adjustment_quantity: 0,
        adjustment_reason: null,
        giveaway_quantity: giveawayQuantity,
        promotion_id: promotionId,
        closing_stock: 0,
        sold_quantity: summary.soldQuantity,
        sale_price: row.product.sale_price,
        cost_price: row.product.cost_price,
        bar_income: summary.barIncome,
        bar_cost: summary.barCost,
        bar_profit: summary.barProfit,
        created_by: createdBy,
        updated_at: updatedAt,
      };
    }

    const previousStock = normalizeStockCount(row.previousStock);
    const addedToday = normalizeStockCount(row.addedToday);
    const adjustmentQuantity = normalizeStockAdjustment(row.adjustmentQuantity);
    const adjustmentReason = String(row.adjustmentReason ?? '').trim() || null;
    const closingStock = normalizeStockCount(row.closingStock);
    const { soldQuantity, barIncome, barCost, barProfit } = calculateStockCountSummary({
      previousStock,
      addedToday,
      adjustmentQuantity,
      adjustmentReason,
      giveawayQuantity,
      closingStock,
      salePrice: row.product.sale_price,
      costPrice: row.product.cost_price,
    });

    return {
      date,
      product_id: row.product.id,
      previous_stock: previousStock,
      added_today: addedToday,
      adjustment_quantity: adjustmentQuantity,
      adjustment_reason: adjustmentReason,
      giveaway_quantity: giveawayQuantity,
      promotion_id: promotionId,
      closing_stock: closingStock,
      sold_quantity: soldQuantity,
      sale_price: row.product.sale_price,
      cost_price: row.product.cost_price,
      bar_income: barIncome,
      bar_cost: barCost,
      bar_profit: barProfit,
      created_by: createdBy,
      updated_at: updatedAt,
    };
  });

  return {
    upserts,
    savedClosings: rows.reduce<Record<string, number>>((acc, row) => {
      if (row.product.tracks_inventory !== false) {
        acc[row.product.id] = normalizeStockCount(row.closingStock);
      }
      return acc;
    }, {}),
  };
}

/** True for an empty string or a non-negative whole number typed by the user. */
export function isWholeNumberInput(value: string): boolean {
  return value === '' || (/^\d+$/.test(value) && value.length <= MAX_QUANTITY_INPUT_DIGITS);
}

/**
 * Whether a club records closing stock by entering sold quantities (closing
 * is calculated) instead of counting remaining stock. Clubs have no stored
 * setting for this yet, so the Pixel club is recognised by name; this is the
 * only place that rule lives, and a real per-club setting would replace it.
 */
export function usesSoldQuantityEntry(club: { name?: string | null } | null | undefined): boolean {
  return club?.name?.toLowerCase().includes('pixel') ?? false;
}
