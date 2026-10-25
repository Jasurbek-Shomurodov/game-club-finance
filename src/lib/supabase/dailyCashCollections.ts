import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingDatabaseTable } from './errors';
import { fetchAllRows } from './pagination';

/** A business date a collector ticked as collected (096). */
export interface DailyCashCollection {
  date: string;
  collected_by: string;
  collected_at: string;
  collector_name: string | null;
}

/**
 * A club's collected dates within [from, to], with the collector's name.
 * Before migration 096 the table does not exist and nothing is collected.
 */
export async function fetchDailyCashCollections(
  supabase: SupabaseClient,
  clubId: string,
  from: string,
  to: string,
): Promise<DailyCashCollection[]> {
  const result = await fetchAllRows<Omit<DailyCashCollection, 'collector_name'>>(() => supabase
    .from('daily_cash_collections')
    .select('date,collected_by,collected_at')
    .eq('club_id', clubId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true }));
  if (result.error) {
    if (isMissingDatabaseTable(result.error, 'daily_cash_collections')) return [];
    throw result.error;
  }
  const rows = result.data ?? [];
  const ids = Array.from(new Set(rows.map((row) => row.collected_by)));
  if (ids.length === 0) return [];
  const profiles = await supabase.from('profiles').select('id,full_name').in('id', ids);
  if (profiles.error) throw profiles.error;
  const names = new Map(((profiles.data ?? []) as Array<{ id: string; full_name: string }>)
    .map((profile) => [profile.id, profile.full_name]));
  return rows.map((row) => ({ ...row, collector_name: names.get(row.collected_by) ?? null }));
}

/** The 097 refusal: the date was ticked as collected, so its money is closed. */
export function isDayCollectedError(error: { code?: string | null; message?: string | null; hint?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.hint === 'day_collected' || /this day is closed/i.test(error.message ?? '');
}

/** Whether a club's business date has been ticked as collected. False before migration 096. */
export async function fetchIsDateCollected(supabase: SupabaseClient, clubId: string, date: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('daily_cash_collections')
    .select('date')
    .eq('club_id', clubId)
    .eq('date', date)
    .maybeSingle();
  if (error) {
    if (isMissingDatabaseTable(error, 'daily_cash_collections')) return false;
    throw error;
  }
  return Boolean(data);
}
