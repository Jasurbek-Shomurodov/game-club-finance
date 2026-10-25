import type { SupabaseClient } from '@supabase/supabase-js';
import type { MoneyExchangeRow } from '@/lib/calculations/moneyExchanges';
import { isMissingDatabaseTable } from './errors';
import { fetchAllRows } from './pagination';

const COLUMNS = 'id,date,from_method,to_method,from_amount,to_amount,rate,comment,created_by,created_at';

/**
 * A club's exchanges dated within [from, to]. Before migration 092 the table
 * does not exist and there are simply no exchanges; other errors are thrown.
 */
export async function fetchMoneyExchanges(
  supabase: SupabaseClient,
  clubId: string,
  from: string,
  to: string,
): Promise<MoneyExchangeRow[]> {
  const result = await fetchAllRows<MoneyExchangeRow>(() => supabase
    .from('money_exchanges')
    .select(COLUMNS)
    .eq('club_id', clubId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
    .order('id', { ascending: true }));
  if (result.error) {
    if (isMissingDatabaseTable(result.error, 'money_exchanges')) return [];
    throw result.error;
  }
  return result.data ?? [];
}
