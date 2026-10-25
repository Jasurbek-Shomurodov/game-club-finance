import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchExpensePresets, fetchPresetExpenses } from './expensePresets';

/** A chainable query that records its filters and resolves to `result`. */
function query(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'not', 'gte', 'lte', 'order', 'range']) {
    chain[method] = vi.fn((...args: unknown[]) => { calls.push([method, args]); return chain; });
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { chain, calls };
}

const clientWith = (chain: unknown) => ({ from: vi.fn(() => chain) }) as unknown as SupabaseClient;

describe('fetchExpensePresets', () => {
  it('reads the club presets with numeric amounts', async () => {
    const { chain, calls } = query({ data: [{ id: 'p1', name: 'iCafe', monthly_amount: '500000', archived_at: null }], error: null });
    const result = await fetchExpensePresets(clientWith(chain), 'club-1');
    expect(result).toEqual({ available: true, presets: [{ id: 'p1', name: 'iCafe', monthly_amount: 500000, archived_at: null }] });
    expect(calls).toContainEqual(['eq', ['club_id', 'club-1']]);
  });

  it('reports the feature as unavailable before migration 091', async () => {
    const { chain } = query({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.expense_presets'" } });
    await expect(fetchExpensePresets(clientWith(chain), 'club-1')).resolves.toEqual({ presets: [], available: false });
  });

  it('throws any other error', async () => {
    const { chain } = query({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(fetchExpensePresets(clientWith(chain), 'club-1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('fetchPresetExpenses', () => {
  it('reads only linked expenses of the club inside the range', async () => {
    const { chain, calls } = query({ data: [{ id: 'e1', date: '2026-10-02', amount: '1000', preset_id: 'p1' }], error: null });
    const rows = await fetchPresetExpenses(clientWith(chain), 'club-1', { from: '2026-10-01', to: '2026-10-31' });
    expect(rows).toEqual([{ date: '2026-10-02', amount: 1000, preset_id: 'p1' }]);
    expect(calls).toEqual(expect.arrayContaining([
      ['eq', ['club_id', 'club-1']],
      ['not', ['preset_id', 'is', null]],
      ['gte', ['date', '2026-10-01']],
      ['lte', ['date', '2026-10-31']],
    ]));
  });

  it('has no linked expenses before migration 091', async () => {
    const { chain } = query({ data: null, error: { code: '42703', message: 'column expenses.preset_id does not exist' } });
    await expect(fetchPresetExpenses(clientWith(chain), 'club-1', { from: '2026-10-01', to: '2026-10-31' })).resolves.toEqual([]);
  });
});
