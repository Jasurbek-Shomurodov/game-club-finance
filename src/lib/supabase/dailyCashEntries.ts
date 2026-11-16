import type { SupabaseClient } from '@supabase/supabase-js';
import { isDayCollectedError } from './dailyCashCollections';
import { isInsufficientBalanceError } from './errors';

export type DailyCashDeletion = 'deleted' | 'not_found' | 'day_closed' | 'already_spent' | 'failed';

/**
 * Deletes one club's daily cash entry. `not_found` means RLS filtered it out
 * (no permission, wrong club) or it is gone; `day_closed` that its date was
 * ticked as collected (097); `already_spent` that its money was already spent
 * or exchanged, so a method would go negative (146); `failed` any other
 * database fault. Callers never
 * report a delete that did not happen.
 */
export async function deleteDailyCashEntry(supabase: SupabaseClient, clubId: string, entryId: string): Promise<DailyCashDeletion> {
  const { data, error } = await supabase
    .from('daily_cash_entries')
    .delete()
    .eq('club_id', clubId)
    .eq('id', entryId)
    .select('id');
  if (error) {
    if (isDayCollectedError(error)) return 'day_closed';
    return isInsufficientBalanceError(error) ? 'already_spent' : 'failed';
  }
  return (data ?? []).length > 0 ? 'deleted' : 'not_found';
}
