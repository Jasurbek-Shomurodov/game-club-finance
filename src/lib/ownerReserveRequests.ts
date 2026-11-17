import type { ReserveErrorCode } from '@/lib/supabase/ownerReserve';
import type { OwnerWithdrawalPaymentMethod, OwnerWithdrawalSource } from '@/types';

/**
 * Browser side of /api/reserve. Reserve changes go through the server so the
 * club's Telegram group hears about every deposit, return and deletion.
 */

const CODES: readonly ReserveErrorCode[] = ['exceeds_available', 'insufficient', 'already_used', 'migration_required', 'forbidden', 'failed'];

async function send(method: 'POST' | 'DELETE', body: unknown): Promise<ReserveErrorCode | null> {
  const response = await fetch('/api/reserve', {
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
  source: OwnerWithdrawalSource;
  comment: string;
  /** One per Game Club method (Bar: a single part without a method). */
  parts: Array<{ id: string; method: OwnerWithdrawalPaymentMethod | null; amount: number }>;
}

export const requestReserveMove = (clubId: string, move: ReserveMoveRequest) => send('POST', { clubId, ...move });

export const requestReserveDelete = (clubId: string, entryId: string) => send('DELETE', { clubId, entryId });
