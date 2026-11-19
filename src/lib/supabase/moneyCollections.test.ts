import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deleteMoneyCollection,
  fetchCollectedMoneyMoves,
  fetchCollectionBalances,
  isCollectedInsufficientError,
  moveCollectedToReserve,
} from './moneyCollections';

const client = (result: { data: unknown; error: { code?: string; message: string } | null }) => {
  const rpc = vi.fn(() => Promise.resolve(result));
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
};
const missing = (name: string) => ({ code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` });

describe('fetchCollectedMoneyMoves', () => {
  it('reads the moves of a range', async () => {
    const { supabase, rpc } = client({ data: [{ kind: 'collect', id: 'r', date: '2026-11-02', method: 'cash', amount: 5 }], error: null });
    expect(await fetchCollectedMoneyMoves(supabase, 'c', '2026-11-01', '2026-11-30')).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('get_collected_money_moves', { p_club_id: 'c', p_from: '2026-11-01', p_to: '2026-11-30' });
  });

  it('is empty before migration 169 and throws on other errors', async () => {
    expect(await fetchCollectedMoneyMoves(client({ data: null, error: missing('get_collected_money_moves') }).supabase, 'c', 'a', 'b')).toEqual([]);
    await expect(fetchCollectedMoneyMoves(client({ data: null, error: { message: 'boom' } }).supabase, 'c', 'a', 'b')).rejects.toThrow('boom');
  });
});

describe('fetchCollectionBalances', () => {
  it('reads a day, is null before 169 and throws otherwise', async () => {
    const balances = await fetchCollectionBalances(client({ data: { cash: { till: 10, collected: 2 } }, error: null }).supabase, 'c', 'd');
    expect(balances?.cash).toEqual({ till: 10, collected: 2 });
    expect(await fetchCollectionBalances(client({ data: null, error: missing('get_collection_balances') }).supabase, 'c', 'd')).toBeNull();
    await expect(fetchCollectionBalances(client({ data: null, error: { message: 'boom' } }).supabase, 'c', 'd')).rejects.toThrow('boom');
  });
});

describe('owner actions', () => {
  it('call their RPCs', async () => {
    const { supabase, rpc } = client({ data: true, error: null });
    await deleteMoneyCollection(supabase, 'c', 'r');
    expect(rpc).toHaveBeenCalledWith('delete_money_collection', { p_club_id: 'c', p_request_id: 'r' });
    await moveCollectedToReserve(supabase, { clubId: 'c', id: 'i', date: 'd', method: 'card', amount: 7, comment: null });
    expect(rpc).toHaveBeenCalledWith('move_collected_to_reserve', {
      p_club_id: 'c', p_id: 'i', p_date: 'd', p_payment_method: 'card', p_amount: 7, p_comment: null,
    });
  });
});

describe('isCollectedInsufficientError', () => {
  it('knows the 169 refusal by hint or message', () => {
    expect(isCollectedInsufficientError({ hint: 'COLLECTED_INSUFFICIENT' })).toBe(true);
    expect(isCollectedInsufficientError({ message: 'Insufficient collected money: cash would be negative by 5' })).toBe(true);
    expect(isCollectedInsufficientError({ message: 'other' })).toBe(false);
    expect(isCollectedInsufficientError(null)).toBe(false);
  });
});
