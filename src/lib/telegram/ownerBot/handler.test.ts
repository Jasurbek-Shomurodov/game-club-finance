import { describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './__tests__/fakeSupabase';
import { isOwnerBotLinkStatus } from './accounts';
import { handleOwnerBotMessage } from './handler';
import { clubsText, linkResultText, linkUsageText, noClubsText, notLinkedText, startText } from './texts';
import type { OwnerBotMessage } from './update';

const TELEGRAM = 4242;
const CLUB = '10000000-0000-0000-0000-000000000001';
const BROKEN = '10000000-0000-0000-0000-000000000002';
const NOW = new Date('2026-11-28T05:00:00Z');

const message = (text: string): OwnerBotMessage => ({ updateId: 1, chatId: TELEGRAM, telegramUserId: TELEGRAM, username: 'pixel_owner', text });

function setup({ linked = true, clubs = [{ id: CLUB, name: 'Square' }], status = 'linked' } = {}) {
  return fakeSupabase({
    tables: {
      owner_telegram_links: linked ? [{ user_id: 'u1', telegram_user_id: TELEGRAM }] : [],
      clubs: [{ id: CLUB, business_day_start_hour: 0, enabled_payment_methods: ['cash'] }],
      daily_cash_entries: [{ club_id: CLUB, date: '2026-11-27', cash_income: 1_200_000, terminal_income: 0, card_income: 0, playstation_income: 0 }],
      daily_stock_counts: [{ club_id: CLUB, product_id: 'a', date: '2026-11-27', bar_income: 450_000 }],
    },
    rpc: {
      owner_bot_redeem_link_code_limited: () => ({ data: status, error: null }),
      owner_bot_owner_clubs: (args) => ({ data: args.p_telegram_user_id === TELEGRAM && linked ? clubs : [], error: null }),
    },
  });
}

describe('handleOwnerBotMessage', () => {
  it('redeems /link and /start codes for the sender and answers the status', async () => {
    const { supabase, rpcCalls } = setup({ linked: false });
    expect(await handleOwnerBotMessage(supabase, message('/link abcd2345'), { now: NOW })).toEqual([linkResultText('linked')]);
    expect(await handleOwnerBotMessage(supabase, message('/start ABCD2345'), { now: NOW })).toEqual([linkResultText('linked')]);
    expect(rpcCalls).toEqual([
      { name: 'owner_bot_redeem_link_code_limited', args: { p_code: 'abcd2345', p_telegram_user_id: TELEGRAM, p_username: 'pixel_owner' } },
      { name: 'owner_bot_redeem_link_code_limited', args: { p_code: 'ABCD2345', p_telegram_user_id: TELEGRAM, p_username: 'pixel_owner' } },
    ]);
  });

  it('answers each refusal, including too many wrong codes', async () => {
    for (const status of ['invalid', 'expired', 'rate_limited', 'telegram_in_use'] as const) {
      const { supabase } = setup({ linked: false, status });
      expect(await handleOwnerBotMessage(supabase, message('/link ZZZZZZZZ'))).toEqual([linkResultText(status)]);
    }
  });

  it('fails on a status it does not know, or a database without 191', async () => {
    const odd = setup({ status: 'maybe' });
    await expect(handleOwnerBotMessage(odd.supabase, message('/link ZZZZZZZZ'))).rejects.toThrow(/unknown status/);
    const old = fakeSupabase({ rpc: {} });
    await expect(handleOwnerBotMessage(old.supabase, message('/link ZZZZZZZZ'))).rejects.toMatchObject({ code: 'PGRST202' });
    expect(isOwnerBotLinkStatus('maybe')).toBe(false);
  });

  it('asks for the code when /link has none', async () => {
    const { supabase, rpcCalls } = setup();
    expect(await handleOwnerBotMessage(supabase, message('/link'))).toEqual([linkUsageText()]);
    expect(rpcCalls).toEqual([]);
  });

  it('greets linked and unlinked people differently', async () => {
    expect(await handleOwnerBotMessage(setup().supabase, message('/start'))).toEqual([startText(true)]);
    expect(await handleOwnerBotMessage(setup({ linked: false }).supabase, message('/start'))).toEqual([startText(false)]);
  });

  it('tells an unlinked person to link from Settings before /clubs, /today or anything else', async () => {
    const { supabase, rpcCalls } = setup({ linked: false });
    for (const text of ['/clubs', '/today', 'hello', '/help']) {
      expect(await handleOwnerBotMessage(supabase, message(text))).toEqual([notLinkedText()]);
    }
    expect(rpcCalls).toEqual([]);
  });

  it('lists the linked owner\'s clubs, or says there are none', async () => {
    expect(await handleOwnerBotMessage(setup().supabase, message('/clubs'))).toEqual([clubsText([{ id: CLUB, name: 'Square' }])]);
    expect(await handleOwnerBotMessage(setup({ clubs: [] }).supabase, message('/clubs'))).toEqual([noClubsText()]);
    expect(await handleOwnerBotMessage(setup({ clubs: [] }).supabase, message('/today'))).toEqual([noClubsText()]);
  });

  it('sends one /today message per owned club, and a short notice for a club it could not read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = setup({ clubs: [{ id: CLUB, name: 'Square' }, { id: BROKEN, name: 'Algoritm' }] });
    const replies = await handleOwnerBotMessage(supabase, message('/today'), { now: NOW });
    expect(replies).toHaveLength(2);
    expect(replies[0]).toBe('🏢 Square · 27 ноября 2026\n💵 Наличные: 1 200 000 сум\n🍺 Бар (продажи): 450 000 сум');
    expect(replies[1]).toMatch(/^⚠️ Algoritm:/);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
