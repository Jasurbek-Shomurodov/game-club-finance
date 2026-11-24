import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { fetchExpenseMethodBalances } from './expenseBalances';

const client = (result: { data: unknown; error: unknown }) => {
  const rpc = vi.fn().mockResolvedValue(result);
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
};

describe('fetchExpenseMethodBalances', () => {
  it('reads every method as a number, the latest dollar rate and what a dollar cost', async () => {
    const { supabase, rpc } = client({
      data: { cash: '280000', terminal: 850000, card: '0', playstation: null, usd: '80.5', usdRate: '12500', usdCostRate: '12022.25' },
      error: null,
    });
    await expect(fetchExpenseMethodBalances(supabase, 'club', '2026-11-06')).resolves.toEqual({
      balances: { cash: 280000, terminal: 850000, card: 0, playstation: 0, usd: 80.5 },
      usdRate: 12500,
      usdCostRate: 12022.25,
    });
    expect(rpc).toHaveBeenCalledWith('get_expense_method_balances', { p_club_id: 'club', p_date: '2026-11-06' });
  });

  it('has no rate before the first dollar exchange, and no cost without dollars or before migration 184', async () => {
    const { supabase } = client({ data: { cash: 1, usdRate: null, usdCostRate: null }, error: null });
    const balances = await fetchExpenseMethodBalances(supabase, 'club', '2026-11-06');
    expect(balances?.usdRate).toBeNull();
    expect(balances?.usdCostRate).toBeNull();
    const before184 = client({ data: { cash: 1, usd: 80, usdRate: 12500 }, error: null });
    expect((await fetchExpenseMethodBalances(before184.supabase, 'club', '2026-11-06'))?.usdCostRate).toBeNull();
  });

  it('limits nothing before migration 125 and throws other errors', async () => {
    const missing = client({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.get_expense_method_balances' } });
    await expect(fetchExpenseMethodBalances(missing.supabase, 'club', '2026-11-06')).resolves.toBeNull();
    const denied = client({ data: null, error: { code: '42501', message: 'Not a member of this club.' } });
    await expect(fetchExpenseMethodBalances(denied.supabase, 'club', '2026-11-06')).rejects.toMatchObject({ code: '42501' });
  });
});
