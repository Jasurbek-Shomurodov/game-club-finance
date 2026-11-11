import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from './pagination';
import { isMissingDatabaseColumn, isMissingDatabaseFunction, isMissingDatabaseTable } from './errors';
import { isDayCollectedError } from './dailyCashCollections';
import { isNoteRequiredError } from '@/lib/entryNote';
import type { CashShortageRecovery } from '@/lib/calculations/cashShortages';
import type { CashShortage, CashShortageMethod, CashShortageReason, OwnerWithdrawalSource } from '@/types';

export interface ShortageEmployee {
  id: string;
  name: string;
}

export interface CashShortageData {
  shortages: CashShortage[];
  recoveries: CashShortageRecovery[];
  /** Salary employees a shortage can name, hidden ones included so old rows keep their name. */
  employees: (ShortageEmployee & { hidden: boolean })[];
  /** Migration 135 is applied. */
  supported: boolean;
}

export const EMPTY_CASH_SHORTAGES: CashShortageData = { shortages: [], recoveries: [], employees: [], supported: false };

const SHORTAGE_COLUMNS = 'id,club_id,date,payment_source,payment_method,amount,reason,employee_id,comment,created_by,created_at';

/** Every shortage of the club with its live recovery fines. Owners only (RLS); others read nothing. */
export async function fetchCashShortages(supabase: SupabaseClient, clubId: string): Promise<CashShortageData> {
  const [shortages, recoveries, employees] = await Promise.all([
    fetchAllRows<CashShortage>(() => supabase.from('cash_shortages').select(SHORTAGE_COLUMNS).eq('club_id', clubId).order('id')),
    fetchAllRows<CashShortageRecovery>(() => supabase
      .from('salary_entries')
      .select('id,cash_shortage_id,amount,date')
      .eq('club_id', clubId)
      .not('cash_shortage_id', 'is', null)
      .is('deleted_at', null)
      .order('id')),
    fetchAllRows<{ id: string; name: string; deleted_at?: string | null }>(() => supabase
      .from('salary_employees')
      .select('id,name,deleted_at')
      .eq('club_id', clubId)
      .order('id')),
  ]);
  // Before migration 135 the page simply has no shortages.
  if (isMissingDatabaseTable(shortages.error, 'cash_shortages')
    || isMissingDatabaseColumn(recoveries.error, 'cash_shortage_id')) return EMPTY_CASH_SHORTAGES;
  const error = shortages.error ?? recoveries.error ?? employees.error;
  if (error) throw error;
  return {
    shortages: (shortages.data ?? []).map((row) => ({ ...row, amount: Number(row.amount) })),
    recoveries: (recoveries.data ?? []).map((row) => ({ ...row, amount: Number(row.amount) })),
    employees: (employees.data ?? [])
      .map((row) => ({ id: row.id, name: row.name, hidden: Boolean(row.deleted_at) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    supported: true,
  };
}

export type ShortageErrorCode =
  | 'note_required'
  | 'day_collected'
  | 'recovery_too_large'
  | 'no_employee'
  | 'has_recoveries'
  | 'migration_required'
  | 'forbidden'
  | 'failed';

/** Maps a shortage RPC error to what the page tells the owner. */
export function shortageErrorCode(error: { code?: string | null; message?: string | null; hint?: string | null }, rpcName: string): ShortageErrorCode {
  if (isMissingDatabaseFunction(error as { code?: string; message?: string }, rpcName)) return 'migration_required';
  if (isNoteRequiredError(error)) return 'note_required';
  if (isDayCollectedError(error)) return 'day_collected';
  if (error.hint === 'shortage_recovery_too_large') return 'recovery_too_large';
  if (error.hint === 'shortage_no_employee') return 'no_employee';
  if (error.hint === 'shortage_has_recoveries') return 'has_recoveries';
  if (error.code === '42501') return 'forbidden';
  return 'failed';
}

export interface RecordShortageInput {
  id: string;
  date: string;
  source: OwnerWithdrawalSource;
  method: CashShortageMethod;
  amount: number;
  reason: CashShortageReason;
  employeeId: string | null;
  comment: string;
  /** Part to take back from the employee's salary now, as a fine. */
  recoverAmount: number;
  recoveryId: string;
}

export async function recoverCashShortage(
  supabase: SupabaseClient, clubId: string, shortageId: string, requestId: string, amount: number,
): Promise<ShortageErrorCode | null> {
  const { error } = await supabase.rpc('recover_cash_shortage', {
    p_club_id: clubId, p_shortage_id: shortageId, p_request_id: requestId, p_amount: amount,
  });
  return error ? shortageErrorCode(error, 'recover_cash_shortage') : null;
}

export async function deleteCashShortage(supabase: SupabaseClient, clubId: string, shortageId: string): Promise<ShortageErrorCode | null> {
  const { error } = await supabase.rpc('delete_cash_shortage', { p_club_id: clubId, p_shortage_id: shortageId });
  return error ? shortageErrorCode(error, 'delete_cash_shortage') : null;
}
