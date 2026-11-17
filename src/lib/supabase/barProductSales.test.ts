import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchBarProductSales } from './barProductSales';

type Result = { data: unknown; error: unknown };

function fakeClient(rpcResult: Result, tableResult: Result = { data: [], error: null }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'order']) {
    chain[method] = (...args: unknown[]) => { calls.push([method, args]); return chain; };
  }
  // fetchAllRows pages with range(); one short page ends the read.
  chain.range = () => Promise.resolve(tableResult);
  const rpc = vi.fn(() => Promise.resolve(rpcResult));
  const from = vi.fn(() => chain);
  return { supabase: { rpc, from } as unknown as SupabaseClient, rpc, from, calls };
}

const summedRow = { product_id: 'cola', sold_quantity: 5, bar_income: 50, bar_cost: 30, days_counted: 2 };

describe('fetchBarProductSales', () => {
  it('returns the rows the database summed, without touching the table', async () => {
    const { supabase, rpc, from } = fakeClient({ data: [summedRow], error: null });
    await expect(fetchBarProductSales(supabase, 'club-1', '2026-10-19', '2026-11-17')).resolves.toEqual([summedRow]);
    expect(rpc).toHaveBeenCalledWith('get_bar_product_sales', { p_club_id: 'club-1', p_from: '2026-10-19', p_to: '2026-11-17' });
    expect(from).not.toHaveBeenCalled();
  });

  it('has no sales when the database returns nothing', async () => {
    const { supabase } = fakeClient({ data: null, error: null });
    await expect(fetchBarProductSales(supabase, 'club-1', '2026-10-19', '2026-11-17')).resolves.toEqual([]);
  });

  it('sums the daily counts itself before migration 149', async () => {
    const { supabase, calls } = fakeClient(
      { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.get_bar_product_sales' } },
      { data: [
        { product_id: 'cola', date: '2026-11-01', sold_quantity: 2, bar_income: 20, bar_cost: 12 },
        { product_id: 'cola', date: '2026-11-02', sold_quantity: 3, bar_income: 30, bar_cost: 18 },
      ], error: null },
    );
    await expect(fetchBarProductSales(supabase, 'club-1', '2026-11-01', '2026-11-30')).resolves.toEqual([summedRow]);
    expect(calls).toEqual(expect.arrayContaining([
      ['eq', ['club_id', 'club-1']],
      ['gte', ['date', '2026-11-01']],
      ['lte', ['date', '2026-11-30']],
    ]));
  });

  it('throws any other database error, from the function or the table', async () => {
    const denied = { code: '42501', message: 'permission denied' };
    await expect(fetchBarProductSales(fakeClient({ data: null, error: denied }).supabase, 'c', 'a', 'b')).rejects.toBe(denied);
    const missing = { code: 'PGRST202', message: 'missing' };
    await expect(fetchBarProductSales(fakeClient({ data: null, error: missing }, { data: null, error: denied }).supabase, 'c', 'a', 'b')).rejects.toBe(denied);
  });
});
