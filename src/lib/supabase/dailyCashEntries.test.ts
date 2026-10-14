import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { deleteDailyCashEntry } from './dailyCashEntries';

function deleteClient(result: { data: unknown[] | null; error: { message: string } | null }) {
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

    await expect(deleteDailyCashEntry(client, 'club-1', 'entry-1')).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('daily_cash_entries');
    expect(filters).toEqual([['club_id', 'club-1'], ['id', 'entry-1']]);
  });

  it('reports failure when RLS filters the row out or the database errors', async () => {
    await expect(deleteDailyCashEntry(deleteClient({ data: [], error: null }).client, 'club-1', 'entry-1')).resolves.toBe(false);
    await expect(deleteDailyCashEntry(deleteClient({ data: null, error: { message: 'denied' } }).client, 'club-1', 'entry-1')).resolves.toBe(false);
  });
});
