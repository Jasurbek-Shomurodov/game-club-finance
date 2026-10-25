import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_OWNER_MONEY, fetchOwnerMoney } from './ownerMoney';

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

const empty = () => query({ data: [], error: null });

const snapshotPayload = {
  monthlyBalances: [
    { period_month: '2026-09-01', game_club_earned: 1_000, game_club_withdrawn: 400, bar_earned: 300, bar_withdrawn: 0 },
    { period_month: '2026-10-01', game_club_earned: 500, game_club_withdrawn: 0, bar_earned: 200, bar_withdrawn: 50 },
  ],
  withdrawalRows: [],
  paymentMethodBalancesByMonth: {},
};

function client(tables: Record<string, ReturnType<typeof query>>, rpc: (name: string) => unknown) {
  return {
    from: vi.fn((table: string) => (tables[table] ?? empty()).chain),
    rpc: vi.fn(async (name: string) => rpc(name)),
  } as unknown as SupabaseClient;
}

describe('fetchOwnerMoney', () => {
  it('reads monthly balances from the owner profit snapshot, scoped to the club', async () => {
    const carryovers = query({
      data: [{ id: 'c1', from_month: '2026-09-01', to_month: '2026-10-01', source: 'bar', payment_method: null, amount: '100' }],
      error: null,
    });
    const supabase = client({ owner_profit_carryovers: carryovers }, () => ({ data: snapshotPayload, error: null }));

    const result = await fetchOwnerMoney(supabase, 'club-1', '2026-10-25');

    expect(supabase.rpc).toHaveBeenCalledWith('get_owner_profit_snapshot_with_methods', { p_club_id: 'club-1', p_through_date: '2026-10-25' });
    expect(carryovers.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
    expect(result.carryoversSupported).toBe(true);
    expect(result.carryovers[0].amount).toBe(100);
    // The bar carryover moves 100 out of September and into October.
    expect(result.balancesByMonth['2026-09'].bar.available).toBe(200);
    expect(result.balancesByMonth['2026-10'].bar.available).toBe(250);
    expect(result.balancesByMonth['2026-09'].gameClub).toMatchObject({ earned: 1_000, withdrawn: 400, available: 600 });
  });

  it('stops early when the load is superseded', async () => {
    const supabase = client({}, () => ({ data: snapshotPayload, error: null }));
    await expect(fetchOwnerMoney(supabase, 'club-1', '2026-10-25', () => false)).resolves.toBe(EMPTY_OWNER_MONEY);
  });

  it('throws a snapshot error that is not a missing function', async () => {
    const supabase = client({}, () => ({ data: null, error: { code: '42501', message: 'permission denied' } }));
    await expect(fetchOwnerMoney(supabase, 'club-1', '2026-10-25')).rejects.toThrow('permission denied');
  });
});
