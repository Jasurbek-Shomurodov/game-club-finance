/**
 * Classifies errors raised by the inventory RPCs (`save_closing_stock_counts`,
 * `record_stock_write_off`, `record_stock_purchase`, `delete_stock_purchase`)
 * so pages can show a translated message instead of a raw database string.
 */
export type StockWriteErrorKind =
  | 'permission'
  | 'adminPastDate'
  | 'adjustmentOwnerOnly'
  | 'futureDate'
  | 'productUnavailable'
  | 'laterCountInvalid'
  | 'closedDay'
  | 'insufficientStock'
  | 'writeOffExceedsStock'
  | 'writeOffHasAdjustment'
  | 'notFound'
  | 'invalid'
  | 'unknown';

export interface StockWriteErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export function classifyStockWriteError(error: StockWriteErrorLike | null | undefined): StockWriteErrorKind {
  const code = error?.code ?? '';
  const message = (error?.message ?? '').toLowerCase();

  switch (code) {
    case '42501':
      if (message.includes('admins can only')) return 'adminPastDate';
      if (message.includes('adjustment')) return 'adjustmentOwnerOnly';
      return 'permission';
    case '22008':
      return 'futureDate';
    case '23503':
      return 'productUnavailable';
    case '55000':
      return 'closedDay';
    case 'P0002':
      return 'notFound';
    case '23514':
      // record_stock_write_off (188) checks the saved count, not the page's copy.
      if (error?.hint === 'write_off_exceeds_stock') return 'writeOffExceedsStock';
      if (error?.hint === 'write_off_has_adjustment') return 'writeOffHasAdjustment';
      if (message.includes('historical change')) return 'laterCountInvalid';
      if (message.includes('archived')) return 'productUnavailable';
      if (message.includes('current stock is lower')) return 'insufficientStock';
      return 'invalid';
    case '22023':
    case '22P02':
      return 'invalid';
    default:
      return 'unknown';
  }
}

/**
 * Units the saved count still had for a write-off the database refused as too
 * large (`write_off_exceeds_stock` carries them in its detail), or null.
 */
export function writeOffAvailableQuantity(error: StockWriteErrorLike | null | undefined): number | null {
  if (error?.hint !== 'write_off_exceeds_stock') return null;
  const available = Number(error.details);
  return Number.isFinite(available) && available >= 0 ? available : null;
}
