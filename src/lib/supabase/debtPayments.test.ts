import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { debtPaymentIsRecorded } from './debtPayments';

function client(result: { data: unknown; error: unknown }) {
  const eq = vi.fn();
  const query = { select: () => query, eq: (...args: unknown[]) => { eq(...args); return query; }, maybeSingle: async () => result };
  return { supabase: { from: () => query } as unknown as SupabaseClient, eq };
}

describe('debtPaymentIsRecorded', () => {
  it('finds a payment saved by an earlier attempt, within the club', async () => {
    const { supabase, eq } = client({ data: { id: 'payment' }, error: null });
    await expect(debtPaymentIsRecorded(supabase, 'club', 'payment')).resolves.toBe(true);
    expect(eq).toHaveBeenCalledWith('club_id', 'club');
    expect(eq).toHaveBeenCalledWith('id', 'payment');
  });

  it('leaves a real overpayment refused', async () => {
    await expect(debtPaymentIsRecorded(client({ data: null, error: null }).supabase, 'club', 'payment')).resolves.toBe(false);
  });

  it('claims nothing when the lookup fails', async () => {
    await expect(debtPaymentIsRecorded(client({ data: null, error: { message: 'down' } }).supabase, 'club', 'payment')).resolves.toBe(false);
  });
});
