import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/pagination';
import type { SalaryEmployee, SalaryEntry, SalaryProfitMonth, SalaryRate } from '@/lib/calculations/salaries';

type Db = ReturnType<typeof createClient>;

const entriesQuery = (db: Db, clubId: string, throughDate: string) =>
  fetchAllRows<SalaryEntry>(() => db.from('salary_entries').select('*').eq('club_id', clubId).lte('date', throughDate).order('id'));

/**
 * Names of the people who deleted these records, by user id. `deleted_by`
 * references auth.users, so the names come from a separate profiles read.
 */
async function loadDeleterNames(db: Db, records: { deleted_by?: string | null }[]): Promise<Record<string, string>> {
  const ids = Array.from(new Set(records.map((record) => record.deleted_by).filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return {};
  const { data, error } = await db.from('profiles').select('id,full_name').in('id', ids);
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as { id: string; full_name: string | null }[])
    .filter((profile) => profile.full_name?.trim())
    .map((profile) => [profile.id, profile.full_name!.trim()]));
}

export async function loadSalaries(clubId: string, throughDate: string) {
  const db = createClient();
  const [employees, rates, entries, profit] = await Promise.all([
    fetchAllRows<SalaryEmployee>(() => db.from('salary_employees').select('*').eq('club_id', clubId).order('id')),
    fetchAllRows<SalaryRate>(() => db.from('salary_rates').select('*').eq('club_id', clubId).order('id')),
    entriesQuery(db, clubId, throughDate),
    db.rpc('get_salary_profit_snapshot', { p_club_id: clubId, p_through_date: throughDate }),
  ]);
  const error = [employees.error, rates.error, entries.error, profit.error].find(Boolean);
  if (error) throw error;
  const deleterNames = await loadDeleterNames(db, [...(rates.data ?? []), ...(entries.data ?? [])]);
  return {
    employees: employees.data ?? [], rates: rates.data ?? [], entries: entries.data ?? [], deleterNames,
    monthlyProfit: (profit.data as { monthlyBalances?: SalaryProfitMonth[] } | null)?.monthlyBalances ?? [],
  };
}

/** Entries only: after recording or deleting an entry, employees, rates and profit are unchanged. */
export async function loadSalaryEntries(clubId: string, throughDate: string): Promise<{ entries: SalaryEntry[]; deleterNames: Record<string, string> }> {
  const db = createClient();
  const result = await entriesQuery(db, clubId, throughDate);
  if (result.error) throw result.error;
  const entries = result.data ?? [];
  return { entries, deleterNames: await loadDeleterNames(db, entries) };
}
