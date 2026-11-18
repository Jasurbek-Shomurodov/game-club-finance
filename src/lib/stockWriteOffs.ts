import { STOCK_CORRECTION_REASON_PATTERN, STOCK_WRITE_OFF_REASON_PATTERN } from './calculations/stock';
import {
  normalizeStockAdjustment,
  normalizeStockCount,
  type ClosingStockRowData,
} from './closingStock';

/**
 * Bar write-offs: units that left stock without a sale because they went
 * missing (kamomad) or spoiled (eskirgan). A write-off is recorded through the
 * inventory adjustment of the day's stock count as a negative adjustment whose
 * reason carries the kind:
 *
 *   adjustment_quantity = -quantity
 *   adjustment_reason   = "shortage" | "expired" [": note"]
 *
 * The units leave the closing balance and sales stay as recorded, so bar income
 * is not charged for them. Their value at cost is added to bar cost (so bar
 * profit falls by it, migration 141) and shown as the loss in reports.
 *
 * A correction is the opposite case: more units were counted than the system
 * expected. It is saved as a positive adjustment whose reason is
 * "correction" [": note"] (migration 167). The units join the closing balance;
 * sales, bar cost and bar profit are unchanged.
 */
export const STOCK_WRITE_OFF_KINDS = ['shortage', 'expired'] as const;
export type StockWriteOffKind = (typeof STOCK_WRITE_OFF_KINDS)[number];
/** A negative adjustment saved before write-offs existed, with a free-text reason. */
export type StockWriteOffReportKind = StockWriteOffKind | 'other';
/** The kinds the write-off dialog records: the two losses and a surplus correction. */
export const STOCK_ADJUSTMENT_KINDS = [...STOCK_WRITE_OFF_KINDS, 'correction'] as const;
export type StockAdjustmentKind = (typeof STOCK_ADJUSTMENT_KINDS)[number];
export type StockAdjustmentReportKind = StockAdjustmentKind | 'other';

export function formatWriteOffReason(kind: StockAdjustmentKind, note = ''): string {
  const trimmed = note.trim();
  return trimmed ? `${kind}: ${trimmed}` : kind;
}

/** Reason of a positive adjustment: "correction" or an older free-text one ("other"). */
export function parseCorrectionReason(reason: string | null | undefined): { kind: 'correction' | 'other'; note: string } {
  const text = String(reason ?? '').trim();
  const match = STOCK_CORRECTION_REASON_PATTERN.exec(text);
  if (!match) return { kind: 'other', note: text };
  return { kind: 'correction', note: (match[1] ?? '').trim() };
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

export interface RowStockAdjustment {
  /** Units, always positive; a correction adds them, a write-off removes them. */
  quantity: number;
  kind: StockAdjustmentReportKind;
  note: string;
  /** +1 for a correction (or an older positive adjustment), -1 for a write-off. */
  sign: 1 | -1;
}

/** The write-off a row carries; `null` when its adjustment is not a removal. */
export function rowWriteOff(row: Pick<ClosingStockRowData, 'adjustmentQuantity' | 'adjustmentReason'>): RowWriteOff | null {
  const adjustment = normalizeStockAdjustment(row.adjustmentQuantity);
  if (adjustment >= 0) return null;
  return { quantity: -adjustment, ...parseWriteOffReason(row.adjustmentReason) };
}

/** The write-off or correction a row carries; `null` when it has no adjustment. */
export function rowStockAdjustment(row: Pick<ClosingStockRowData, 'adjustmentQuantity' | 'adjustmentReason'>): RowStockAdjustment | null {
  const adjustment = normalizeStockAdjustment(row.adjustmentQuantity);
  if (adjustment === 0) return null;
  if (adjustment < 0) return { quantity: -adjustment, sign: -1, ...parseWriteOffReason(row.adjustmentReason) };
  return { quantity: adjustment, sign: 1, ...parseCorrectionReason(row.adjustmentReason) };
}

/**
 * Whether setting a row's write-off or correction to `next` only records one
 * or adds to it: the change an admin may make (migrations 164 and 167).
 * Reducing or removing one, switching its reason, or replacing another
 * adjustment stays with the owner. Mirrors `stock_write_off_is_addition` in
 * the database.
 */
export function isWriteOffAddition(
  current: { kind: StockAdjustmentReportKind; quantity: number; note?: string } | null,
  next: { kind: StockAdjustmentKind; quantity: number },
): boolean {
  if (next.quantity <= 0) return false;
  if (!current) return true;
  return current.kind === next.kind && next.quantity >= current.quantity;
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

/** Closing stock the row would have without its current adjustment (never below 0). */
function unadjustedClosingStock(row: ClosingStockRowData): number {
  return Math.max(0, normalizeStockCount(row.closingStock) - normalizeStockAdjustment(row.adjustmentQuantity));
}

/** Most units a row can write off: what is left once its current adjustment is taken back. */
export function maxWriteOffQuantity(row: ClosingStockRowData): number {
  return unadjustedClosingStock(row);
}

/**
 * Sets the row's write-off or correction to `quantity` (0 removes it). A
 * write-off takes the units out of closing stock, a correction adds them; the
 * sold quantity is unchanged, so the stock movement still balances in both
 * entry modes.
 */
export function applyStockWriteOff(
  row: ClosingStockRowData,
  writeOff: { kind: StockAdjustmentKind; quantity: number; note?: string },
): ClosingStockRowData {
  if (row.product.tracks_inventory === false) {
    throw new StockWriteOffError('not_tracked', row.product.name);
  }
  // An older free-text positive adjustment is the owner's to change on Closing Stock.
  if (rowStockAdjustment(row)?.sign === 1 && rowStockAdjustment(row)?.kind === 'other') {
    throw new StockWriteOffError('positive_adjustment', row.product.name);
  }

  const quantity = normalizeStockCount(writeOff.quantity);
  const base = unadjustedClosingStock(row);
  const isCorrection = writeOff.kind === 'correction';
  if (!isCorrection && quantity > base) {
    throw new StockWriteOffError('exceeds_stock', row.product.name, base);
  }
  const signed = isCorrection ? quantity : -quantity;

  return {
    ...row,
    adjustmentQuantity: String(quantity > 0 ? signed : 0),
    adjustmentReason: quantity > 0 ? formatWriteOffReason(writeOff.kind, writeOff.note) : '',
    closingStock: String(base + (quantity > 0 ? signed : 0)),
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

/** Stable list key: one count row per product per day, so date and product identify a write-off. */
export function writeOffEntryKey(entry: Pick<StockWriteOffEntry, 'date' | 'productId'>): string {
  return `${entry.date}:${entry.productId}`;
}

/** Badge tone for a write-off's reason: shortages read as danger, expiry as a warning, corrections as success. */
export function writeOffKindVariant(kind: StockAdjustmentReportKind): 'danger' | 'warning' | 'success' | 'neutral' {
  if (kind === 'shortage') return 'danger';
  if (kind === 'expired') return 'warning';
  if (kind === 'correction') return 'success';
  return 'neutral';
}

/** Cost price per unit the write-off was valued at, or null when no units were written off. */
export function writeOffUnitCost(entry: Pick<StockWriteOffEntry, 'cost' | 'quantity'>): number | null {
  return entry.quantity > 0 ? entry.cost / entry.quantity : null;
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

/**
 * Asks the server to tell the club's Telegram group about the write-off just
 * saved for this product and day; the server reads the saved count itself.
 */
export async function notifyStockWriteOff(clubId: string, date: string, productId: string): Promise<void> {
  try {
    await fetch('/api/stock-write-offs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clubId, date, productId }),
    });
  } catch {
    // Notices are best-effort.
  }
}
