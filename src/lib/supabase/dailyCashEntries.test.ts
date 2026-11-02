import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { deleteDailyCashEntry } from './dailyCashEntries';

function deleteClient(result: { data: unknown[] | null; error: { message: string; hint?: string } | null }) {
  const filters: Array<[string, string]> = [];
  const builder = {
    delete: () => builder,
    eq: (column: string, value: string) => { filters.push([column, value]); return builder; },
    select: vi.fn().mockResolvedValue(result),
  };
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, from, filters };
}

describe('deleteDailyCashEntry', () => {
  it('scopes the delete to the club and entry and confirms the deleted row', async () => {
    const { client, from, filters } = deleteClient({ data: [{ id: 'entry-1' }], error: null });

    await expect(deleteDailyCashEntry(client, 'club-1', 'entry-1')).resolves.toBe('deleted');
    expect(from).toHaveBeenCalledWith('daily_cash_entries');
    expect(filters).toEqual([['club_id', 'club-1'], ['id', 'entry-1']]);
  });

  it('tells a missing or refused row from a database fault', async () => {
    await expect(deleteDailyCashEntry(deleteClient({ data: [], error: null }).client, 'club-1', 'entry-1')).resolves.toBe('not_found');
    await expect(deleteDailyCashEntry(deleteClient({ data: null, error: { message: 'denied' } }).client, 'club-1', 'entry-1')).resolves.toBe('failed');
  });

  it('reports a collected day as closed', async () => {
    const closed = deleteClient({ data: null, error: { message: 'this day is closed.', hint: 'day_collected' } });
    await expect(deleteDailyCashEntry(closed.client, 'club-1', 'entry-1')).resolves.toBe('day_closed');
  });
});
