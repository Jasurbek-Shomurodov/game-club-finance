import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data: unknown; error: unknown };
type Call = [string, unknown[]];

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => state.db }));

import { loadSalaries, loadSalaryEntries } from './salaries';

/**
 * A browser client whose every `from(table)` starts a fresh chainable read that
 * records its filters and resolves to `tables[table]` (an empty page by default).
 */
function fakeDb(tables: Record<string, Result>, rpcResult: Result = { data: null, error: null }) {
  const reads: Array<{ table: string; calls: Call[] }> = [];
  const from = vi.fn((table: string) => {
    const calls: Call[] = [];
    reads.push({ table, calls });
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'lte', 'in', 'order', 'range']) {
      chain[method] = (...args: unknown[]) => { calls.push([method, args]); return chain; };
    }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(tables[table] ?? { data: [], error: null }).then(resolve);
    return chain;
  });
  const rpc = vi.fn(async () => rpcResult);
  state.db = { from, rpc };
  const readsOf = (table: string) => reads.filter((read) => read.table === table).map((read) => read.calls);
  return { from, rpc, reads, readsOf };
}

const employee = { id: 'emp-1', club_id: 'club-1', name: 'Izzat' };
const liveRate = { id: 'rate-1', employee_id: 'emp-1', deleted_by: null };
const deletedRate = { id: 'rate-2', employee_id: 'emp-1', deleted_by: 'user-a' };
const liveEntry = { id: 'entry-1', employee_id: 'emp-1', date: '2026-10-05', amount: 100_000 };
const deletedEntryA = { id: 'entry-2', employee_id: 'emp-1', date: '2026-10-06', amount: 50_000, deleted_by: 'user-a' };
const deletedEntryB = { id: 'entry-3', employee_id: 'emp-1', date: '2026-10-07', amount: 20_000, deleted_by: 'user-b' };

beforeEach(() => { state.db = null; });

describe('loadSalaries', () => {
  it('scopes every table read to the club and limits entries to the through date', async () => {
    const db = fakeDb({});
    await loadSalaries('club-1', '2026-10-25');

    const ledgerReads = db.reads.filter((read) => read.table !== 'profiles');
    expect(ledgerReads.map((read) => read.table).sort()).toEqual(['salary_employees', 'salary_entries', 'salary_rates']);
    for (const read of ledgerReads) {
      expect(read.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
      // A stable order is what makes fetchAllRows paging safe.
      expect(read.calls).toContainEqual(['order', ['id']]);
    }
    expect(db.readsOf('salary_entries')[0]).toContainEqual(['lte', ['date', '2026-10-25']]);
    // Employees and rates are not date-limited: a future-dated rate still shows on the page.
    expect(db.readsOf('salary_employees')[0].some(([method]) => method === 'lte')).toBe(false);
    expect(db.readsOf('salary_rates')[0].some(([method]) => method === 'lte')).toBe(false);
  });

  it('asks the profit snapshot RPC for the same club and date', async () => {
    const db = fakeDb({});
    await loadSalaries('club-1', '2026-10-25');
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledWith('get_salary_profit_snapshot', { p_club_id: 'club-1', p_through_date: '2026-10-25' });
  });

  it('returns the rows with the RPC month balances and daily income', async () => {
    const monthlyBalances = [{ period_month: '2026-10-01', game_club_earned: 900_000, bar_earned: 100_000 }];
    const dailyGameClubIncome = [{ date: '2026-10-05', amount: 300_000 }];
    fakeDb(
      {
        salary_employees: { data: [employee], error: null },
        salary_rates: { data: [liveRate], error: null },
        salary_entries: { data: [liveEntry], error: null },
      },
      { data: { monthlyBalances, dailyGameClubIncome }, error: null },
    );

    await expect(loadSalaries('club-1', '2026-10-25')).resolves.toEqual({
      employees: [employee],
      rates: [liveRate],
      entries: [liveEntry],
      deleterNames: {},
      monthlyProfit: monthlyBalances,
      dailyIncome: dailyGameClubIncome,
    });
  });

  it('defaults month balances and daily income to empty when the RPC payload lacks them', async () => {
    // Before migration 134 the payload has no dailyGameClubIncome.
    fakeDb({}, { data: { monthlyBalances: [{ period_month: '2026-10-01' }] }, error: null });
    await expect(loadSalaries('club-1', '2026-10-25')).resolves.toMatchObject({
      monthlyProfit: [{ period_month: '2026-10-01' }],
      dailyIncome: [],
    });

    fakeDb({}, { data: {}, error: null });
    await expect(loadSalaries('club-1', '2026-10-25')).resolves.toMatchObject({ monthlyProfit: [], dailyIncome: [] });

    fakeDb({}, { data: null, error: null });
    await expect(loadSalaries('club-1', '2026-10-25')).resolves.toEqual({
      employees: [], rates: [], entries: [], deleterNames: {}, monthlyProfit: [], dailyIncome: [],
    });
  });

  it.each([
    ['salary_employees'],
    ['salary_rates'],
    ['salary_entries'],
  ])('throws a failed %s read instead of showing partial payroll', async (table) => {
    const error = { code: '42501', message: `denied ${table}` };
    const db = fakeDb({ [table]: { data: null, error } });
    await expect(loadSalaries('club-1', '2026-10-25')).rejects.toBe(error);
    // Nothing is looked up after a failure.
    expect(db.readsOf('profiles')).toEqual([]);
  });

  it('throws a failed profit snapshot', async () => {
    const error = { code: 'XX000', message: 'snapshot failed' };
    fakeDb({ salary_entries: { data: [deletedEntryA], error: null } }, { data: null, error });
    await expect(loadSalaries('club-1', '2026-10-25')).rejects.toBe(error);
  });

  it('names the people who deleted rates and entries, asking for each id once', async () => {
    const db = fakeDb({
      salary_rates: { data: [liveRate, deletedRate], error: null },
      salary_entries: { data: [liveEntry, deletedEntryA, deletedEntryB], error: null },
      profiles: { data: [{ id: 'user-a', full_name: '  Aziz Karimov ' }, { id: 'user-b', full_name: 'Bek' }], error: null },
    });

    const result = await loadSalaries('club-1', '2026-10-25');

    // user-a deleted a rate and an entry: one id, not two.
    expect(db.readsOf('profiles')).toEqual([[['select', ['id,full_name']], ['in', ['id', ['user-a', 'user-b']]]]]);
    expect(result.deleterNames).toEqual({ 'user-a': 'Aziz Karimov', 'user-b': 'Bek' });
  });

  it('drops deleters without a usable name', async () => {
    fakeDb({
      salary_entries: { data: [deletedEntryA, deletedEntryB, { ...deletedEntryB, id: 'entry-4', deleted_by: 'user-c' }], error: null },
      profiles: { data: [{ id: 'user-a', full_name: '   ' }, { id: 'user-b', full_name: null }, { id: 'user-c', full_name: 'Sardor' }], error: null },
    });
    await expect(loadSalaries('club-1', '2026-10-25')).resolves.toMatchObject({ deleterNames: { 'user-c': 'Sardor' } });
  });

  it('has no names when the profiles read returns nothing', async () => {
    fakeDb({ salary_entries: { data: [deletedEntryA], error: null }, profiles: { data: null, error: null } });
    await expect(loadSalaries('club-1', '2026-10-25')).resolves.toMatchObject({ deleterNames: {} });
  });

  it('does not read profiles when nothing was deleted', async () => {
    const db = fakeDb({
      salary_rates: { data: [liveRate, { id: 'rate-3' }], error: null },
      salary_entries: { data: [liveEntry, { ...liveEntry, id: 'entry-9', deleted_by: '' }], error: null },
    });
    await expect(loadSalaries('club-1', '2026-10-25')).resolves.toMatchObject({ deleterNames: {} });
    expect(db.readsOf('profiles')).toEqual([]);
  });

  it('throws a failed profiles read', async () => {
    const error = { code: '42501', message: 'profiles denied' };
    fakeDb({ salary_entries: { data: [deletedEntryA], error: null }, profiles: { data: null, error } });
    await expect(loadSalaries('club-1', '2026-10-25')).rejects.toBe(error);
  });
});

describe('loadSalaryEntries', () => {
  it('reads only the club entries through the date, with their deleters', async () => {
    const db = fakeDb({
      salary_entries: { data: [liveEntry, deletedEntryA], error: null },
      profiles: { data: [{ id: 'user-a', full_name: 'Aziz' }], error: null },
    });

    await expect(loadSalaryEntries('club-1', '2026-10-25')).resolves.toEqual({
      entries: [liveEntry, deletedEntryA],
      deleterNames: { 'user-a': 'Aziz' },
    });

    expect(db.reads.map((read) => read.table)).toEqual(['salary_entries', 'profiles']);
    expect(db.readsOf('salary_entries')[0]).toEqual([
      ['select', ['*']],
      ['eq', ['club_id', 'club-1']],
      ['lte', ['date', '2026-10-25']],
      ['order', ['id']],
      ['range', [0, 999]],
    ]);
    // Employees, rates and profit are unchanged by an entry, so they are not re-read.
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('returns no entries and reads no profiles for an empty ledger', async () => {
    const db = fakeDb({});
    await expect(loadSalaryEntries('club-1', '2026-10-25')).resolves.toEqual({ entries: [], deleterNames: {} });
    expect(db.readsOf('profiles')).toEqual([]);
  });

  it('throws a failed entries read', async () => {
    const error = { code: '42501', message: 'denied' };
    fakeDb({ salary_entries: { data: null, error } });
    await expect(loadSalaryEntries('club-1', '2026-10-25')).rejects.toBe(error);
  });

  it('reads every page of a long ledger', async () => {
    const page = Array.from({ length: 1_000 }, (_, index) => ({ id: `entry-${index}` }));
    const calls: Call[][] = [];
    let reads = 0;
    state.db = {
      rpc: vi.fn(),
      from: vi.fn(() => {
        const mine: Call[] = [];
        calls.push(mine);
        const chain: Record<string, unknown> = {};
        for (const method of ['select', 'eq', 'lte', 'order', 'range']) {
          chain[method] = (...args: unknown[]) => { mine.push([method, args]); return chain; };
        }
        chain.then = (resolve: (value: unknown) => unknown) => {
          reads += 1;
          return Promise.resolve({ data: reads === 1 ? page : [{ id: 'entry-last' }], error: null }).then(resolve);
        };
        return chain;
      }),
    };

    const result = await loadSalaryEntries('club-1', '2026-10-25');

    expect(result.entries).toHaveLength(1_001);
    expect(calls[1]).toContainEqual(['range', [1_000, 1_999]]);
    // The second page is still the same club and date window.
    expect(calls[1]).toContainEqual(['eq', ['club_id', 'club-1']]);
    expect(calls[1]).toContainEqual(['lte', ['date', '2026-10-25']]);
  });
});
