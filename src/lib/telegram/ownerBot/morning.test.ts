import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sendTelegramMessage: vi.fn() }));
vi.mock('../sendDailyFinanceReport', async () => {
  const actual = await vi.importActual<typeof import('../sendDailyFinanceReport')>('../sendDailyFinanceReport');
  return { ...actual, sendTelegramMessage: mocks.sendTelegramMessage };
});

import { TelegramSendError } from '../sendDailyFinanceReport';
import { fakeSupabase, type RpcAnswer } from './__tests__/fakeSupabase';
import { CLUB, DAY, LINE, dayPayload } from './__tests__/ownerBotPayloads';
import { sendOwnerBotMorningMessages } from './morning';

// After the 08:00 report in Tashkent, and after the payload's card mark stopped being undoable.
const NOW = new Date('2026-11-28T06:00:00Z');
const OWNER = 4242;
const SECOND = 5353;
const TOKEN = 'test-owner-bot-token';

function setup({ owners = [OWNER, SECOND], claimed = new Set<number>(), rpc = {} }: { owners?: number[]; claimed?: Set<number>; rpc?: Record<string, RpcAnswer> } = {}) {
  return fakeSupabase({
    tables: {
      clubs: [{ id: CLUB, business_day_start_hour: 0, enabled_payment_methods: ['cash', 'terminal', 'card'] }],
      daily_cash_entries: [{ club_id: CLUB, date: '2026-11-27', cash_income: 1_200_000, terminal_income: 700_000, card_income: 300_000, playstation_income: 0 }],
      daily_stock_counts: [{ club_id: CLUB, product_id: 'a', date: '2026-11-27', bar_income: 450_000 }],
    },
    rpc: {
      owner_bot_club_owner_telegram_ids: () => ({ data: owners.map((id) => ({ telegram_user_id: id })), error: null }),
      owner_bot_claim_day_message: (args) => {
        const id = Number(args.p_telegram_user_id);
        if (claimed.has(id)) return { data: false, error: null };
        claimed.add(id);
        return { data: true, error: null };
      },
      owner_bot_today: () => ({ data: dayPayload(), error: null }),
      owner_bot_finish_day_message: () => ({ data: null, error: null }),
      owner_bot_release_day_message: (args) => {
        claimed.delete(Number(args.p_telegram_user_id));
        return { data: null, error: null };
      },
      ...rpc,
    },
  });
}

const run = (supabase: ReturnType<typeof setup>['supabase'], deadlineAt = Date.now() + 30_000) =>
  sendOwnerBotMorningMessages(supabase, { clubId: CLUB, businessDate: '2026-11-27', now: NOW, deadlineAt });

const sent = (chatId: number, messageId: number) => ({ ok: true, result: { message_id: messageId, chat: { id: chatId, type: 'private' }, date: 1 }, attempts: [] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('TELEGRAM_OWNER_BOT_TOKEN', TOKEN);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  mocks.sendTelegramMessage.mockImplementation(async ({ chatId }: { chatId: string }) => sent(Number(chatId), Number(chatId) + 1));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('sendOwnerBotMorningMessages', () => {
  it('does nothing while the owner bot is not configured', async () => {
    vi.stubEnv('TELEGRAM_OWNER_BOT_TOKEN', '');
    const { supabase, rpcCalls } = setup();
    expect(await run(supabase)).toEqual({ skipped: true, sent: 0, alreadySent: 0, failed: 0 });
    expect(rpcCalls).toEqual([]);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('sends each linked owner the day message with its buttons, as that owner, and records it', async () => {
    const { supabase, rpcCalls } = setup();
    expect(await run(supabase)).toEqual({ skipped: false, sent: 2, alreadySent: 0, failed: 0 });
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(2);
    const [first] = mocks.sendTelegramMessage.mock.calls[0];
    expect(first).toMatchObject({ botToken: TOKEN, chatId: String(OWNER) });
    expect(first.text.split('\n')[0]).toBe('🏢 Square · 27 ноября 2026');
    expect(first.replyMarkup.inline_keyboard.flat().map((button: { callback_data: string }) => button.callback_data))
      .toEqual([`v1:menu:${LINE}`, `v1:menu:${LINE}`, `v1:menu:${DAY}`, `v1:allcollect:${DAY}`, `v1:allreserve:${DAY}`]);
    expect(rpcCalls.filter((call) => call.name === 'owner_bot_today').map((call) => call.args)).toEqual([
      { p_telegram_user_id: OWNER, p_club_id: CLUB, p_date: '2026-11-27' },
      { p_telegram_user_id: SECOND, p_club_id: CLUB, p_date: '2026-11-27' },
    ]);
    expect(rpcCalls.filter((call) => call.name === 'owner_bot_finish_day_message').map((call) => call.args)).toEqual([
      { p_club_id: CLUB, p_date: '2026-11-27', p_telegram_user_id: OWNER, p_chat_id: OWNER, p_message_id: OWNER + 1 },
      { p_club_id: CLUB, p_date: '2026-11-27', p_telegram_user_id: SECOND, p_chat_id: SECOND, p_message_id: SECOND + 1 },
    ]);
  });

  it('never sends twice for the same club, date and owner, as the report\'s retry runs call it again', async () => {
    const claimed = new Set<number>();
    expect((await run(setup({ claimed }).supabase)).sent).toBe(2);
    const again = setup({ claimed });
    expect(await run(again.supabase)).toEqual({ skipped: false, sent: 0, alreadySent: 2, failed: 0 });
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(2);
    // Nothing is read for an owner who already has the message.
    expect(again.rpcCalls.map((call) => call.name)).not.toContain('owner_bot_today');
  });

  it('gives the claim back after a definite failure, and keeps it when Telegram may have got it', async () => {
    const claimed = new Set<number>();
    mocks.sendTelegramMessage
      .mockRejectedValueOnce(new TelegramSendError('Forbidden: bot was blocked by the user', [], false))
      .mockRejectedValueOnce(new TelegramSendError('Telegram delivery outcome is unknown', [], false, true));
    expect(await run(setup({ claimed }).supabase)).toEqual({ skipped: false, sent: 0, alreadySent: 0, failed: 2 });
    // The blocked owner may be tried again later; the unknown one never.
    expect([...claimed]).toEqual([SECOND]);
  });

  it('gives the claim back when the owner\'s day cannot be read, and goes on with the next owner', async () => {
    const claimed = new Set<number>();
    const { supabase } = setup({
      claimed,
      rpc: {
        owner_bot_today: (args) => (args.p_telegram_user_id === OWNER
          ? { data: null, error: { message: 'Only an owner of this club can do that.', code: '42501', hint: 'owner_bot_not_owner' } }
          : { data: dayPayload(), error: null }),
      },
    });
    expect(await run(supabase)).toEqual({ skipped: false, sent: 1, alreadySent: 0, failed: 1 });
    expect([...claimed]).toEqual([SECOND]);
  });

  it('never throws: a failure to list the owners or past the deadline is only logged', async () => {
    const broken = setup({ rpc: { owner_bot_club_owner_telegram_ids: () => ({ data: null, error: { message: 'down' } }) } });
    expect(await run(broken.supabase)).toEqual({ skipped: false, sent: 0, alreadySent: 0, failed: 1 });
    expect(await run(setup().supabase, Date.now() - 1)).toEqual({ skipped: false, sent: 0, alreadySent: 0, failed: 0 });
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join(' ');
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(String(OWNER));
  });
});
