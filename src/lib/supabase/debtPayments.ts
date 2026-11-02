import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Whether a payment id is already in the ledger. The overpayment trigger runs
 * before the id's unique check, so a retry whose first attempt was saved (with
 * its response lost) is refused as "exceeds remaining" rather than 23505. A
 * failed lookup answers false: the refusal then stands and nothing is claimed.
 */
export async function debtPaymentIsRecorded(supabase: SupabaseClient, clubId: string, paymentId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('debt_payments')
    .select('id')
    .eq('club_id', clubId)
    .eq('id', paymentId)
    .maybeSingle();
  return !error && data !== null;
}
