import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntryAuditLog } from '@/types';
import { isMissingDatabaseTable } from './errors';
import { fetchAllRows } from './pagination';

export interface EntryHistory {
  logs: EntryAuditLog[];
  /** Author names by user id. */
  names: Map<string, string>;
  /** Product names by id, archived products included. */
  products: Map<string, string>;
  /** The database has no history yet (migration 111 not applied). */
  missing: boolean;
}

/**
 * One club's edit and delete history for business dates `from`..`to`, newest
 * first, with the names it mentions. Owner-only through RLS; every query is
 * club-scoped anyway.
 */
export async function fetchEntryHistory(
  supabase: SupabaseClient,
  clubId: string,
  from: string,
  to: string,
): Promise<EntryHistory> {
  const result = await fetchAllRows<EntryAuditLog>(() => supabase
    .from('entry_audit_logs')
    .select('*')
    .eq('club_id', clubId)
    .gte('changed_on', from)
    .lte('changed_on', to)
    .order('changed_on', { ascending: false })
    .order('id', { ascending: false }));
  if (result.error) {
    if (isMissingDatabaseTable(result.error, 'entry_audit_logs')) {
      return { logs: [], names: new Map(), products: new Map(), missing: true };
    }
    throw new Error(result.error.message);
  }
  const logs = result.data ?? [];

  const userIds = [...new Set(logs.flatMap((log) => [log.changed_by, log.old_row.created_by])
    .filter((id): id is string => typeof id === 'string'))];
  const productIds = [...new Set(logs.map((log) => log.old_row.product_id)
    .filter((id): id is string => typeof id === 'string'))];

  const [profiles, products] = await Promise.all([
    userIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', userIds)
      : Promise.resolve({ data: [], error: null }),
    productIds.length
      ? supabase.from('products').select('id, name').eq('club_id', clubId).in('id', productIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profiles.error) throw new Error(profiles.error.message);
  if (products.error) throw new Error(products.error.message);

  return {
    logs,
    names: new Map((profiles.data ?? []).map((row: { id: string; full_name: string }) => [row.id, row.full_name])),
    products: new Map((products.data ?? []).map((row: { id: string; name: string }) => [row.id, row.name])),
    missing: false,
  };
}
