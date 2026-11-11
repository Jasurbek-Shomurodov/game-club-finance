import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteReserveEntry, depositToReserve, fetchReserveHoldings, reserveErrorCode, returnFromReserve, setReserveGoal } from './ownerReserve';

const client = (result: { data?: unknown; error?: unknown }) => {
  const rpc = vi.fn(() => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }));
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
};
const move = { id: 'id', month: '2026-11', source: 'game_club' as const, method: 'cash' as const, amount: 500_000, comment: '  For new PCs ' };

describe('reserve RPC wrappers', () => {
  it('sends the month as its first day, trims the note, and drops the method on the Bar side', async () => {
    const { supabase, rpc } = client({});
    expect(await depositToReserve(supabase, 'club', move)).toBeNull();
    expect(rpc).toHaveBeenCalledWith('move_owner_profit_to_reserve', {
      p_club_id: 'club', p_id: 'id', p_period_month: '2026-11-01', p_source: 'game_club', p_payment_method: 'cash', p_amount: 500_000, p_comment: 'For new PCs',
    });
    await returnFromReserve(supabase, 'club', { ...move, source: 'bar', comment: '' });
    expect(rpc).toHaveBeenLastCalledWith('return_owner_reserve', expect.objectContaining({ p_source: 'bar', p_payment_method: null, p_comment: null }));
  });

  it('maps database refusals to what the page says', async () => {
    expect(await depositToReserve(client({ error: { hint: 'reserve_exceeds_available' } }).supabase, 'club', move)).toBe('exceeds_available');
    expect(await deleteReserveEntry(client({ error: { hint: 'reserve_already_used' } }).supabase, 'club', 'id')).toBe('already_used');
    expect(await setReserveGoal(client({ error: { code: '42501' } }).supabase, 'club', 'bar', 'Fridge', 1)).toBe('forbidden');
    expect(reserveErrorCode({ hint: 'reserve_insufficient' }, 'x')).toBe('insufficient');
    expect(reserveErrorCode({ code: 'PGRST202', message: 'Could not find the function public.x' }, 'x')).toBe('migration_required');
    expect(reserveErrorCode({ code: 'XX000' }, 'x')).toBe('failed');
  });

  it('reads holdings as numbers, and nothing for non-owners', async () => {
    const holdings = await fetchReserveHoldings(client({ data: {
      game_club: { total: '750000', cash: '450000', terminal: '300000', card: 0, playstation: 0 }, bar: { total: '0' },
    } }).supabase, 'club');
    expect(holdings).toEqual({ game_club: { total: 750_000, cash: 450_000, terminal: 300_000, card: 0, playstation: 0 }, bar: { total: 0 } });
    expect(await fetchReserveHoldings(client({ error: { code: '42501' } }).supabase, 'club')).toBeNull();
  });
});
