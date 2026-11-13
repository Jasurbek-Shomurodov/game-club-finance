import { STOCK_WRITE_OFF_REASON_PATTERN } from './calculations/stock';
import {
  normalizeStockAdjustment,
  normalizeStockCount,
  type ClosingStockRowData,
} from './closingStock';

/**
 * Bar write-offs: units that left stock without a sale because they went
 * missing (kamomad) or spoiled (eskirgan). A write-off is recorded through the
 * existing owner-only inventory adjustment of the day's stock count as a
 * negative adjustment whose reason carries the kind:
 *
 *   adjustment_quantity = -quantity
 *   adjustment_reason   = "shortage" | "expired" [": note"]
 *
 * The units leave the closing balance and sales stay as recorded, so bar income
 * is not charged for them. Their value at cost is added to bar cost (so bar
 * profit falls by it, migration 141) and shown as the loss in reports.
 */
export const STOCK_WRITE_OFF_KINDS = ['shortage', 'expired'] as const;
export type StockWriteOffKind = (typeof STOCK_WRITE_OFF_KINDS)[number];
/** A negative adjustment saved before write-offs existed, with a free-text reason. */
export type StockWriteOffReportKind = StockWriteOffKind | 'other';

export function formatWriteOffReason(kind: StockWriteOffKind, note = ''): string {
  const trimmed = note.trim();
  return trimmed ? `${kind}: ${trimmed}` : kind;
}

export function parseWriteOffReason(reason: string | null | undefined): { kind: StockWriteOffReportKind; note: string } {
  const text = String(reason ?? '').trim();
  const match = STOCK_WRITE_OFF_REASON_PATTERN.exec(text);
  if (!match) return { kind: 'other', note: text };
  return { kind: match[1] as StockWriteOffKind, note: (match[2] ?? '').trim() };
}

export interface RowWriteOff {
  quantity: number;
  kind: StockWriteOffReportKind;
  note: string;
}

/** The write-off a row carries; `null` when its adjustment is not a removal. */
export function rowWriteOff(row: Pick<ClosingStockRowData, 'adjustmentQuantity' | 'adjustmentReason'>): RowWriteOff | null {
  const adjustment = normalizeStockAdjustment(row.adjustmentQuantity);
  if (adjustment >= 0) return null;
  return { quantity: -adjustment, ...parseWriteOffReason(row.adjustmentReason) };
}

export class StockWriteOffError extends Error {
  constructor(
    readonly code: 'not_tracked' | 'positive_adjustment' | 'exceeds_stock',
    readonly productName: string,
    readonly availableQuantity = 0,
  ) {
    super(`${productName}: write-off ${code}`);
    this.name = 'StockWriteOffError';
  }
}

/** Most units a row can write off: what is left plus what it already wrote off. */
export function maxWriteOffQuantity(row: ClosingStockRowData): number {
  return normalizeStockCount(row.closingStock) + (rowWriteOff(row)?.quantity ?? 0);
}

/**
 * Sets the row's write-off to `quantity` (0 removes it). The difference leaves
 * or returns to closing stock; the sold quantity is unchanged, so the stock
 * movement still balances in both entry modes.
 */
export function applyStockWriteOff(
  row: ClosingStockRowData,
  writeOff: { kind: StockWriteOffKind; quantity: number; note?: string },
): ClosingStockRowData {
  if (row.product.tracks_inventory === false) {
    throw new StockWriteOffError('not_tracked', row.product.name);
  }
  if (normalizeStockAdjustment(row.adjustmentQuantity) > 0) {
    throw new StockWriteOffError('positive_adjustment', row.product.name);
  }

  const quantity = normalizeStockCount(writeOff.quantity);
  const previous = rowWriteOff(row)?.quantity ?? 0;
  const available = maxWriteOffQuantity(row);
  if (quantity > available) {
    throw new StockWriteOffError('exceeds_stock', row.product.name, available);
  }

  return {
    ...row,
    adjustmentQuantity: String(-quantity),
    adjustmentReason: quantity > 0 ? formatWriteOffReason(writeOff.kind, writeOff.note) : '',
    closingStock: String(normalizeStockCount(row.closingStock) - (quantity - previous)),
  };
}

export interface StockWriteOffCountRow {
  date: string;
  product_id: string;
  adjustment_quantity: number | string | null;
  adjustment_reason: string | null;
  cost_price: number | string | null;
  products?: { name: string | null } | null;
}

export interface StockWriteOffEntry {
  date: string;
  productId: string;
  productName: string;
  kind: StockWriteOffReportKind;
  note: string;
  quantity: number;
  /** quantity × the count's saved cost price. */
  cost: number;
}

export interface StockWriteOffTotals {
  quantity: number;
  cost: number;
}

export interface StockWriteOffSummary {
  entries: StockWriteOffEntry[];
  total: StockWriteOffTotals;
  byKind: Record<StockWriteOffReportKind, StockWriteOffTotals>;
}

/** Newest first; every negative adjustment counts, older free-text ones as "other". */
export function summarizeStockWriteOffs(rows: StockWriteOffCountRow[]): StockWriteOffSummary {
  const empty = (): StockWriteOffTotals => ({ quantity: 0, cost: 0 });
  const summary: StockWriteOffSummary = {
    entries: [],
    total: empty(),
    byKind: { shortage: empty(), expired: empty(), other: empty() },
  };

  for (const row of rows) {
    const adjustment = normalizeStockAdjustment(row.adjustment_quantity);
    if (adjustment >= 0) continue;
    const quantity = -adjustment;
    const cost = quantity * (Number(row.cost_price ?? 0) || 0);
    const { kind, note } = parseWriteOffReason(row.adjustment_reason);
    summary.entries.push({
      date: row.date,
      productId: row.product_id,
      productName: row.products?.name ?? '',
      kind,
      note,
      quantity,
      cost,
    });
    for (const totals of [summary.total, summary.byKind[kind]]) {
      totals.quantity += quantity;
      totals.cost += cost;
    }
  }

  summary.entries.sort((a, b) => b.date.localeCompare(a.date) || a.productName.localeCompare(b.productName));
  return summary;
}
