import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExpensePreset, PresetExpenseRow } from '@/lib/calculations/expensePlans';
import { isMissingDatabaseColumn, isMissingDatabaseTable } from './errors';
import { fetchAllRows } from './pagination';

const PRESET_COLUMNS = 'id,name,category,payment_source,monthly_amount,sort_order,archived_at';
/** The usual payment method arrives with migration 094. */
const PRESET_COLUMNS_WITH_METHOD = `${PRESET_COLUMNS},payment_method`;

export interface ExpensePresetsResult {
  presets: ExpensePreset[];
  /** False before migration 091 is applied: the feature is hidden, not an error. */
  available: boolean;
}

/** Every preset of the club, archived ones included (they label older expenses). */
export async function fetchExpensePresets(supabase: SupabaseClient, clubId: string): Promise<ExpensePresetsResult> {
  const read = (columns: string) => supabase
    .from('expense_presets')
    .select(columns)
    .eq('club_id', clubId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  let { data, error } = await read(PRESET_COLUMNS_WITH_METHOD);
  // Compatibility while migration 094 is being deployed: plans without a method.
  if (isMissingDatabaseColumn(error, 'payment_method')) ({ data, error } = await read(PRESET_COLUMNS));
  if (error) {
    if (isMissingDatabaseTable(error, 'expense_presets')) return { presets: [], available: false };
    throw error;
  }
  return {
    presets: ((data ?? []) as unknown as Array<Omit<ExpensePreset, 'monthly_amount'> & { monthly_amount: unknown }>)
      .map((row) => ({ ...row, payment_method: row.payment_method ?? null, monthly_amount: Number(row.monthly_amount ?? 0) })),
    available: true,
  };
}

/** Expenses linked to a preset inside the range. */
export async function fetchPresetExpenses(
  supabase: SupabaseClient,
  clubId: string,
  range: { from: string; to: string },
): Promise<PresetExpenseRow[]> {
  const { data, error } = await fetchAllRows<PresetExpenseRow & { id: string }>(() => supabase
    .from('expenses')
    .select('id,date,amount,preset_id')
    .eq('club_id', clubId)
    .not('preset_id', 'is', null)
    .gte('date', range.from)
    .lte('date', range.to)
    .order('date', { ascending: true })
    .order('id', { ascending: true }));
  if (error) {
    if (isMissingDatabaseColumn(error as { code?: string; message?: string }, 'preset_id')) return [];
    throw error;
  }
  return (data ?? []).map((row) => ({ date: row.date, amount: Number(row.amount ?? 0), preset_id: row.preset_id }));
}
