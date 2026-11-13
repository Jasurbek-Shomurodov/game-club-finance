import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  EMPTY_CASH_SHORTAGES,
  deleteCashShortage,
  fetchCashShortages,
  recoverCashShortage,
  shortageErrorCode,
} from './cashShortages';

type Result = { data: unknown; error: unknown };
type Call = [string, unknown[]];

/** Every `from(table)` starts a fresh chainable read that records its filters and resolves to `tables[table]`. */
function fakeClient(tables: Record<string, Result>) {
  const reads: Array<{ table: string; calls: Call[] }> = [];
  const from = vi.fn((table: string) => {
    const calls: Call[] = [];
    reads.push({ table, calls });
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'not', 'is', 'order', 'range']) {
      chain[method] = (...args: unknown[]) => { calls.push([method, args]); return chain; };
    }
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(tables[table] ?? { data: [], error: null }).then(resolve);
    return chain;
  });
  const callsOf = (table: string) => reads.find((read) => read.table === table)?.calls ?? [];
  return { supabase: { from } as unknown as SupabaseClient, reads, callsOf };
}

const rpcClient = (error: unknown = null) => {
  const rpc = vi.fn(() => Promise.resolve({ data: null, error }));
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
};

describe('fetchCashShortages', () => {
  it('scopes all three reads to the club and reads only live recovery fines', async () => {
    const { supabase, reads, callsOf } = fakeClient({});
    await fetchCashShortages(supabase, 'club-1');

    expect(reads.map((read) => read.table).sort()).toEqual(['cash_shortages', 'salary_employees', 'salary_entries']);
    for (const read of reads) expect(read.calls).toContainEqual(['eq', ['club_id', 'club-1']]);
    // A recovery is a salary entry linked to a shortage that was not deleted.
    expect(callsOf('salary_entries')).toContainEqual(['not', ['cash_shortage_id', 'is', null]]);
    expect(callsOf('salary_entries')).toContainEqual(['is', ['deleted_at', null]]);
  });

  it('returns numeric amounts and employees by name, hidden ones flagged', async () => {
    const { supabase } = fakeClient({
      cash_shortages: { data: [{ id: 's1', club_id: 'club-1', date: '2026-11-10', amount: '300000', employee_id: 'e2' }], error: null },
      salary_entries: { data: [{ id: 'r1', cash_shortage_id: 's1', amount: '100000', date: '2026-11-11' }], error: null },
      salary_employees: {
        data: [
          { id: 'e1', name: 'Zafar', deleted_at: null },
          { id: 'e2', name: 'Aziz', deleted_at: '2026-10-01T00:00:00Z' },
          { id: 'e3', name: 'Madina' },
        ],
        error: null,
      },
    });

    await expect(fetchCashShortages(supabase, 'club-1')).resolves.toEqual({
      shortages: [{ id: 's1', club_id: 'club-1', date: '2026-11-10', amount: 300_000, employee_id: 'e2' }],
      recoveries: [{ id: 'r1', cash_shortage_id: 's1', amount: 100_000, date: '2026-11-11' }],
      // Hidden employees stay so an old shortage keeps its name.
      employees: [
        { id: 'e2', name: 'Aziz', hidden: true },
        { id: 'e3', name: 'Madina', hidden: false },
        { id: 'e1', name: 'Zafar', hidden: false },
      ],
      supported: true,
    });
  });

  it('reports an empty supported ledger when the club has no shortages', async () => {
    const { supabase } = fakeClient({
      cash_shortages: { data: null, error: null },
      salary_entries: { data: null, error: null },
      salary_employees: { data: null, error: null },
    });
    await expect(fetchCashShortages(supabase, 'club-1')).resolves.toEqual({ shortages: [], recoveries: [], employees: [], supported: true });
  });

  it('has no shortages before migration 135 creates the table', async () => {
    const { supabase } = fakeClient({
      cash_shortages: { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.cash_shortages'" } },
    });
    await expect(fetchCashShortages(supabase, 'club-1')).resolves.toBe(EMPTY_CASH_SHORTAGES);
    expect(EMPTY_CASH_SHORTAGES).toEqual({ shortages: [], recoveries: [], employees: [], supported: false });
  });

  it('has no shortages before migration 135 adds the recovery link column', async () => {
    const { supabase } = fakeClient({
      salary_entries: { data: null, error: { code: '42703', message: 'column salary_entries.cash_shortage_id does not exist' } },
    });
    await expect(fetchCashShortages(supabase, 'club-1')).resolves.toBe(EMPTY_CASH_SHORTAGES);
  });

  it.each([
    ['cash_shortages', { code: '42501', message: 'permission denied for table cash_shortages' }],
    // A different missing column is a real fault, not "migration not applied".
    ['salary_entries', { code: '42703', message: 'column salary_entries.deleted_at does not exist' }],
    ['salary_employees', { code: '42501', message: 'permission denied for table salary_employees' }],
  ])('throws a failed %s read', async (table, error) => {
    const { supabase } = fakeClient({ [table]: { data: null, error } });
    await expect(fetchCashShortages(supabase, 'club-1')).rejects.toBe(error);
  });
});

describe('shortageErrorCode', () => {
  it('maps each database refusal to what the page says', () => {
    expect(shortageErrorCode({ code: 'PGRST202', message: 'Could not find the function public.record_cash_shortage' }, 'record_cash_shortage')).toBe('migration_required');
    expect(shortageErrorCode({ code: 'P0001', hint: 'note_required', message: 'note must have at least 10 characters' }, 'record_cash_shortage')).toBe('note_required');
    expect(shortageErrorCode({ code: 'P0001', hint: 'day_collected' }, 'record_cash_shortage')).toBe('day_collected');
    expect(shortageErrorCode({ code: 'P0001', message: 'This day is closed' }, 'delete_cash_shortage')).toBe('day_collected');
    expect(shortageErrorCode({ code: 'P0001', hint: 'shortage_recovery_too_large' }, 'recover_cash_shortage')).toBe('recovery_too_large');
    expect(shortageErrorCode({ code: 'P0001', hint: 'shortage_no_employee' }, 'recover_cash_shortage')).toBe('no_employee');
    expect(shortageErrorCode({ code: 'P0001', hint: 'shortage_has_recoveries' }, 'delete_cash_shortage')).toBe('has_recoveries');
    expect(shortageErrorCode({ code: '42501', message: 'Only owners can record shortages' }, 'record_cash_shortage')).toBe('forbidden');
    expect(shortageErrorCode({ code: 'XX000', message: 'boom' }, 'record_cash_shortage')).toBe('failed');
    expect(shortageErrorCode({}, 'record_cash_shortage')).toBe('failed');
  });

  it('does not mistake a missing helper inside the RPC for a missing migration', () => {
    expect(shortageErrorCode({ code: '42883', message: 'function some_helper(uuid) does not exist' }, 'recover_cash_shortage')).toBe('failed');
    expect(shortageErrorCode({ code: '42883', message: 'function recover_cash_shortage(uuid) does not exist' }, 'recover_cash_shortage')).toBe('migration_required');
  });
});

describe('shortage RPC wrappers', () => {
  it('recovers through the atomic RPC with the club, shortage, request id and amount', async () => {
    const { supabase, rpc } = rpcClient();
    await expect(recoverCashShortage(supabase, 'club-1', 'shortage-1', 'request-1', 150_000)).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('recover_cash_shortage', {
      p_club_id: 'club-1', p_shortage_id: 'shortage-1', p_request_id: 'request-1', p_amount: 150_000,
    });
  });

  it('reports why a recovery was refused', async () => {
    expect(await recoverCashShortage(rpcClient({ hint: 'shortage_recovery_too_large' }).supabase, 'club-1', 's', 'r', 1)).toBe('recovery_too_large');
    expect(await recoverCashShortage(rpcClient({ hint: 'shortage_no_employee' }).supabase, 'club-1', 's', 'r', 1)).toBe('no_employee');
    expect(await recoverCashShortage(rpcClient({ code: 'PGRST202', message: 'not found' }).supabase, 'club-1', 's', 'r', 1)).toBe('migration_required');
  });

  it('deletes through the atomic RPC scoped to the club', async () => {
    const { supabase, rpc } = rpcClient();
    await expect(deleteCashShortage(supabase, 'club-1', 'shortage-1')).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith('delete_cash_shortage', { p_club_id: 'club-1', p_shortage_id: 'shortage-1' });
  });

  it('reports why a deletion was refused', async () => {
    expect(await deleteCashShortage(rpcClient({ hint: 'shortage_has_recoveries' }).supabase, 'club-1', 's')).toBe('has_recoveries');
    expect(await deleteCashShortage(rpcClient({ code: '42501' }).supabase, 'club-1', 's')).toBe('forbidden');
    expect(await deleteCashShortage(rpcClient({ hint: 'day_collected' }).supabase, 'club-1', 's')).toBe('day_collected');
  });
});
