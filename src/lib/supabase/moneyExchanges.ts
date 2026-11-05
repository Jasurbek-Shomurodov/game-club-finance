import type { SupabaseClient } from '@supabase/supabase-js';
import type { MoneyExchangeRow } from '@/lib/calculations/moneyExchanges';
import { isMissingDatabaseColumn, isMissingDatabaseTable } from './errors';
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

export interface DollarExpense {
  id: string;
  date: string;
  amount: number | string;
  payment_method: 'usd';
  usd_amount: number | string;
  usd_rate: number | string;
}

/**
 * A club's expenses paid from its US dollars (migration 124) dated within
 * [from, to]. Before 124 the columns do not exist and nothing was spent from
 * dollars; other errors are thrown.
 */
export async function fetchDollarExpenses(
  supabase: SupabaseClient,
  clubId: string,
  from: string,
  to: string,
): Promise<DollarExpense[]> {
  const result = await fetchAllRows<DollarExpense>(() => supabase
    .from('expenses')
    .select('id,date,amount,payment_method,usd_amount,usd_rate')
    .eq('club_id', clubId)
    .eq('payment_method', 'usd')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
    .order('id', { ascending: true }));
  if (result.error) {
    if (isMissingDatabaseColumn(result.error, 'usd_amount')) return [];
    throw result.error;
  }
  return result.data ?? [];
}

/** Adds the dollars and rate to expense rows read without them (the 047 snapshot predates 124). */
export function withDollarAmounts<T extends { id: string }>(
  expenses: T[],
  dollarExpenses: readonly DollarExpense[],
): T[] {
  if (dollarExpenses.length === 0) return expenses;
  const byId = new Map(dollarExpenses.map((row) => [row.id, row]));
  return expenses.map((row) => {
    const dollars = byId.get(row.id);
    return dollars ? { ...row, payment_method: 'usd', usd_amount: dollars.usd_amount, usd_rate: dollars.usd_rate } : row;
  });
}
