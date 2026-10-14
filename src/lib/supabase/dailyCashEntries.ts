import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Deletes one club's daily cash entry. Resolves `false` when the database
 * rejected the delete or RLS filtered it out (no permission, wrong club), so
 * callers never report a delete that did not happen.
 */
export async function deleteDailyCashEntry(supabase: SupabaseClient, clubId: string, entryId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('daily_cash_entries')
    .delete()
    .eq('club_id', clubId)
    .eq('id', entryId)
    .select('id');
  return !error && (data ?? []).length > 0;
}
