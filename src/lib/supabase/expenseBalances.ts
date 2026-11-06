import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExpensePaymentMethod } from '@/types';
import { isMissingDatabaseFunction } from './errors';

/** What each payment method can still pay (migration 125), plus the latest dollar rate to suggest. */
export interface ExpenseMethodBalances {
  balances: Record<ExpensePaymentMethod, number>;
  /** UZS per dollar of the club's latest dollar exchange on or before the date; null when none. */
  usdRate: number | null;
}

interface BalancesPayload {
  cash?: number | string | null;
  terminal?: number | string | null;
  card?: number | string | null;
  playstation?: number | string | null;
  usd?: number | string | null;
  usdRate?: number | string | null;
}

/**
 * Game Club money each method holds for an expense dated `date`: the month's
 * money left for UZS methods, every dollar still held for dollars. Null before
 * migration 125, when nothing limits an expense yet.
 */
export async function fetchExpenseMethodBalances(
  supabase: SupabaseClient,
  clubId: string,
  date: string,
): Promise<ExpenseMethodBalances | null> {
  const { data, error } = await supabase.rpc('get_expense_method_balances', { p_club_id: clubId, p_date: date });
  if (error) {
    if (isMissingDatabaseFunction(error, 'get_expense_method_balances')) return null;
    throw error;
  }
  const payload = (data ?? {}) as BalancesPayload;
  const amount = (value: number | string | null | undefined) => Number(value ?? 0);
  return {
    balances: {
      cash: amount(payload.cash),
      terminal: amount(payload.terminal),
      card: amount(payload.card),
      playstation: amount(payload.playstation),
      usd: amount(payload.usd),
    },
    usdRate: payload.usdRate === null || payload.usdRate === undefined ? null : Number(payload.usdRate),
  };
}
