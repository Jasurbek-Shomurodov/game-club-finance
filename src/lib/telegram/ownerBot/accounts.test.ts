import { describe, expect, it } from 'vitest';
import { fakeSupabase } from './__tests__/fakeSupabase';
import { fetchOwnerBotClubs, isOwnerBotLinkStatus, isOwnerBotTelegramLinked, redeemOwnerBotLinkCode } from './accounts';

describe('owner bot accounts', () => {
  it('finds a link by the sender\'s Telegram id only', async () => {
    const { supabase, reads } = fakeSupabase({ tables: { owner_telegram_links: [{ user_id: 'u1', telegram_user_id: 7 }] } });
    expect(await isOwnerBotTelegramLinked(supabase, 7)).toBe(true);
    expect(await isOwnerBotTelegramLinked(supabase, 8)).toBe(false);
    expect(reads.map((read) => read.filters)).toEqual([{ telegram_user_id: 7 }, { telegram_user_id: 8 }]);
  });

  it('throws when the link cannot be read', async () => {
    const { supabase } = fakeSupabase({ failTables: ['owner_telegram_links'] });
    await expect(isOwnerBotTelegramLinked(supabase, 7)).rejects.toMatchObject({ message: 'owner_telegram_links unavailable' });
  });

  it('keeps only club rows with an id and names nameless ones', async () => {
    const { supabase } = fakeSupabase({
      rpc: { owner_bot_owner_clubs: () => ({ data: [{ id: 'a', name: 'Square' }, { id: 'b', name: '' }, { id: null, name: 'x' }], error: null }) },
    });
    expect(await fetchOwnerBotClubs(supabase, 7)).toEqual([{ id: 'a', name: 'Square' }, { id: 'b', name: '—' }]);
    const failing = fakeSupabase({ rpc: { owner_bot_owner_clubs: () => ({ data: null, error: { message: 'boom' } }) } });
    await expect(fetchOwnerBotClubs(failing.supabase, 7)).rejects.toMatchObject({ message: 'boom' });
  });

  it('redeems through the throttled function', async () => {
    const { supabase, rpcCalls } = fakeSupabase({ rpc: { owner_bot_redeem_link_code_limited: () => ({ data: 'used', error: null }) } });
    expect(await redeemOwnerBotLinkCode(supabase, { code: 'ABCD2345', telegramUserId: 7, username: null })).toBe('used');
    expect(rpcCalls[0].name).toBe('owner_bot_redeem_link_code_limited');
    expect(isOwnerBotLinkStatus('rate_limited')).toBe(true);
    expect(isOwnerBotLinkStatus(3)).toBe(false);
  });
});
