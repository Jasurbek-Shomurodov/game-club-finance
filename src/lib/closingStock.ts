import type { Product } from '../types';
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
    closingStock: string;
    soldQuantity: string;
  }>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ImportedClosingStockRow {
  rowNumber: number;
  product?: string;
  productId?: string;
  previousStock?: number;
  addedToday?: number;
  closingStock?: number;
  soldQuantity?: number;
  salePrice?: number;
  costPrice?: number;
}

export type ClosingStockImportMode = 'closingStock' | 'soldQuantity';

export interface ClosingStockImportResult {
  rows: ClosingStockRowData[];
  matchedCount: number;
  unmatchedImports: ImportedClosingStockRow[];
}

export interface ClosingStockImportSheet {
  name: string;
  rows: unknown[][];
}

export interface ClosingStockImportSelection {
  sheetName: string;
  rows: ImportedClosingStockRow[];
}

export interface ClosingStockUpsert {
  date: string;
  product_id: string;
  previous_stock: number;
  added_today: number;
  adjustment_quantity: number;
  adjustment_reason: string | null;
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

const headerAliases = {
  productId: ['product id', 'product_id', 'id', 'sku', 'код', 'id товара', 'mahsulot id'],
  product: ['product', 'product name', 'product_name', 'name', 'item', 'column 1', 'товар', 'продукт', 'наименование', 'название', 'tovar', 'mahsulot', 'mahsulot nomi', 'nomi'],
  previousStock: ['previous stock', 'previous_stock', 'opening stock', 'start stock', 'начальный остаток', 'oldingi ostatka', 'avvalgi qoldiq'],
  addedToday: ['added today', 'added_today', 'purchased today', 'received', 'добавлено', 'приход', 'keldi', 'kelgan', 'bugun qoshildi', 'bugun qo‘shildi'],
  closingStock: ['closing stock', 'closing_stock', 'ending stock', 'end stock', 'stock left', 'остаток', 'остаток на конец', 'конечный остаток', 'закрытие', 'ostatka', 'qoldiq', 'yakuniy qoldiq'],
  soldQuantity: ['sold qty', 'sold quantity', 'sold_quantity', 'sold', 'qty sold', 'расход', 'продано', 'sotildi', 'sotilgan'],
  salePrice: ['sale price', 'sale_price', 'price', 'narxi', 'цена продажи'],
  costPrice: ['cost price', 'cost_price', 'cost', 'tan narxi', 'себестоимость'],
} as const;

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[’'`]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeHeader(value: string): string {
  return normalizeText(value)
    .replace(/[_-]+/g, ' ')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeProductMatchText(value: unknown): string {
  return normalizeText(value)
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveHeader(header: string): keyof typeof headerAliases | null {
  const normalized = normalizeHeader(header);

  for (const [field, aliases] of Object.entries(headerAliases) as Array<[keyof typeof headerAliases, readonly string[]]>) {
    if (aliases.some((alias) => normalized === normalizeHeader(alias))) {
      return field;
    }
  }

  return null;
}

function productPriceMatchKey(
  productName: string | undefined,
  salePrice: number | undefined,
  costPrice: number | undefined,
): string | null {
  if (!productName || salePrice === undefined || costPrice === undefined) return null;
  return `${normalizeProductMatchText(productName)}|${Number(salePrice).toFixed(2)}|${Number(costPrice).toFixed(2)}`;
}

function hasImportValue(row: ImportedClosingStockRow): boolean {
  return Boolean(row.product || row.productId) ||
    row.previousStock !== undefined ||
    row.addedToday !== undefined ||
    row.closingStock !== undefined ||
    row.soldQuantity !== undefined ||
    row.salePrice !== undefined ||
    row.costPrice !== undefined;
}

function hasEditableImportValue(row: ImportedClosingStockRow): boolean {
  return row.previousStock !== undefined ||
    row.addedToday !== undefined ||
    row.closingStock !== undefined ||
    row.soldQuantity !== undefined;
}

function parseImportRow(
  entries: Array<[string, unknown]>,
  rowNumber: number,
): ImportedClosingStockRow | null {
  const parsed: ImportedClosingStockRow = { rowNumber };

  for (const [header, value] of entries) {
    const field = resolveHeader(header);
    if (!field) continue;

    if (field === 'product' || field === 'productId') {
      const text = String(value ?? '').trim();
      if (text) parsed[field] = text;
      continue;
    }

    const numeric = parseClosingStockNumber(value);
    if (numeric !== null) parsed[field] = numeric;
  }

  return hasImportValue(parsed) ? parsed : null;
}

function getHeaderFields(row: unknown[]): Array<keyof typeof headerAliases> {
  return row.flatMap((cell) => {
    const field = resolveHeader(String(cell ?? ''));
    return field ? [field] : [];
  });
}

function isImportHeaderRow(row: unknown[]): boolean {
  const fields = new Set(getHeaderFields(row));
  const hasProduct = fields.has('product') || fields.has('productId');
  const editableCount = Number(fields.has('previousStock')) +
    Number(fields.has('addedToday')) +
    Number(fields.has('closingStock')) +
    Number(fields.has('soldQuantity'));

  return (hasProduct && editableCount > 0) || editableCount > 0;
}

function parseSheetDate(sheetName: string): string | null {
  const trimmed = sheetName.trim();
  const dotted = trimmed.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dotted) {
    const [, day, month, year] = dotted;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  return null;
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

  const parsed = Number(normalized.replace(/[^\d.-]/g, ''));
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
    closingStock: normalizeStockCount(row.closingStock),
    soldQuantity: normalizeStockCount(row.soldQuantity),
    salePrice: Number(row.product.sale_price ?? 0),
    costPrice: Number(row.product.cost_price ?? 0),
    purchaseCost,
  };
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
  entryMode: ClosingStockImportMode = 'soldQuantity',
): ClosingStockRowData[] {
  if (!draft) return rows;

  const draftByProduct = new Map(draft.rows.map((row) => [row.productId, row]));
  return rows.map((row) => {
    if (isReadOnlyClosingStockProduct(row.product)) return row;
    const draftRow = draftByProduct.get(row.product.id);
    if (!draftRow) return row;
    const adjustmentQuantity = String(draftRow.adjustmentQuantity ?? row.adjustmentQuantity ?? '0');
    const adjustmentReason = String(draftRow.adjustmentReason ?? row.adjustmentReason ?? '');

    if (row.product.tracks_inventory === false) {
      return {
        ...row,
        previousStock: '0',
        addedToday: '0',
        adjustmentQuantity: '0',
        adjustmentReason: '',
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
        closingStock: normalizeStockCount(closingStock),
        salePrice: row.product.sale_price,
        costPrice: row.product.cost_price,
      }).soldQuantity),
    };
  });
}

export function parseClosingStockImportRecords(records: Array<Record<string, unknown>>): ImportedClosingStockRow[] {
  return records.flatMap((record, index) => {
    const parsed = parseImportRow(Object.entries(record), index + 2);
    return parsed ? [parsed] : [];
  });
}

export function parseClosingStockImportSheetRows(sheetRows: unknown[][]): ImportedClosingStockRow[] {
  const headerRowIndex = sheetRows.findIndex((row) => isImportHeaderRow(row));
  if (headerRowIndex === -1) return [];

  const headers = sheetRows[headerRowIndex].map((header) => String(header ?? ''));

  return sheetRows.slice(headerRowIndex + 1).flatMap((row, index) => {
    const entries = headers.map((header, cellIndex): [string, unknown] => [header, row[cellIndex]]);
    const parsed = parseImportRow(entries, headerRowIndex + index + 2);
    return parsed ? [parsed] : [];
  });
}

export function selectClosingStockImportRows(
  sheets: ClosingStockImportSheet[],
  selectedDate?: string,
): ClosingStockImportSelection | null {
  const candidates = sheets.flatMap((sheet, index) => {
    const rows = parseClosingStockImportSheetRows(sheet.rows);
    if (rows.length === 0 || rows.every((row) => !hasEditableImportValue(row))) return [];

    return [{
      index,
      sheetName: sheet.name,
      sheetDate: parseSheetDate(sheet.name),
      rows,
    }];
  });

  if (candidates.length === 0) return null;

  if (selectedDate) {
    const exactDate = candidates.find((candidate) => candidate.sheetDate === selectedDate);
    if (exactDate) {
      return { sheetName: exactDate.sheetName, rows: exactDate.rows };
    }

    const latestBeforeOrSame = candidates
      .filter((candidate) => candidate.sheetDate && candidate.sheetDate <= selectedDate)
      .sort((a, b) => b.sheetDate!.localeCompare(a.sheetDate!))[0];
    if (latestBeforeOrSame) {
      return { sheetName: latestBeforeOrSame.sheetName, rows: latestBeforeOrSame.rows };
    }
  }

  const latestDated = candidates
    .filter((candidate) => candidate.sheetDate)
    .sort((a, b) => b.sheetDate!.localeCompare(a.sheetDate!))[0];
  const selected = latestDated ?? candidates.sort((a, b) => a.index - b.index)[0];
  return { sheetName: selected.sheetName, rows: selected.rows };
}

function applyImportToRow(
  row: ClosingStockRowData,
  imported: ImportedClosingStockRow,
  mode: ClosingStockImportMode,
): ClosingStockRowData {
  const next = { ...row };

  if (row.product.tracks_inventory === false) {
    return {
      ...next,
      previousStock: '0',
      addedToday: '0',
      closingStock: '0',
      soldQuantity: imported.soldQuantity === undefined
        ? next.soldQuantity
        : formatStockValue(normalizeStockCount(imported.soldQuantity)),
    };
  }

  if (imported.previousStock !== undefined) {
    next.previousStock = formatStockValue(imported.previousStock);
  }

  if (imported.addedToday !== undefined) {
    next.addedToday = formatStockValue(imported.addedToday);
  }

  const previousStock = normalizeStockCount(next.previousStock);
  const addedToday = normalizeStockCount(next.addedToday);
  const adjustmentQuantity = normalizeStockAdjustment(next.adjustmentQuantity);

  if (mode === 'soldQuantity') {
    if (imported.soldQuantity !== undefined) {
      const soldQuantity = normalizeStockCount(imported.soldQuantity);
      next.soldQuantity = formatStockValue(soldQuantity);
      next.closingStock = formatStockValue(calculateClosingStockFromSold(
        previousStock,
        addedToday,
        soldQuantity,
        adjustmentQuantity,
      ));
      return next;
    }

    if (imported.closingStock !== undefined) {
      const closingStock = normalizeStockCount(imported.closingStock);
      next.closingStock = formatStockValue(closingStock);
      next.soldQuantity = formatStockValue(calculateStockCountSummary({
        previousStock,
        addedToday,
        adjustmentQuantity,
        closingStock,
        salePrice: row.product.sale_price,
        costPrice: row.product.cost_price,
      }).soldQuantity);
    }

    return next;
  }

  if (imported.closingStock !== undefined) {
    const closingStock = normalizeStockCount(imported.closingStock);
    next.closingStock = formatStockValue(closingStock);
    next.soldQuantity = formatStockValue(calculateStockCountSummary({
      previousStock,
      addedToday,
      adjustmentQuantity,
      closingStock,
      salePrice: row.product.sale_price,
      costPrice: row.product.cost_price,
    }).soldQuantity);
    return next;
  }

  if (imported.soldQuantity !== undefined) {
    const soldQuantity = normalizeStockCount(imported.soldQuantity);
    next.soldQuantity = formatStockValue(soldQuantity);
    next.closingStock = formatStockValue(calculateClosingStockFromSold(
      previousStock,
      addedToday,
      soldQuantity,
      adjustmentQuantity,
    ));
  }

  return next;
}

function importHasEditableValue(imported: ImportedClosingStockRow): boolean {
  return hasEditableImportValue(imported);
}

export function applyClosingStockImport(
  rows: ClosingStockRowData[],
  importedRows: ImportedClosingStockRow[],
  mode: ClosingStockImportMode,
): ClosingStockImportResult {
  const usedImports = new Set<number>();
  const byProductId = new Map<string, number[]>();
  const byProductNameAndPrices = new Map<string, number[]>();
  const byProductName = new Map<string, number[]>();

  function addImportIndex(map: Map<string, number[]>, key: string | null | undefined, index: number) {
    if (!key) return;
    const indexes = map.get(key);
    if (indexes) indexes.push(index);
    else map.set(key, [index]);
  }

  function findUnusedImportIndex(map: Map<string, number[]>, key: string | null | undefined) {
    if (!key) return undefined;
    return map.get(key)?.find((index) => !usedImports.has(index));
  }

  importedRows.forEach((imported, index) => {
    addImportIndex(byProductId, imported.productId ? normalizeText(imported.productId) : null, index);
    addImportIndex(
      byProductNameAndPrices,
      productPriceMatchKey(imported.product, imported.salePrice, imported.costPrice),
      index,
    );
    addImportIndex(byProductName, imported.product ? normalizeProductMatchText(imported.product) : null, index);
  });

  let matchedCount = 0;

  const nextRows = rows.map((row, rowIndex) => {
    if (isReadOnlyClosingStockProduct(row.product)) return row;
    const idMatch = findUnusedImportIndex(byProductId, normalizeText(row.product.id));
    const nameAndPricesMatch = findUnusedImportIndex(
      byProductNameAndPrices,
      productPriceMatchKey(row.product.name, Number(row.product.sale_price), Number(row.product.cost_price)),
    );
    const nameMatch = findUnusedImportIndex(byProductName, normalizeProductMatchText(row.product.name));
    const positionalMatch = importedRows[rowIndex] &&
      !importedRows[rowIndex].product &&
      !importedRows[rowIndex].productId
      ? rowIndex
      : undefined;
    const importIndex = [idMatch, nameAndPricesMatch, nameMatch, positionalMatch]
      .find((candidate) => candidate !== undefined && !usedImports.has(candidate));

    if (importIndex === undefined) return row;

    const imported = importedRows[importIndex];
    usedImports.add(importIndex);

    if (!importHasEditableValue(imported)) return row;

    matchedCount += 1;
    return applyImportToRow(row, imported, mode);
  });

  return {
    rows: nextRows,
    matchedCount,
    unmatchedImports: importedRows.filter((imported, index) =>
      !usedImports.has(index) && Boolean(imported.product || imported.productId),
    ),
  };
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
    const closingStock = normalizeStockCount(row.closingStock);
    const requestedSoldQuantity = normalizeStockCount(row.soldQuantity);
    const availability = validateStockAvailability(
      previousStock,
      addedToday,
      closingStock,
      adjustmentQuantity,
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
    ) - closingStock;
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
    if (row.product.tracks_inventory === false) {
      const summary = calculateDirectSalesSummary(
        normalizeStockCount(row.soldQuantity),
        row.product.sale_price,
        row.product.cost_price,
      );

      return {
        date,
        product_id: row.product.id,
        previous_stock: 0,
        added_today: 0,
        adjustment_quantity: 0,
        adjustment_reason: null,
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
  return value === '' || /^\d+$/.test(value);
}

/** True for an empty string, a lone minus, or a signed whole number typed by the user. */
export function isSignedWholeNumberInput(value: string): boolean {
  return value === '' || value === '-' || /^-?\d+$/.test(value);
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
