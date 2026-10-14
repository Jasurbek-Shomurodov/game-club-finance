import { describe, expect, it } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { actorName } from './actorName';

function client(fullName: unknown) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data: fullName === undefined ? null : { full_name: fullName }, error: null });
  return { from: () => builder } as unknown as SupabaseClient;
}

const user = (metadata: Record<string, unknown> = {}, email?: string) => ({ id: 'user-1', email, user_metadata: metadata }) as unknown as User;

describe('actorName', () => {
  it('prefers the trimmed profile name', async () => {
    expect(await actorName(client('  Owner  '), user({ full_name: 'Meta' }, 'o@example.test'))).toBe('Owner');
  });

  it('falls back to metadata, email, then id', async () => {
    expect(await actorName(client(' '), user({ full_name: ' Meta ' }))).toBe('Meta');
    expect(await actorName(client(undefined), user({}, 'o@example.test'))).toBe('o@example.test');
    expect(await actorName(client(null), user())).toBe('user-1');
  });
});
