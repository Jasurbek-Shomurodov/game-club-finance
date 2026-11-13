import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchDailyCashCollections, fetchIsDateCollected, isDayCollectedError } from './dailyCashCollections';

type Result = { data: unknown; error: unknown };
type Call = [string, unknown[]];

/** Every `from(table)` starts a fresh chainable read that records its filters and resolves to `tables[table]`. */
function fakeClient(tables: Record<string, Result>) {
  const reads: Array<{ table: string; calls: Call[] }> = [];
  const from = vi.fn((table: string) => {
    const calls: Call[] = [];
    reads.push({ table, calls });
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range', 'maybeSingle']) {
      chain[method] = (...args: unknown[]) => { calls.push([method, args]); return chain; };
    }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(tables[table] ?? { data: [], error: null }).then(resolve);
    return chain;
  });
  const callsOf = (table: string) => reads.find((read) => read.table === table)?.calls ?? [];
  return { supabase: { from } as unknown as SupabaseClient, reads, callsOf };
}

const collected = (date: string, by: string) => ({ date, collected_by: by, collected_at: `${date}T20:00:00Z` });

describe('fetchDailyCashCollections', () => {
  it('reads the club dates inside the range and names each collector', async () => {
    const { supabase, callsOf } = fakeClient({
      daily_cash_collections: { data: [collected('2026-11-01', 'u1'), collected('2026-11-02', 'u2'), collected('2026-11-03', 'u1')], error: null },
      profiles: { data: [{ id: 'u1', full_name: 'Aziz' }], error: null },
    });

    const rows = await fetchDailyCashCollections(supabase, 'club-1', '2026-11-01', '2026-11-30');

    expect(callsOf('daily_cash_collections')).toEqual(expect.arrayContaining([
      ['eq', ['club_id', 'club-1']],
      ['gte', ['date', '2026-11-01']],
      ['lte', ['date', '2026-11-30']],
    ]));
    // Two days by the same collector need one profile lookup.
    expect(callsOf('profiles')).toEqual([['select', ['id,full_name']], ['in', ['id', ['u1', 'u2']]]]);
    expect(rows).toEqual([
      { ...collected('2026-11-01', 'u1'), collector_name: 'Aziz' },
      // A collector without a profile row keeps the day, without a name.
      { ...collected('2026-11-02', 'u2'), collector_name: null },
      { ...collected('2026-11-03', 'u1'), collector_name: 'Aziz' },
    ]);
  });

  it('has nothing collected and reads no profiles for an empty range', async () => {
    const { supabase, reads } = fakeClient({ daily_cash_collections: { data: null, error: null } });
    await expect(fetchDailyCashCollections(supabase, 'club-1', '2026-11-01', '2026-11-30')).resolves.toEqual([]);
    expect(reads.map((read) => read.table)).toEqual(['daily_cash_collections']);
  });

  it('has nothing collected before migration 096 creates the table', async () => {
    const { supabase } = fakeClient({
      daily_cash_collections: { data: null, error: { code: '42P01', message: 'relation "public.daily_cash_collections" does not exist' } },
    });
    await expect(fetchDailyCashCollections(supabase, 'club-1', '2026-11-01', '2026-11-30')).resolves.toEqual([]);
  });

  it('throws any other read error', async () => {
    const error = { code: '42501', message: 'denied' };
    const { supabase } = fakeClient({ daily_cash_collections: { data: null, error } });
    await expect(fetchDailyCashCollections(supabase, 'club-1', '2026-11-01', '2026-11-30')).rejects.toBe(error);
  });

  it('throws a failed profiles read', async () => {
    const error = { code: '42501', message: 'profiles denied' };
    const { supabase } = fakeClient({
      daily_cash_collections: { data: [collected('2026-11-01', 'u1')], error: null },
      profiles: { data: null, error },
    });
    await expect(fetchDailyCashCollections(supabase, 'club-1', '2026-11-01', '2026-11-30')).rejects.toBe(error);
  });

  it('keeps the days without names when profiles returns no rows', async () => {
    const { supabase } = fakeClient({
      daily_cash_collections: { data: [collected('2026-11-01', 'u1')], error: null },
      profiles: { data: null, error: null },
    });
    await expect(fetchDailyCashCollections(supabase, 'club-1', '2026-11-01', '2026-11-30'))
      .resolves.toEqual([{ ...collected('2026-11-01', 'u1'), collector_name: null }]);
  });
});

describe('isDayCollectedError', () => {
  it('recognises the 097 refusal by hint or message only', () => {
    expect(isDayCollectedError({ hint: 'day_collected' })).toBe(true);
    expect(isDayCollectedError({ code: 'P0001', message: 'This day is closed: its money was collected' })).toBe(true);
    expect(isDayCollectedError({ code: 'P0001', hint: 'note_required', message: 'note must have at least 10 characters' })).toBe(false);
    expect(isDayCollectedError({ code: '42501' })).toBe(false);
    expect(isDayCollectedError(null)).toBe(false);
    expect(isDayCollectedError(undefined)).toBe(false);
  });
});

describe('fetchIsDateCollected', () => {
  it('asks for exactly this club and date', async () => {
    const { supabase, callsOf } = fakeClient({ daily_cash_collections: { data: { date: '2026-11-11' }, error: null } });
    await expect(fetchIsDateCollected(supabase, 'club-1', '2026-11-11')).resolves.toBe(true);
    expect(callsOf('daily_cash_collections')).toEqual([
      ['select', ['date']],
      ['eq', ['club_id', 'club-1']],
      ['eq', ['date', '2026-11-11']],
      ['maybeSingle', []],
    ]);
  });

  it('is false for an open day and before migration 096', async () => {
    await expect(fetchIsDateCollected(fakeClient({ daily_cash_collections: { data: null, error: null } }).supabase, 'club-1', '2026-11-11')).resolves.toBe(false);
    const missing = fakeClient({ daily_cash_collections: { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } } });
    await expect(fetchIsDateCollected(missing.supabase, 'club-1', '2026-11-11')).resolves.toBe(false);
  });

  it('throws any other error instead of treating the day as open', async () => {
    const error = { code: '42501', message: 'denied' };
    const { supabase } = fakeClient({ daily_cash_collections: { data: null, error } });
    await expect(fetchIsDateCollected(supabase, 'club-1', '2026-11-11')).rejects.toBe(error);
  });
});
