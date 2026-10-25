import { isDayCollectedError } from '@/lib/supabase/dailyCashCollections';

/**
 * Stable error codes returned by /api/exchanges. The browser maps each code to
 * a translated message; raw database text is only logged on the server.
 */
export const EXCHANGE_ERROR_CODES = [
  'UNAUTHORIZED',
  'INVALID_REQUEST',
  'FORBIDDEN',
  'PAYMENT_METHOD_DISABLED',
  'REQUEST_CONFLICT',
  'NOT_FOUND',
  'NOT_AVAILABLE',
  'DAY_COLLECTED',
  'SERVER_ERROR',
] as const;

export type ExchangeErrorCode = (typeof EXCHANGE_ERROR_CODES)[number];

const ERRORS: Record<ExchangeErrorCode, { status: number; text: string }> = {
  UNAUTHORIZED: { status: 401, text: 'Unauthorized' },
  INVALID_REQUEST: { status: 400, text: 'Invalid exchange data' },
  FORBIDDEN: { status: 403, text: 'Forbidden' },
  PAYMENT_METHOD_DISABLED: { status: 400, text: 'Payment method is not enabled for this club' },
  REQUEST_CONFLICT: { status: 409, text: 'This request was already used for a different exchange' },
  NOT_FOUND: { status: 404, text: 'Exchange not found' },
  NOT_AVAILABLE: { status: 503, text: 'Exchanges are not set up in the database yet' },
  DAY_COLLECTED: { status: 409, text: 'The money for this day was collected; the day is closed' },
  SERVER_ERROR: { status: 500, text: 'Exchange failed' },
};

/** Maps a database error to a stable code; anything unrecognised is a server fault. */
export function exchangeErrorCode(error: { code?: string | null; message?: string | null; hint?: string | null }): ExchangeErrorCode {
  const message = error.message ?? '';
  // The 097 trigger: the exchange's day was collected, so the day is closed.
  if (isDayCollectedError(error)) return 'DAY_COLLECTED';
  if (/not enabled for this club/i.test(message)) return 'PAYMENT_METHOD_DISABLED';
  if (/could not find the function|does not exist/i.test(message) || error.code === 'PGRST202') return 'NOT_AVAILABLE';
  if (error.code === '42501') return 'FORBIDDEN';
  if (error.code === '23505') return 'REQUEST_CONFLICT';
  if (error.code === 'P0002') return 'NOT_FOUND';
  if (error.code === 'P0001' || error.code === '22007' || error.code === '22008') return 'INVALID_REQUEST';
  return 'SERVER_ERROR';
}

export function exchangeErrorResponse(code: ExchangeErrorCode) {
  const { status, text } = ERRORS[code];
  return Response.json({ error: text, code }, { status });
}
