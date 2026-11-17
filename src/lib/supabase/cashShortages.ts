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
  | 'exceeds_available'
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
  if (error.hint === 'shortage_exceeds_available') return 'exceeds_available';
  if (error.code === '42501') return 'forbidden';
  return 'failed';
}

/** What a shortage in one month may take, and the day it is dated (migration 151). */
export interface ShortageLimits {
  /** Game Club: per method, what the month still has in it. */
  gameClub: Record<CashShortageMethod, number>;
  /** Bar: what the month still has; the bar keeps no per-method balance. */
  bar: number;
  /** The month's latest day, up to today, not ticked as collected; null when every day is collected. */
  date: string | null;
}

interface ShortageLimitRow {
  source: string;
  payment_method: string | null;
  available: number | string | null;
  shortage_date: string | null;
}

/** Reads the rows of cash_shortage_limits into per-side limits. */
export function shortageLimitsFromRows(rows: readonly ShortageLimitRow[]): ShortageLimits {
  const limits: ShortageLimits = { gameClub: { cash: 0, terminal: 0, card: 0, playstation: 0 }, bar: 0, date: null };
  for (const row of rows) {
    const available = Math.max(0, Number(row.available) || 0);
    if (row.source === 'bar') limits.bar = available;
    else if (row.payment_method && row.payment_method in limits.gameClub) limits.gameClub[row.payment_method as CashShortageMethod] = available;
    limits.date ??= row.shortage_date ? row.shortage_date.slice(0, 10) : null;
  }
  return limits;
}

/** The most a shortage from this side and method may be. */
export function shortageLimitFor(limits: ShortageLimits, source: OwnerWithdrawalSource, method: CashShortageMethod): number {
  return source === 'bar' ? limits.bar : limits.gameClub[method];
}

/** Limits for a month (YYYY-MM); null before migration 151, when the database sets no limit. */
export async function fetchShortageLimits(supabase: SupabaseClient, clubId: string, month: string): Promise<ShortageLimits | null> {
  const { data, error } = await supabase.rpc('cash_shortage_limits', { p_club_id: clubId, p_month: `${month}-01` });
  if (error) {
    if (isMissingDatabaseFunction(error, 'cash_shortage_limits')) return null;
    throw error;
  }
  return shortageLimitsFromRows((data ?? []) as ShortageLimitRow[]);
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
