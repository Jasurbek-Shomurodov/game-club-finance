import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingDatabaseFunction } from './errors';
import type { OwnerWithdrawalPaymentMethod, OwnerWithdrawalSource } from '@/types';

export type ReserveErrorCode =
  | 'exceeds_available'
  | 'insufficient'
  | 'already_used'
  | 'migration_required'
  | 'forbidden'
  | 'failed';

export function reserveErrorCode(error: { code?: string | null; message?: string | null; hint?: string | null }, rpcName: string): ReserveErrorCode {
  if (isMissingDatabaseFunction(error as { code?: string; message?: string }, rpcName)) return 'migration_required';
  if (error.hint === 'reserve_exceeds_available') return 'exceeds_available';
  if (error.hint === 'reserve_insufficient') return 'insufficient';
  if (error.hint === 'reserve_already_used') return 'already_used';
  if (error.code === '42501') return 'forbidden';
  return 'failed';
}

export interface ReserveMoveInput {
  id: string;
  /** YYYY-MM whose owner profit the money leaves (deposit) or joins (return). */
  month: string;
  source: OwnerWithdrawalSource;
  /** Game Club only. */
  method: OwnerWithdrawalPaymentMethod | null;
  amount: number;
  comment: string;
}

async function move(supabase: SupabaseClient, clubId: string, rpcName: string, input: ReserveMoveInput): Promise<ReserveErrorCode | null> {
  const { error } = await supabase.rpc(rpcName, {
    p_club_id: clubId,
    p_id: input.id,
    p_period_month: `${input.month}-01`,
    p_source: input.source,
    p_payment_method: input.source === 'game_club' ? input.method : null,
    p_amount: input.amount,
    p_comment: input.comment.trim() || null,
  });
  return error ? reserveErrorCode(error, rpcName) : null;
}

/** Sets owner profit aside in the reserve instead of withdrawing it. */
export const depositToReserve = (supabase: SupabaseClient, clubId: string, input: ReserveMoveInput) => move(supabase, clubId, 'move_owner_profit_to_reserve', input);

/** Gives reserve money back to a month's owner profit, where it can be withdrawn. */
export const returnFromReserve = (supabase: SupabaseClient, clubId: string, input: ReserveMoveInput) => move(supabase, clubId, 'return_owner_reserve', input);

export async function deleteReserveEntry(supabase: SupabaseClient, clubId: string, entryId: string): Promise<ReserveErrorCode | null> {
  const { error } = await supabase.rpc('delete_owner_reserve_entry', { p_club_id: clubId, p_entry_id: entryId });
  return error ? reserveErrorCode(error, 'delete_owner_reserve_entry') : null;
}

export interface ReserveHoldings {
  game_club: Record<'total' | OwnerWithdrawalPaymentMethod, number>;
  bar: { total: number };
}

/** What the reserve holds, for the expense form. Owners only; null for anyone else or before migration 136. */
export async function fetchReserveHoldings(supabase: SupabaseClient, clubId: string): Promise<ReserveHoldings | null> {
  const { data, error } = await supabase.rpc('get_owner_reserve_balances', { p_club_id: clubId });
  if (error || !data) return null;
  const raw = data as { game_club?: Record<string, number | string>; bar?: Record<string, number | string> };
  const n = (value: number | string | undefined) => Number(value ?? 0);
  return {
    game_club: {
      total: n(raw.game_club?.total),
      cash: n(raw.game_club?.cash),
      terminal: n(raw.game_club?.terminal),
      card: n(raw.game_club?.card),
      playstation: n(raw.game_club?.playstation),
    },
    bar: { total: n(raw.bar?.total) },
  };
}
