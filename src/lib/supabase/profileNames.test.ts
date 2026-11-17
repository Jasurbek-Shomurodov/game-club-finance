import { describe, expect, it, vi } from 'vitest';
import { fetchProfileNames } from './profileNames';

type Row = { id: string; full_name: string | null };

function fakeClient(rows: Row[], error: unknown = null) {
  const requested: string[][] = [];
  const from = vi.fn(() => ({
    select: () => ({
      in: (_column: string, ids: string[]) => {
        requested.push(ids);
        return Promise.resolve(error ? { data: null, error } : { data: rows.filter((row) => ids.includes(row.id)), error: null });
      },
    }),
  }));
  return { supabase: { from } as never, requested };
}

describe('fetchProfileNames', () => {
  it('reads each distinct id once and skips empty ids', async () => {
    const { supabase, requested } = fakeClient([{ id: 'u1', full_name: 'Aziz' }, { id: 'u2', full_name: 'Bek' }]);
    const names = await fetchProfileNames(supabase, ['u1', null, 'u2', 'u1', undefined, '']);
    expect(requested).toEqual([['u1', 'u2']]);
    expect(Object.fromEntries(names)).toEqual({ u1: 'Aziz', u2: 'Bek' });
  });

  it('makes no request when there is nobody to name', async () => {
    const { supabase, requested } = fakeClient([]);
    await expect(fetchProfileNames(supabase, [null, undefined])).resolves.toEqual(new Map());
    expect(requested).toEqual([]);
  });

  it('answers known names from memory and asks only for new ids', async () => {
    const { supabase, requested } = fakeClient([{ id: 'u1', full_name: 'Aziz' }, { id: 'u2', full_name: 'Bek' }]);
    await fetchProfileNames(supabase, ['u1']);
    const names = await fetchProfileNames(supabase, ['u1', 'u2']);
    expect(requested).toEqual([['u1'], ['u2']]);
    expect(Object.fromEntries(names)).toEqual({ u1: 'Aziz', u2: 'Bek' });
    await fetchProfileNames(supabase, ['u2', 'u1']);
    expect(requested).toHaveLength(2);
  });

  it('asks again for an id without a profile and once a name has expired', async () => {
    const { supabase, requested } = fakeClient([{ id: 'u1', full_name: 'Aziz' }]);
    let time = 0;
    const now = () => time;
    const first = await fetchProfileNames(supabase, ['u1', 'ghost'], now);
    expect(first.has('ghost')).toBe(false);
    await fetchProfileNames(supabase, ['u1', 'ghost'], now);
    expect(requested).toEqual([['u1', 'ghost'], ['ghost']]);
    time = 10 * 60_000;
    await fetchProfileNames(supabase, ['u1'], now);
    expect(requested[2]).toEqual(['u1']);
  });

  it('keeps one client from answering for another', async () => {
    const first = fakeClient([{ id: 'u1', full_name: 'Aziz' }]);
    const second = fakeClient([{ id: 'u1', full_name: 'Renamed' }]);
    await fetchProfileNames(first.supabase, ['u1']);
    const names = await fetchProfileNames(second.supabase, ['u1']);
    expect(names.get('u1')).toBe('Renamed');
  });

  it('throws a failed read and caches nothing from it', async () => {
    const error = { code: '42501', message: 'profiles denied' };
    const { supabase, requested } = fakeClient([], error);
    await expect(fetchProfileNames(supabase, ['u1'])).rejects.toBe(error);
    await expect(fetchProfileNames(supabase, ['u1'])).rejects.toBe(error);
    expect(requested).toHaveLength(2);
  });
});
