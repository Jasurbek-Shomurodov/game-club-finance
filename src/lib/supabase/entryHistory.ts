import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntryAuditLog } from '@/types';
import { AUDIT_CREATION_TABLES, AUDITED_TABLES, auditReferencedIds } from '@/lib/entryHistory';
import { isMissingDatabaseTable } from './errors';
import { fetchAllRows } from './pagination';
import { fetchProfileNames } from './profileNames';

export interface EntryHistory {
  logs: EntryAuditLog[];
  /** Author and team member names by user id. */
  names: Map<string, string>;
  /** Product names by id, archived products included. */
  products: Map<string, string>;
  /** Salary employee names by id. */
  employees: Map<string, string>;
  /** The database has no history yet (migration 111 not applied). */
  missing: boolean;
}

type NamedRow = { id: string; name: string };
const named = (rows: NamedRow[] | null) => new Map((rows ?? []).map((row) => [row.id, row.name]));

/**
 * One club's history for business dates `from`..`to`, newest first, with the
 * names it mentions: every edit and delete of the record types /history
 * labels, and the creations it shows (AUDIT_CREATION_TABLES). Owner-only
 * through RLS; every query is club-scoped anyway.
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
    .in('table_name', [...AUDITED_TABLES])
    .or(`action.neq.insert,table_name.in.(${AUDIT_CREATION_TABLES.join(',')})`)
    .gte('changed_on', from)
    .lte('changed_on', to)
    .order('changed_on', { ascending: false })
    .order('id', { ascending: false }));
  if (result.error) {
    if (isMissingDatabaseTable(result.error, 'entry_audit_logs')) {
      return { logs: [], names: new Map(), products: new Map(), employees: new Map(), missing: true };
    }
    throw new Error(result.error.message);
  }
  const logs = result.data ?? [];
  const ids = auditReferencedIds(logs);

  const [profiles, products, employees] = await Promise.all([
    fetchProfileNames(supabase, ids.users).then(
      (data) => ({ data, error: null }),
      (error: { message: string }) => ({ data: new Map<string, string | null>(), error }),
    ),
    ids.products.length
      ? supabase.from('products').select('id, name').eq('club_id', clubId).in('id', ids.products)
      : Promise.resolve({ data: [], error: null }),
    ids.employees.length
      ? supabase.from('salary_employees').select('id, name').eq('club_id', clubId).in('id', ids.employees)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profiles.error) throw new Error(profiles.error.message);
  if (products.error) throw new Error(products.error.message);
  if (employees.error) throw new Error(employees.error.message);

  return {
    logs,
    names: new Map(Array.from(profiles.data).map(([id, name]) => [id, name ?? ''])),
    products: named(products.data as NamedRow[] | null),
    employees: named(employees.data as NamedRow[] | null),
    missing: false,
  };
}
