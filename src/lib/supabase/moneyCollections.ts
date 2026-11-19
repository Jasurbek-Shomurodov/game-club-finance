import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseCollectedMoneyMoves,
  parseCollectionBalances,
  type CollectedMethod,
  type CollectedMoneyMove,
  type CollectionBalances,
} from '@/lib/calculations/collectedMoney';
import { isMissingDatabaseFunction } from './errors';

/**
 * Collections and what collected money paid between two dates (169). Before
 * migration 169 nothing has been collected.
 */
export async function fetchCollectedMoneyMoves(
  supabase: SupabaseClient,
  clubId: string,
  from: string,
  to: string,
): Promise<CollectedMoneyMove[]> {
  const { data, error } = await supabase.rpc('get_collected_money_moves', { p_club_id: clubId, p_from: from, p_to: to });
  if (error) {
    if (isMissingDatabaseFunction(error, 'get_collected_money_moves')) return [];
    throw new Error(error.message);
  }
  return parseCollectedMoneyMoves(data);
}

/** What the till and collected money can give per method on a day; null before migration 169. */
export async function fetchCollectionBalances(
  supabase: SupabaseClient,
  clubId: string,
  date: string,
): Promise<CollectionBalances | null> {
  const { data, error } = await supabase.rpc('get_collection_balances', { p_club_id: clubId, p_date: date });
  if (error) {
    if (isMissingDatabaseFunction(error, 'get_collection_balances')) return null;
    throw new Error(error.message);
  }
  return parseCollectionBalances(data);
}

/** Owner: give a collection back to the till. */
export async function deleteMoneyCollection(supabase: SupabaseClient, clubId: string, requestId: string) {
  return supabase.rpc('delete_money_collection', { p_club_id: clubId, p_request_id: requestId });
}

/** Owner: move collected money into the reserve on a day. */
export async function moveCollectedToReserve(
  supabase: SupabaseClient,
  input: { clubId: string; id: string; date: string; method: CollectedMethod; amount: number; comment: string | null },
) {
  return supabase.rpc('move_collected_to_reserve', {
    p_club_id: input.clubId,
    p_id: input.id,
    p_date: input.date,
    p_payment_method: input.method,
    p_amount: input.amount,
    p_comment: input.comment,
  });
}

/** The 169 refusal: collected money does not hold that much. */
export function isCollectedInsufficientError(error: { hint?: string | null; message?: string | null } | null | undefined): boolean {
  return Boolean(error) && (error?.hint === 'COLLECTED_INSUFFICIENT' || /insufficient collected money/i.test(error?.message ?? ''));
}
