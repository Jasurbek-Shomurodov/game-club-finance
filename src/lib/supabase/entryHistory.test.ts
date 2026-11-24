import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { AUDIT_CREATION_TABLES, AUDITED_TABLES } from '@/lib/entryHistory';
import { fetchEntryHistory } from './entryHistory';

type Result = { data: unknown[] | null; error: { message: string; code?: string } | null };

/** A chainable stand-in: every filter is recorded, awaiting or `range` resolves the table's result. */
function fakeClient(results: Record<string, Result>) {
  const calls: Record<string, Array<[string, ...unknown[]]>> = {};
  const from = (table: string) => {
    calls[table] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'neq', 'not', 'or', 'gte', 'lte', 'order', 'in']) {
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
    // Only the record types /history labels; of their creations only products, promotions,
    // team access and planned expenses: money entries show once edited or deleted.
    expect(calls.entry_audit_logs).toContainEqual(['in', 'table_name', [...AUDITED_TABLES]]);
    expect(calls.entry_audit_logs).toContainEqual(['or', 'action.neq.insert,table_name.in.(products,promotions,club_memberships,expense_presets)']);
    expect(AUDITED_TABLES).toContain('money_collections');
    expect(AUDITED_TABLES).toContain('stock_purchases');
    for (const ledger of ['owner_withdrawals', 'owner_profit_carryovers', 'stock_purchases', 'new_debts', 'debt_payments', 'owner_reserve_entries', 'salary_entries']) {
      expect(AUDIT_CREATION_TABLES).not.toContain(ledger);
    }
    expect(calls.entry_audit_logs).toContainEqual(['gte', 'changed_on', '2026-10-01']);
    expect(calls.entry_audit_logs).toContainEqual(['lte', 'changed_on', '2026-10-31']);
    expect(calls.products).toContainEqual(['eq', 'club_id', 'club-1']);
    expect(calls.profiles).toContainEqual(['in', 'id', ['user-1', 'user-2']]);
  });

  it('resolves the product of a stock count, a team member and a salary employee', async () => {
    const logs = [
      { ...log, id: 2, table_name: 'daily_stock_counts', row_id: 'c1', action: 'update', old_row: { product_id: 'prod-1', closing_stock: 5 }, new_row: { product_id: 'prod-1', closing_stock: 4 } },
      { ...log, id: 3, table_name: 'club_memberships', row_id: 'user-3', action: 'insert', old_row: null, new_row: { role: 'admin', feature_access: null } },
      { ...log, id: 4, table_name: 'salary_entries', row_id: 's1', action: 'update', old_row: { employee_id: 'emp-1', payment_method: 'cash' }, new_row: { employee_id: 'emp-1', payment_method: 'card' } },
    ];
    const { client, calls } = fakeClient({
      entry_audit_logs: { data: logs, error: null },
      profiles: { data: [{ id: 'user-1', full_name: 'Owner' }, { id: 'user-3', full_name: 'New admin' }], error: null },
      products: { data: [{ id: 'prod-1', name: 'Cola' }], error: null },
      salary_employees: { data: [{ id: 'emp-1', name: 'Aziz' }], error: null },
    });

    const history = await fetchEntryHistory(client, 'club-1', '2026-10-01', '2026-10-31');

    expect(history.names.get('user-3')).toBe('New admin');
    expect(history.products.get('prod-1')).toBe('Cola');
    expect(history.employees.get('emp-1')).toBe('Aziz');
    expect(calls.salary_employees).toContainEqual(['eq', 'club_id', 'club-1']);
    expect(calls.salary_employees).toContainEqual(['in', 'id', ['emp-1']]);
  });

  it('skips name lookups for an empty period', async () => {
    const { client, calls } = fakeClient({ entry_audit_logs: { data: [], error: null } });
    const history = await fetchEntryHistory(client, 'club-1', '2026-10-01', '2026-10-31');
    expect(history.logs).toEqual([]);
    expect(calls.profiles).toBeUndefined();
    expect(calls.products).toBeUndefined();
    expect(calls.salary_employees).toBeUndefined();
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
