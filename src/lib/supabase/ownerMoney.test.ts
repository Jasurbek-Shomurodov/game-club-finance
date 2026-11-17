import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EMPTY_OWNER_MONEY, EMPTY_OWNER_RESERVE, fetchOwnerMoney, fetchOwnerReserve } from './ownerMoney';

/** A chainable query that records its filters and resolves to `result`. */
function query(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'or', 'not', 'gte', 'lte', 'order', 'range']) {
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

  it('reads investment expenses for the club and hides them when the read fails', async () => {
    const investments = query({ data: [{ date: '2026-10-03', amount: '2000', payment_source: 'bar' }], error: null });
    const supabase = client({ expenses: investments }, () => ({ data: snapshotPayload, error: null }));
    const result = await fetchOwnerMoney(supabase, 'club-1', '2026-10-25');
    expect(investments.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
    expect(investments.calls).toContainEqual(['eq', ['category', 'investments']]);
    expect(result.investments).toEqual([{ date: '2026-10-03', amount: '2000', payment_source: 'bar' }]);

    const failing = client({ expenses: query({ data: null, error: { message: 'denied' } }) }, () => ({ data: snapshotPayload, error: null }));
    await expect(fetchOwnerMoney(failing, 'club-1', '2026-10-25')).resolves.toMatchObject({ investments: [] });
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

describe('fetchOwnerReserve', () => {
  const entry = { id: 'r1', club_id: 'club-1', kind: 'deposit', period_month: '2026-10-01', source: 'bar', payment_method: null, amount: '500', comment: null, collection_date: null, created_by: 'u1', created_at: '2026-10-05T10:00:00Z' };
  const purchase = { id: 'e1', date: '2026-10-06', amount: '120', payment_source: 'bar', payment_method: 'cash', category: 'equipment', comment: null, created_at: '2026-10-06T10:00:00Z' };

  it('reads only the reserve ledgers, never the owner profit snapshot', async () => {
    const entries = query({ data: [entry], error: null });
    const expenses = query({ data: [purchase], error: null });
    const supabase = client({ owner_reserve_entries: entries, expenses }, () => ({ data: snapshotPayload, error: null }));

    const result = await fetchOwnerReserve(supabase, 'club-1', '2026-10-25');

    expect(supabase.rpc).not.toHaveBeenCalled();
    const tables = (supabase.from as ReturnType<typeof vi.fn>).mock.calls.map(([table]) => table).sort();
    expect(tables).toEqual(['expenses', 'expenses', 'money_exchanges', 'owner_reserve_entries']);
    expect(entries.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
    expect(result.reserveSupported).toBe(true);
    expect(result.reserveEntries).toEqual([{ ...entry, amount: 500 }]);
    expect(result.reserveExpenses).toEqual([{ ...purchase, amount: 120 }]);
  });

  it('agrees with the reserve fields of fetchOwnerMoney', async () => {
    const tables = () => ({
      owner_reserve_entries: query({ data: [entry], error: null }),
      expenses: query({ data: [purchase], error: null }),
    });
    const rpc = () => ({ data: snapshotPayload, error: null });
    const reserve = await fetchOwnerReserve(client(tables(), rpc), 'club-1', '2026-10-25');
    const money = await fetchOwnerMoney(client(tables(), rpc), 'club-1', '2026-10-25');
    expect(reserve).toEqual({
      reserveEntries: money.reserveEntries,
      reserveExpenses: money.reserveExpenses,
      exchangeRows: money.exchangeRows,
      dollarExpenses: money.dollarExpenses,
      reserveSupported: money.reserveSupported,
    });
  });

  it('has no reserve before migration 136 and throws any other entries error', async () => {
    const missing = client({
      owner_reserve_entries: query({ data: null, error: { code: '42P01', message: 'relation "public.owner_reserve_entries" does not exist' } }),
    }, () => null);
    await expect(fetchOwnerReserve(missing, 'club-1', '2026-10-25')).resolves.toMatchObject({ reserveSupported: false, reserveEntries: [], reserveExpenses: [] });

    const denied = client({ owner_reserve_entries: query({ data: null, error: { code: '42501', message: 'reserve denied' } }) }, () => null);
    await expect(fetchOwnerReserve(denied, 'club-1', '2026-10-25')).rejects.toThrow('reserve denied');
  });

  it('stops early when the load is superseded', async () => {
    await expect(fetchOwnerReserve(client({}, () => null), 'club-1', '2026-10-25', () => false)).resolves.toBe(EMPTY_OWNER_RESERVE);
  });
});

describe('fetchOwnerMoney from the bundle (migration 150)', () => {
  const bundle = {
    snapshot: snapshotPayload,
    carryovers: [{ id: 'c1', from_month: '2026-09-01', to_month: '2026-10-01', source: 'bar', payment_method: null, amount: 100 }],
    investments: [{ date: '2026-10-03', amount: 2000, payment_source: 'bar' }],
    exchanges: [],
    dollarExpenses: [],
    reserveEntries: [{ id: 'r1', club_id: 'club-1', kind: 'deposit', period_month: '2026-10-01', source: 'bar', payment_method: null, amount: 50 }],
    reserveExpenses: [],
  };

  it('builds the same balances from one request and reads no table', async () => {
    const supabase = client({}, (name) => (name === 'get_owner_money_bundle' ? { data: bundle, error: null } : { data: null, error: { message: 'unexpected' } }));

    const result = await fetchOwnerMoney(supabase, 'club-1', '2026-10-25');

    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('get_owner_money_bundle', { p_club_id: 'club-1', p_through_date: '2026-10-25' });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(result.carryoversSupported).toBe(true);
    expect(result.methodsSupported).toBe(true);
    expect(result.reserveSupported).toBe(true);
    expect(result.investments).toEqual(bundle.investments);
    expect(result.reserveEntries.map((entry) => entry.id)).toEqual(['r1']);
    // The bar carryover moves 100 out of September; the reserve holds 50 of October.
    expect(result.balancesByMonth['2026-09'].bar.available).toBe(200);
    expect(result.balancesByMonth['2026-10'].bar.available).toBe(200);
  });

  it('makes the separate reads when the bundle is missing or fails', async () => {
    for (const error of [{ code: 'PGRST202', message: 'Could not find the function public.get_owner_money_bundle' }, { code: '42501', message: 'permission denied for table expenses' }]) {
      const supabase = client({}, (name) => (name === 'get_owner_money_bundle' ? { data: null, error } : { data: snapshotPayload, error: null }));
      const result = await fetchOwnerMoney(supabase, 'club-1', '2026-10-25');
      expect(supabase.rpc).toHaveBeenCalledWith('get_owner_profit_snapshot_with_methods', { p_club_id: 'club-1', p_through_date: '2026-10-25' });
      expect(supabase.from).toHaveBeenCalledWith('owner_profit_carryovers');
      expect(result.balancesByMonth['2026-09'].gameClub.available).toBe(600);
    }
  });
});
