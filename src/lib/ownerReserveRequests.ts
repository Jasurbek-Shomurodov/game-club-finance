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

type ReserveMovePart = ReserveMoveRequest['parts'][number];

export interface ReserveMovePartsResult {
  /** Parts stored by this request (a retried one included), in the order sent. */
  saved: ReserveMovePart[];
  /** Parts refused, each with its reason. */
  failed: Array<ReserveMovePart & { failure: ReserveErrorCode }>;
}

/**
 * Sends a move of several parts ("Put all in") and says which parts were
 * stored and which were refused, so the page can name both. A reply without
 * the part lists (a refused request as a whole) refuses every part with its
 * code. A request that never got an answer throws: what it stored is unknown.
 */
export async function requestReserveMoveParts(clubId: string, move: ReserveMoveRequest): Promise<ReserveMovePartsResult> {
  const response = await mutateFinanceRequest('/api/reserve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clubId, ...move }),
  });
  const payload = await response.json().catch(() => null) as { failure?: unknown; saved?: unknown; failed?: unknown } | null;
  const code = (value: unknown): ReserveErrorCode => (CODES.includes(value as ReserveErrorCode) ? value as ReserveErrorCode : 'failed');
  if (!Array.isArray(payload?.saved) || !Array.isArray(payload?.failed)) {
    return response.ok
      ? { saved: [...move.parts], failed: [] }
      : { saved: [], failed: move.parts.map((part) => ({ ...part, failure: code(payload?.failure) })) };
  }
  // The parts as sent, matched by id: the reply only names them.
  const listed = (value: unknown[]) => new Map(value.map((item) => {
    const row = item as { id?: unknown; failure?: unknown } | null;
    return [typeof row?.id === 'string' ? row.id : '', row?.failure] as const;
  }));
  const saved = listed(payload.saved);
  const failed = listed(payload.failed);
  return {
    saved: move.parts.filter((part) => saved.has(part.id)),
    failed: move.parts.filter((part) => failed.has(part.id)).map((part) => ({ ...part, failure: code(failed.get(part.id)) })),
  };
}

export interface ReserveDepositByMethodResult {
  /** The methods stored by this call, in the order sent. */
  saved: OwnerWithdrawalPaymentMethod[];
  /** The method that was refused (or whose request failed) and why; null when every part was stored. */
  failure: { method: OwnerWithdrawalPaymentMethod; code: ReserveErrorCode } | null;
}

/**
 * A Game Club deposit split by method, sent as one request per method, one
 * after another, stopping at the first refusal. /api/reserve stores the parts
 * of one request in order and keeps those before a refusal, so one request per
 * method lets the form know exactly which parts are stored. Each part keeps its
 * own id, so a retried method is stored once. `onSaved` hears each stored part
 * as it lands. The group gets one Telegram notice per method.
 */
export async function requestReserveDepositByMethod(
  clubId: string,
  deposit: Omit<ReserveMoveRequest, 'kind' | 'source' | 'parts'> & {
    parts: Array<{ id: string; method: OwnerWithdrawalPaymentMethod; amount: number }>;
  },
  onSaved?: (method: OwnerWithdrawalPaymentMethod) => void,
): Promise<ReserveDepositByMethodResult> {
  const { parts, ...move } = deposit;
  const saved: OwnerWithdrawalPaymentMethod[] = [];
  for (const part of parts) {
    let code: ReserveErrorCode | null;
    try {
      code = await requestReserveMove(clubId, { ...move, kind: 'deposit', source: 'game_club', parts: [part] });
    } catch {
      // The request may or may not have arrived; its id is kept, so a retry is stored once.
      code = 'failed';
    }
    if (code) return { saved, failure: { method: part.method, code } };
    saved.push(part.method);
    onSaved?.(part.method);
  }
  return { saved, failure: null };
}

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

/** Undoes an exchange inside the reserve, both halves; /api/exchanges replies to its Telegram message with the deletion notice. */
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

/** Deletes a purchase the reserve paid; its money is the reserve's again. /api/expenses replies to its Telegram message with the deletion notice. */
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
