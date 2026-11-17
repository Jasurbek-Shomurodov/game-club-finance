import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchCommandSearchData } from './commandSearch';

function query(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'order', 'range']) {
    chain[method] = vi.fn((...args: unknown[]) => { calls.push([method, args]); return chain; });
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { chain, calls };
}

function client(tables: Record<string, ReturnType<typeof query>>) {
  return { from: vi.fn((table: string) => tables[table].chain) } as unknown as SupabaseClient;
}

describe('fetchCommandSearchData', () => {
  const products = () => query({ data: [{ name: 'Cola', is_deleted: false }, { name: 'Old gum', is_deleted: true }, { name: 'Chips' }], error: null });
  const debts = () => query({
    data: [
      { person_name: 'Ali', date: '2026-11-01', remaining_amount: 100, status: 'unpaid' },
      { person_name: ' ali ', date: '2026-11-03', remaining_amount: 50, status: 'partial' },
      { person_name: 'Bek', date: '2026-11-02', remaining_amount: 400, status: 'unpaid' },
      { person_name: null, date: '2026-11-02', remaining_amount: 10, status: 'unpaid' },
    ],
    error: null,
  });

  it('reads both lists for the club and groups debts by person', async () => {
    const tables = { products: products(), new_debts: debts() };
    const result = await fetchCommandSearchData(client(tables), 'club-1', { products: true, debts: true });
    expect(result.products).toEqual(['Cola', 'Chips']);
    expect(result.debtors).toEqual([{ name: 'Bek', remaining: 400 }, { name: 'Ali', remaining: 150 }]);
    expect(tables.products.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
    expect(tables.new_debts.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
    expect(tables.new_debts.calls).toContainEqual(['neq', ['status', 'paid']]);
  });

  it('skips a list the member cannot open', async () => {
    const supabase = client({ products: products(), new_debts: debts() });
    const result = await fetchCommandSearchData(supabase, 'club-1', { products: true, debts: false });
    expect(result.debtors).toEqual([]);
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('products');
  });

  it('leaves a list empty when its read fails', async () => {
    const tables = { products: query({ data: null, error: { message: 'denied' } }), new_debts: debts() };
    const result = await fetchCommandSearchData(client(tables), 'club-1', { products: true, debts: true });
    expect(result.products).toEqual([]);
    expect(result.debtors).toHaveLength(2);
  });
});
