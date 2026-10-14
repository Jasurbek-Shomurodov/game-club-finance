import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadUserMemberships, MembershipLoadError, relatedClub } from './memberships';

type Result = { data: unknown; error: { code?: string; message?: string } | null };

function client(results: Result[]) {
  const selects: string[] = [];
  const from = vi.fn(() => ({
    select: (columns: string) => {
      selects.push(columns);
      return { eq: () => ({ order: async () => results.shift() ?? { data: [], error: null } }) };
    },
  }));
  return { supabase: { from } as unknown as SupabaseClient, selects };
}

const missing = (column: string) => ({ code: '42703', message: `column club_memberships.${column} does not exist` });

describe('loadUserMemberships', () => {
  it('reads every column in one call on a current database', async () => {
    const { supabase, selects } = client([{ data: [{ club_id: 'a' }], error: null }]);
    await expect(loadUserMemberships(supabase, 'user-1')).resolves.toEqual([{ club_id: 'a' }]);
    expect(selects).toHaveLength(1);
    expect(selects[0]).toContain('feature_access');
    expect(selects[0]).toContain('enabled_payment_methods');
  });

  it.each([
    [['feature_access', 'enabled_payment_methods']],
    [['enabled_payment_methods', 'feature_access']],
  ])('drops missing columns one at a time (%j)', async (order) => {
    const { supabase, selects } = client([
      { data: null, error: missing(order[0]) },
      { data: null, error: missing(order[1]) },
      { data: [{ club_id: 'legacy' }], error: null },
    ]);
    await expect(loadUserMemberships(supabase, 'user-1')).resolves.toEqual([{ club_id: 'legacy' }]);
    expect(selects).toHaveLength(3);
    expect(selects[2]).not.toContain('feature_access');
    expect(selects[2]).not.toContain('enabled_payment_methods');
  });

  it('throws on any other error, including one raised by a fallback query', async () => {
    const first = client([{ data: null, error: { code: '57014', message: 'statement timeout' } }]);
    await expect(loadUserMemberships(first.supabase, 'user-1')).rejects.toBeInstanceOf(MembershipLoadError);

    const fallback = client([
      { data: null, error: missing('feature_access') },
      { data: null, error: { code: '42501', message: 'permission denied' } },
    ]);
    await expect(loadUserMemberships(fallback.supabase, 'user-1')).rejects.toThrow('permission denied');
  });

  it('unwraps the club relation', () => {
    const club = { id: 'a' } as never;
    expect(relatedClub(club)).toBe(club);
    expect(relatedClub([club])).toBe(club);
    expect(relatedClub([])).toBeNull();
    expect(relatedClub(null)).toBeNull();
  });
});
