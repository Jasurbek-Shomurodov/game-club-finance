import type { SupabaseClient } from '@supabase/supabase-js';
import { parseReserveMoves, type ReserveMove } from '@/lib/calculations/reserveMoves';
import { isMissingDatabaseFunction } from './errors';

/**
 * Money moved into or out of the owner reserve between two dates (156), for
 * screens that keep the reserve out of money left. Any club member may read
 * it; before migration 156 there is nothing to read, so nothing moves.
 */
export async function fetchReserveMoves(
  supabase: SupabaseClient,
  clubId: string,
  from: string,
  to: string,
): Promise<ReserveMove[]> {
  const { data, error } = await supabase.rpc('get_reserve_moves', { p_club_id: clubId, p_from: from, p_to: to });
  if (error) {
    if (isMissingDatabaseFunction(error, 'get_reserve_moves')) return [];
    throw new Error(error.message);
  }
  return parseReserveMoves(data);
}
