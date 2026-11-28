import { describe, expect, it, vi } from 'vitest';
import { fakeSupabase } from './__tests__/fakeSupabase';
import { isOwnerBotLinkStatus } from './accounts';
import { handleOwnerBotMessage } from './handler';
import {
  amountPromptExpiredText,
  clubsText,
  helpText,
  linkResultText,
  linkUsageText,
  noClubsText,
  notLinkedText,
  refusalText,
  startText,
} from './texts';
import type { OwnerBotMessage } from './update';

const TELEGRAM = 4242;
const CLUB = '10000000-0000-0000-0000-000000000001';
const BROKEN = '10000000-0000-0000-0000-000000000002';
const NOW = new Date('2026-11-28T05:00:00Z');
const LINE = '30000000-0000-4000-8000-000000000001';

const plain = (text: string) => ({ text, keyboard: null });
const CHOICE = '30000000-0000-4000-8000-000000000002';
const PROMPT = '30000000-0000-4000-8000-000000000005';
const DAY = '30000000-0000-4000-8000-000000000004';
const message = (text: string, replyToMessageId: number | null = null): OwnerBotMessage => ({
  updateId: 1, chatId: TELEGRAM, telegramUserId: TELEGRAM, username: 'pixel_owner', text, replyToMessageId,
});
const prompt = { id: PROMPT, side: 'game_club', payment_method: 'cash', action: 'collected', max_amount: 1_000_000, day_chat_id: TELEGRAM, day_message_id: 7 };
const today = (date: unknown) => ({
  club_id: CLUB,
  club_name: 'Square',
  business_date: date,
  balances: { cash: { till: 1_000_000, collected: 0 } },
  handovers: [],
  lines: { cash: LINE },
  day_id: DAY,
});

function setup({ linked = true, clubs = [{ id: CLUB, name: 'Square' }], status = 'linked' } = {}) {
  return fakeSupabase({
    tables: {
      owner_telegram_links: linked ? [{ user_id: 'u1', telegram_user_id: TELEGRAM }] : [],
      clubs: [
        { id: CLUB, business_day_start_hour: 0, enabled_payment_methods: ['cash'] },
        // Read fine, but the database refuses acting as its owner.
        { id: BROKEN, business_day_start_hour: 0, enabled_payment_methods: ['cash'] },
      ],
      daily_cash_entries: [{ club_id: CLUB, date: '2026-11-27', cash_income: 1_200_000, terminal_income: 0, card_income: 0, playstation_income: 0 }],
      daily_stock_counts: [{ club_id: CLUB, product_id: 'a', date: '2026-11-27', bar_income: 450_000 }],
    },
    rpc: {
      owner_bot_redeem_link_code_limited: () => ({ data: status, error: null }),
      owner_bot_owner_clubs: (args) => ({ data: args.p_telegram_user_id === TELEGRAM && linked ? clubs : [], error: null }),
      owner_bot_today: (args) => (args.p_club_id === CLUB
        ? { data: today(args.p_date), error: null }
        : { data: null, error: { message: 'Only an owner of this club can do that.', code: '42501', hint: 'owner_bot_not_owner' } }),
      owner_bot_answer_amount: (args) => {
        if (args.p_prompt_message_id !== 901) return { data: null, error: { message: 'gone', code: 'P0002', hint: 'owner_bot_expired' } };
        if (args.p_amount === null) return { data: { status: 'invalid', club_name: 'Square', prompt }, error: null };
        if (Number(args.p_amount) > 1_000_000) return { data: { status: 'too_large', club_name: 'Square', prompt }, error: null };
        return {
          data: {
            ...today('2026-11-27'),
            status: 'chosen',
            prompt,
            pending: { id: CHOICE, kind: 'choice', side: 'game_club', payment_method: 'cash', action: 'collected', amount: args.p_amount, expired: false },
          },
          error: null,
        };
      },
    },
  });
}

describe('handleOwnerBotMessage', () => {
  it('redeems /link and /start codes for the sender and answers the status', async () => {
    const { supabase, rpcCalls } = setup({ linked: false });
    expect(await handleOwnerBotMessage(supabase, message('/link abcd2345'), { now: NOW })).toEqual([plain(linkResultText('linked'))]);
    expect(await handleOwnerBotMessage(supabase, message('/start ABCD2345'), { now: NOW })).toEqual([plain(linkResultText('linked'))]);
    expect(rpcCalls).toEqual([
      { name: 'owner_bot_redeem_link_code_limited', args: { p_code: 'abcd2345', p_telegram_user_id: TELEGRAM, p_username: 'pixel_owner' } },
      { name: 'owner_bot_redeem_link_code_limited', args: { p_code: 'ABCD2345', p_telegram_user_id: TELEGRAM, p_username: 'pixel_owner' } },
    ]);
  });

  it('answers each refusal, including too many wrong codes', async () => {
    for (const status of ['invalid', 'expired', 'rate_limited', 'telegram_in_use'] as const) {
      const { supabase } = setup({ linked: false, status });
      expect(await handleOwnerBotMessage(supabase, message('/link ZZZZZZZZ'))).toEqual([plain(linkResultText(status))]);
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
    expect(await handleOwnerBotMessage(supabase, message('/link'))).toEqual([plain(linkUsageText())]);
    expect(rpcCalls).toEqual([]);
  });

  it('greets linked and unlinked people differently', async () => {
    expect(await handleOwnerBotMessage(setup().supabase, message('/start'))).toEqual([plain(startText(true))]);
    expect(await handleOwnerBotMessage(setup({ linked: false }).supabase, message('/start'))).toEqual([plain(startText(false))]);
  });

  it('tells an unlinked person to link from Settings before /clubs, /today or anything else', async () => {
    const { supabase, rpcCalls } = setup({ linked: false });
    for (const text of ['/clubs', '/today', 'hello', '/help']) {
      expect(await handleOwnerBotMessage(supabase, message(text))).toEqual([plain(notLinkedText())]);
    }
    expect(rpcCalls).toEqual([]);
  });

  it('lists the linked owner\'s clubs, or says there are none', async () => {
    expect(await handleOwnerBotMessage(setup().supabase, message('/clubs'))).toEqual([plain(clubsText([{ id: CLUB, name: 'Square' }]))]);
    expect(await handleOwnerBotMessage(setup({ clubs: [] }).supabase, message('/clubs'))).toEqual([plain(noClubsText())]);
    expect(await handleOwnerBotMessage(setup({ clubs: [] }).supabase, message('/today'))).toEqual([plain(noClubsText())]);
  });

  it('sends one /today message per owned club with its buttons, and a short notice for a club it could not read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase, rpcCalls } = setup({ clubs: [{ id: CLUB, name: 'Square' }, { id: BROKEN, name: 'Algoritm' }] });
    const replies = await handleOwnerBotMessage(supabase, message('/today'), { now: NOW });
    expect(replies).toHaveLength(2);
    expect(replies[0].text).toBe([
      '🏢 Square · 27 ноября 2026',
      '💵 Наличные: 1 000 000 сум (за день 1 200 000 сум) · ⏳ не отмечено',
      '🍺 Бар (продажи): 450 000 сум · ⏳ не отмечено',
      '👛 Осталось у администратора: 1 000 000 сум',
    ].join('\n'));
    expect(replies[0].keyboard).toEqual({ inline_keyboard: [
      [{ text: '💵 Наличные', callback_data: `v1:menu:${LINE}` }],
      [{ text: '🍺 Бар', callback_data: `v1:menu:${DAY}` }],
    ] });
    expect(replies[1]).toEqual({ text: expect.stringMatching(/^⚠️ Algoritm:/), keyboard: null });
    // The day is opened as the linked owner, for that club and its last closed day.
    expect(rpcCalls.filter((call) => call.name === 'owner_bot_today')).toEqual([
      { name: 'owner_bot_today', args: { p_telegram_user_id: TELEGRAM, p_club_id: CLUB, p_date: '2026-11-27' } },
      { name: 'owner_bot_today', args: { p_telegram_user_id: TELEGRAM, p_club_id: BROKEN, p_date: '2026-11-27' } },
    ]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('turns a typed answer to the bot\'s question into the usual confirmation, sent below it', async () => {
    const { supabase, rpcCalls } = setup();
    const [reply] = await handleOwnerBotMessage(supabase, message('500 000', 901), { now: NOW });
    expect(reply.text.split('\n').at(-1)).toBe('✅ Отметить, что вы забрали 500 000 сум · 💵 Наличные · Square?');
    expect(reply.keyboard).toEqual({ inline_keyboard: [[
      { text: '✅ Да', callback_data: `v1:yes:${CHOICE}` },
      { text: '✖️ Нет', callback_data: `v1:no:${CHOICE}` },
    ]] });
    // The day message it was asked from keeps its text and loses its buttons.
    expect(reply.retire).toEqual({ chatId: TELEGRAM, messageId: 7, text: expect.stringMatching(/^🏢 Square · 27 ноября 2026/) });
    expect(reply.retire?.text).not.toContain('?');
    expect(rpcCalls.find((call) => call.name === 'owner_bot_answer_amount')?.args)
      .toEqual({ p_telegram_user_id: TELEGRAM, p_prompt_message_id: 901, p_amount: 500_000 });
  });

  it('asks again, with the reason, after an answer that is not a sum or is too much', async () => {
    const { supabase, rpcCalls } = setup();
    const [notSum] = await handleOwnerBotMessage(supabase, message('пятьсот', 901), { now: NOW });
    expect(notSum).toEqual({ text: expect.stringMatching(/^❌ Не понял сумму/), keyboard: null, promptId: PROMPT });
    expect(rpcCalls.at(-1)?.args.p_amount).toBeNull();
    const [tooMuch] = await handleOwnerBotMessage(supabase, message('2 000 000', 901), { now: NOW });
    expect(tooMuch.text.split('\n')).toEqual([
      '⚠️ Это больше, чем можно.',
      '✏️ Square · 💵 Наличные: сколько забрали?',
      '👇 Ответьте на это сообщение суммой до 1 000 000 сум.',
    ]);
    expect(tooMuch.promptId).toBe(PROMPT);
  });

  it('says a question is over, and answers other replies like any message', async () => {
    const { supabase } = setup();
    expect(await handleOwnerBotMessage(supabase, message('500 000', 902))).toEqual([plain(amountPromptExpiredText())]);
    expect(await handleOwnerBotMessage(supabase, message('спасибо', 902))).toEqual([plain(helpText(true))]);
    // A command is a command, even as a reply.
    expect((await handleOwnerBotMessage(supabase, message('/clubs', 901)))[0].text).toBe(clubsText([{ id: CLUB, name: 'Square' }]));
    const refusing = setup();
    const odd = fakeSupabase({
      rpc: { owner_bot_answer_amount: () => ({ data: null, error: { message: 'marked', code: 'P0001', hint: 'owner_bot_already_marked' } }) },
    });
    expect(await handleOwnerBotMessage(odd.supabase, message('500 000', 901))).toEqual([plain(refusalText('already_marked'))]);
    expect(refusing.rpcCalls).toEqual([]);
  });
});
