import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { fetchProfileNames } from '@/lib/supabase/profileNames';
import type { SalaryDailyIncome, SalaryEmployee, SalaryEntry, SalaryProfitMonth, SalaryRate } from '@/lib/calculations/salaries';

type Db = ReturnType<typeof createClient>;

const entriesQuery = (db: Db, clubId: string, throughDate: string) =>
  fetchAllRows<SalaryEntry>(() => db.from('salary_entries').select('*').eq('club_id', clubId).lte('date', throughDate).order('id'));

/**
 * Names of the people who deleted these records, by user id. `deleted_by`
 * references auth.users, so the names come from a separate profiles read.
 */
async function loadDeleterNames(db: Db, records: { deleted_by?: string | null }[]): Promise<Record<string, string>> {
  const names = await fetchProfileNames(db, records.map((record) => record.deleted_by));
  return Object.fromEntries(Array.from(names)
    .filter((entry): entry is [string, string] => Boolean(entry[1]?.trim()))
    .map(([id, name]) => [id, name.trim()]));
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
    // Absent before migration 134; only the game_club_income KPI basis uses it.
    dailyIncome: (profit.data as { dailyGameClubIncome?: SalaryDailyIncome[] } | null)?.dailyGameClubIncome ?? [],
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
