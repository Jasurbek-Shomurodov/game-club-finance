import type { SupabaseClient } from '@supabase/supabase-js';
import { summarizeDebtors } from '@/lib/calculations/dashboardAttention';
import { fetchAllRows } from './pagination';

export interface CommandSearchData {
  /** Names of the club's products, deleted ones left out. */
  products: string[];
  /** People with an open debt and what each still owes, largest first. */
  debtors: Array<{ name: string; remaining: number }>;
}

export const EMPTY_COMMAND_SEARCH: CommandSearchData = { products: [], debtors: [] };

/**
 * What the command palette can find by name, read once per opening and only
 * for the lists this member can open. A failed read leaves its list empty:
 * the palette still finds pages and actions.
 */
export async function fetchCommandSearchData(
  supabase: SupabaseClient,
  clubId: string,
  include: { products: boolean; debts: boolean },
): Promise<CommandSearchData> {
  const [products, debts] = await Promise.all([
    include.products
      ? fetchAllRows<{ name: string; is_deleted?: boolean | null }>(() => supabase
        .from('products').select('name,is_deleted').eq('club_id', clubId).order('name').order('id'))
      : null,
    include.debts
      ? fetchAllRows<{ person_name: string | null; date: string; remaining_amount: number; status: string }>(() => supabase
        .from('new_debts').select('person_name,date,remaining_amount,status').eq('club_id', clubId).neq('status', 'paid').order('id'))
      : null,
  ]);
  return {
    products: products?.error ? [] : (products?.data ?? []).filter((row) => row.is_deleted !== true).map((row) => row.name),
    debtors: debts?.error ? [] : summarizeDebtors(debts?.data ?? [])
      .filter((debtor) => debtor.name)
      .map((debtor) => ({ name: debtor.name, remaining: debtor.remaining })),
  };
}
