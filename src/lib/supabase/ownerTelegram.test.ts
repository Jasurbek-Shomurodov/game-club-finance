import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createOwnerTelegramLinkCode, fetchOwnTelegramLink, unlinkOwnTelegram } from './ownerTelegram';

/** A chainable query that records its calls and resolves to `result`. */
function query(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'delete', 'maybeSingle']) {
    chain[method] = vi.fn((...args: unknown[]) => { calls.push([method, args]); return chain; });
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { chain, calls };
}

const clientWith = (chain: unknown) => ({ from: vi.fn(() => chain) }) as unknown as SupabaseClient;
const rpcClient = (result: { data: unknown; error: unknown }) => ({ rpc: vi.fn(async () => result) }) as unknown as SupabaseClient;

describe('fetchOwnTelegramLink', () => {
  it('reads only the signed-in user\'s link, with a numeric Telegram id', async () => {
    const { chain, calls } = query({ data: { user_id: 'u1', telegram_user_id: '111222333', telegram_username: 'pixel_owner', linked_at: '2026-11-28T08:00:00Z' }, error: null });
    await expect(fetchOwnTelegramLink(clientWith(chain), 'u1')).resolves.toEqual({
      available: true,
      link: { user_id: 'u1', telegram_user_id: 111222333, telegram_username: 'pixel_owner', linked_at: '2026-11-28T08:00:00Z' },
    });
    expect(calls).toContainEqual(['eq', ['user_id', 'u1']]);
  });

  it('reports no link, and an unavailable feature before migration 190', async () => {
    await expect(fetchOwnTelegramLink(clientWith(query({ data: null, error: null }).chain), 'u1')).resolves.toEqual({ link: null, available: true });
    const missing = query({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.owner_telegram_links'" } });
    await expect(fetchOwnTelegramLink(clientWith(missing.chain), 'u1')).resolves.toEqual({ link: null, available: false });
  });

  it('throws any other error', async () => {
    const { chain } = query({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(fetchOwnTelegramLink(clientWith(chain), 'u1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('createOwnerTelegramLinkCode', () => {
  it('returns the new code and when it stops working', async () => {
    const client = rpcClient({ data: [{ code: 'ABCD2345', expires_at: '2026-11-28T08:15:00Z' }], error: null });
    await expect(createOwnerTelegramLinkCode(client)).resolves.toEqual({ code: 'ABCD2345', expiresAt: '2026-11-28T08:15:00Z' });
    expect(client.rpc).toHaveBeenCalledWith('create_owner_telegram_link_code');
  });

  it('throws the database error, or when no code came back', async () => {
    await expect(createOwnerTelegramLinkCode(rpcClient({ data: null, error: { code: '42501', message: 'Only a club owner' } })))
      .rejects.toMatchObject({ code: '42501' });
    await expect(createOwnerTelegramLinkCode(rpcClient({ data: [], error: null }))).rejects.toThrow('returned no code');
  });
});

describe('unlinkOwnTelegram', () => {
  it('deletes only the signed-in user\'s link and says whether one was removed', async () => {
    const removed = query({ data: [{ user_id: 'u1' }], error: null });
    await expect(unlinkOwnTelegram(clientWith(removed.chain), 'u1')).resolves.toBe(true);
    expect(removed.calls.map(([method]) => method)).toEqual(['delete', 'eq', 'select']);
    expect(removed.calls).toContainEqual(['eq', ['user_id', 'u1']]);
    await expect(unlinkOwnTelegram(clientWith(query({ data: [], error: null }).chain), 'u1')).resolves.toBe(false);
  });

  it('throws a failed delete', async () => {
    await expect(unlinkOwnTelegram(clientWith(query({ data: null, error: { code: '500', message: 'down' } }).chain), 'u1'))
      .rejects.toMatchObject({ code: '500' });
  });
});
