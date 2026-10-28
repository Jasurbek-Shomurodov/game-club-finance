import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { fetchEntryHistory } from './entryHistory';

type Result = { data: unknown[] | null; error: { message: string; code?: string } | null };

/** A chainable stand-in: every filter is recorded, awaiting or `range` resolves the table's result. */
function fakeClient(results: Record<string, Result>) {
  const calls: Record<string, Array<[string, ...unknown[]]>> = {};
  const from = (table: string) => {
    calls[table] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'in']) {
      builder[method] = (...args: unknown[]) => { calls[table].push([method, ...args]); return builder; };
    }
    builder.range = () => Promise.resolve(results[table]);
    builder.then = (resolve: (value: Result) => unknown) => resolve(results[table]);
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

const log = {
  id: 1, club_id: 'club-1', table_name: 'stock_purchases', row_id: 'p1', action: 'delete',
  old_row: { id: 'p1', product_id: 'prod-1', created_by: 'user-2' }, new_row: null,
  changed_by: 'user-1', changed_at: '2026-10-25T10:00:00Z', changed_on: '2026-10-25',
};

describe('fetchEntryHistory', () => {
  it('reads one club and period and resolves the names it mentions', async () => {
    const { client, calls } = fakeClient({
      entry_audit_logs: { data: [log], error: null },
      profiles: { data: [{ id: 'user-1', full_name: 'Owner' }, { id: 'user-2', full_name: 'Admin' }], error: null },
      products: { data: [{ id: 'prod-1', name: 'Cola' }], error: null },
    });

    const history = await fetchEntryHistory(client, 'club-1', '2026-10-01', '2026-10-31');

    expect(history.missing).toBe(false);
    expect(history.logs).toEqual([log]);
    expect(history.names.get('user-2')).toBe('Admin');
    expect(history.products.get('prod-1')).toBe('Cola');
    expect(calls.entry_audit_logs).toContainEqual(['eq', 'club_id', 'club-1']);
    expect(calls.entry_audit_logs).toContainEqual(['gte', 'changed_on', '2026-10-01']);
    expect(calls.entry_audit_logs).toContainEqual(['lte', 'changed_on', '2026-10-31']);
    expect(calls.products).toContainEqual(['eq', 'club_id', 'club-1']);
    expect(calls.profiles).toContainEqual(['in', 'id', ['user-1', 'user-2']]);
  });

  it('skips name lookups for an empty period', async () => {
    const { client, calls } = fakeClient({ entry_audit_logs: { data: [], error: null } });
    const history = await fetchEntryHistory(client, 'club-1', '2026-10-01', '2026-10-31');
    expect(history.logs).toEqual([]);
    expect(calls.profiles).toBeUndefined();
    expect(calls.products).toBeUndefined();
  });

  it('reports a database without migration 111 instead of failing', async () => {
    const { client } = fakeClient({ entry_audit_logs: { data: null, error: { code: 'PGRST205', message: 'Could not find the table public.entry_audit_logs' } } });
    await expect(fetchEntryHistory(client, 'club-1', '2026-10-01', '2026-10-31')).resolves.toMatchObject({ missing: true, logs: [] });
  });

  it('throws other failures so the page can offer a retry', async () => {
    const { client } = fakeClient({ entry_audit_logs: { data: null, error: { message: 'network down' } } });
    await expect(fetchEntryHistory(client, 'club-1', '2026-10-01', '2026-10-31')).rejects.toThrow('network down');
  });
});
