import { mutateFinanceRequest } from '@/lib/supabase/client';
import type { ReserveErrorCode } from '@/lib/supabase/ownerReserve';
import type { OwnerWithdrawalPaymentMethod, OwnerWithdrawalSource } from '@/types';

/**
 * Browser side of /api/reserve. Reserve changes go through the server so the
 * club's Telegram group hears about every deposit, return and deletion.
 * mutateFinanceRequest clears the browser read cache, so the reload after a
 * move shows it.
 */

const CODES: readonly ReserveErrorCode[] = [
  'exceeds_available', 'insufficient', 'day_balance', 'already_used', 'day_collected', 'note_required', 'method_disabled',
  'migration_required', 'forbidden', 'failed',
];

async function send(method: 'POST' | 'DELETE', body: unknown, path = '/api/reserve'): Promise<ReserveErrorCode | null> {
  const response = await mutateFinanceRequest(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.ok) return null;
  const payload = await response.json().catch(() => null) as { failure?: unknown } | null;
  return CODES.includes(payload?.failure as ReserveErrorCode) ? payload?.failure as ReserveErrorCode : 'failed';
}

export interface ReserveMoveRequest {
  kind: 'deposit' | 'return';
  /** YYYY-MM whose owner profit the money leaves (deposit) or joins (return). */
  month: string;
  /** YYYY-MM-DD in `month`: the day the money moved. Omitted: the day it is recorded. */
  date?: string | null;
  source: OwnerWithdrawalSource;
  comment: string;
  /** One per Game Club method (Bar: a single part without a method). */
  parts: Array<{ id: string; method: OwnerWithdrawalPaymentMethod | null; amount: number }>;
}

export const requestReserveMove = (clubId: string, move: ReserveMoveRequest) => send('POST', { clubId, ...move });

export const requestReserveDelete = (clubId: string, entryId: string) => send('DELETE', { clubId, entryId });

export interface ReserveExchangeRequest {
  /** One pair of ids per exchange being entered, so a retried submit is stored once. */
  id: string;
  entryId: string;
  date: string;
  direction: 'buy' | 'sell';
  method: 'cash' | 'terminal' | 'card';
  /** Sums for a buy, dollars for a sell. */
  amount: number;
  rate: number;
  comment: string;
}

/** Buys or sells dollars with the reserve's own sums (170). */
export const requestReserveExchange = (clubId: string, exchange: ReserveExchangeRequest) => send('POST', { clubId, ...exchange }, '/api/reserve/exchange');

/** Exchange codes from /api/exchanges, as the reserve names them. */
const EXCHANGE_FAILURES: Record<string, ReserveErrorCode> = {
  RESERVE_USED: 'already_used',
  INSUFFICIENT_BALANCE: 'day_balance',
  DAY_COLLECTED: 'day_collected',
  FORBIDDEN: 'forbidden',
  UNAUTHORIZED: 'forbidden',
};

/** Undoes an exchange inside the reserve, both halves; /api/exchanges also removes its Telegram message. */
export async function requestReserveExchangeDelete(clubId: string, exchangeId: string): Promise<ReserveErrorCode | null> {
  const response = await mutateFinanceRequest('/api/exchanges', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clubId, exchangeId }),
  });
  if (response.ok) return null;
  const payload = await response.json().catch(() => null) as { code?: unknown } | null;
  return EXCHANGE_FAILURES[String(payload?.code)] ?? 'failed';
}

/** Expense codes from /api/expenses, as the reserve names them. */
const PURCHASE_FAILURES: Record<string, ReserveErrorCode> = {
  DAY_COLLECTED: 'day_collected',
  FORBIDDEN: 'forbidden',
  UNAUTHORIZED: 'forbidden',
};

/** Deletes a purchase the reserve paid; its money is the reserve's again. /api/expenses also removes its Telegram message. */
export async function requestReservePurchaseDelete(clubId: string, expenseId: string): Promise<ReserveErrorCode | null> {
  const response = await mutateFinanceRequest('/api/expenses', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clubId, expenseId }),
  });
  if (response.ok) return null;
  const payload = await response.json().catch(() => null) as { code?: unknown } | null;
  return PURCHASE_FAILURES[String(payload?.code)] ?? 'failed';
}
