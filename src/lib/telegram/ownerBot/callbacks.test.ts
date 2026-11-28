import { describe, expect, it, vi } from 'vitest';
import { fakeSupabase, type RpcAnswer } from './__tests__/fakeSupabase';
import { CHOICE, CLUB, HANDOVER, LINE, dayPayload } from './__tests__/ownerBotPayloads';
import { buildOwnerBotCallbackData, parseOwnerBotCallbackData, type OwnerBotCallbackAction } from './callbackData';
import { handleOwnerBotCallback } from './callbacks';
import { refusalText } from './texts';
import type { OwnerBotCallbackQuery } from './update';

const TELEGRAM = 4242;
// 10:00 in Tashkent; the card mark (04:55 UTC) is still within its 10 minutes.
const NOW = new Date('2026-11-28T05:00:00Z');

const press = (action: OwnerBotCallbackAction, id: string, overrides: Partial<OwnerBotCallbackQuery> = {}): OwnerBotCallbackQuery => ({
  updateId: 1,
  callbackQueryId: 'q1',
  telegramUserId: TELEGRAM,
  chatId: TELEGRAM,
  messageId: 7,
  privateChat: true,
  data: buildOwnerBotCallbackData(action, id),
  ...overrides,
});

function setup(rpc: Record<string, RpcAnswer> = {}) {
  return fakeSupabase({
    tables: {
      clubs: [{ id: CLUB, business_day_start_hour: 0, enabled_payment_methods: ['cash', 'terminal', 'card'] }],
      daily_cash_entries: [{ club_id: CLUB, date: '2026-11-27', cash_income: 1_200_000, terminal_income: 800_000, card_income: 300_000, playstation_income: 0 }],
      daily_stock_counts: [{ club_id: CLUB, product_id: 'a', date: '2026-11-27', bar_income: 450_000 }],
    },
    rpc: {
      owner_bot_pending: (args) => ({
        data: dayPayload({ pending: { id: args.p_id, payment_method: 'cash', action: args.p_id === CHOICE ? 'reserve' : null, amount: args.p_id === CHOICE ? 1_200_000 : null } }),
        error: null,
      }),
      ...rpc,
    },
  });
}

const buttonsOf = (reply: Awaited<ReturnType<typeof handleOwnerBotCallback>>) =>
  reply.edit?.keyboard?.inline_keyboard.flat().map((button) => parseOwnerBotCallbackData(button.callback_data)) ?? [];

describe('handleOwnerBotCallback', () => {
  it('opens a method\'s submenu in the same message, saving nothing', async () => {
    const { supabase, rpcCalls } = setup();
    const reply = await handleOwnerBotCallback(supabase, press('menu', LINE), { now: NOW });
    expect(reply.answer).toEqual({ text: '', showAlert: false });
    expect(reply.edit?.text.split('\n').at(-1)).toBe('👉 💵 Наличные: 1 200 000 сум. Что сделали с этими деньгами?');
    expect(buttonsOf(reply)).toEqual([{ action: 'collect', id: LINE }, { action: 'reserve', id: LINE }, { action: 'back', id: LINE }]);
    expect(rpcCalls).toEqual([{ name: 'owner_bot_pending', args: { p_telegram_user_id: TELEGRAM, p_id: LINE } }]);
  });

  it('asks to confirm the amount the database fixed, and goes back without saving', async () => {
    const { supabase, rpcCalls } = setup({
      owner_bot_choose: (args) => ({
        data: dayPayload({ pending: { id: CHOICE, payment_method: 'cash', action: args.p_action, amount: 1_200_000 } }),
        error: null,
      }),
    });
    const reply = await handleOwnerBotCallback(supabase, press('reserve', LINE), { now: NOW });
    expect(reply.edit?.text.split('\n').at(-1)).toBe('🏦 Переместить в резерв 1 200 000 сум · 💵 Наличные · Square?');
    expect(buttonsOf(reply)).toEqual([{ action: 'yes', id: CHOICE }, { action: 'no', id: CHOICE }]);
    expect(rpcCalls[0]).toEqual({ name: 'owner_bot_choose', args: { p_telegram_user_id: TELEGRAM, p_line_id: LINE, p_action: 'reserve' } });

    const no = await handleOwnerBotCallback(supabase, press('no', CHOICE), { now: NOW });
    expect(no.answer.text).toBe('');
    expect(buttonsOf(no).map((button) => button?.action)).toEqual(['menu', 'menu', 'undo']);
    const back = await handleOwnerBotCallback(supabase, press('back', LINE), { now: NOW });
    expect(back.edit?.text).toBe(no.edit?.text);
  });

  it('saves on ✅ Да, toasts it and redraws the day with the new mark and its undo', async () => {
    const { supabase, rpcCalls } = setup({
      owner_bot_confirm: () => ({
        data: dayPayload({
          balances: { cash: { till: 0, collected: 0 }, terminal: { till: 700_000, collected: 0 }, card: { till: 0, collected: 0 }, playstation: { till: 0, collected: 0 } },
          handovers: [
            { id: HANDOVER, side: 'game_club', payment_method: 'cash', action: 'reserve', amount: 1_200_000, created_at: '2026-11-28T04:59:00+00:00', undo_until: '2026-11-28T05:09:00+00:00', mine: true },
          ],
          result: { status: 'saved', handover_id: HANDOVER, payment_method: 'cash', action: 'reserve', amount: 1_200_000 },
        }),
        error: null,
      }),
    });
    const reply = await handleOwnerBotCallback(supabase, press('yes', CHOICE), { now: NOW });
    expect(reply.answer).toEqual({ text: '🏦 В резерве: Наличные 1 200 000 сум', showAlert: false });
    expect(reply.edit?.text).toContain('💵 Наличные: 1 200 000 сум · 🏦 в резерве');
    expect(reply.edit?.keyboard?.inline_keyboard.map((row) => row.map((button) => button.text)))
      .toEqual([['💳 Терминал'], ['↩️ Отменить: наличные в резерв']]);
    expect(rpcCalls[0]).toEqual({
      name: 'owner_bot_confirm',
      args: { p_telegram_user_id: TELEGRAM, p_choice_id: CHOICE, p_chat_id: TELEGRAM, p_message_id: 7 },
    });
  });

  it('undoes with a toast and redraws the line as not marked', async () => {
    const { supabase } = setup({
      owner_bot_undo: () => ({
        data: dayPayload({ handovers: [], result: { status: 'undone', handover_id: HANDOVER, payment_method: 'card', action: 'collected', amount: 300_000 } }),
        error: null,
      }),
    });
    const reply = await handleOwnerBotCallback(supabase, press('undo', HANDOVER), { now: NOW });
    expect(reply.answer).toEqual({ text: '↩️ Отменено: Карта 300 000 сум', showAlert: false });
    expect(reply.edit?.text).toContain('🏧 Карта: 0 сум (за день 300 000 сум) · 👌 в кассе ничего нет');
  });

  it('answers a press outside the owner\'s own chat, or a button it did not make, without touching the database', async () => {
    const { supabase, rpcCalls } = setup();
    expect(await handleOwnerBotCallback(supabase, press('yes', CHOICE, { privateChat: false })))
      .toEqual({ answer: { text: refusalText('forbidden'), showAlert: true }, edit: null });
    expect(await handleOwnerBotCallback(supabase, press('yes', CHOICE, { data: 'v1:yes:1200000' })))
      .toEqual({ answer: { text: refusalText('expired'), showAlert: true }, edit: null });
    expect(rpcCalls).toEqual([]);
  });

  it('answers "no access" when the database refuses the presser, and leaves the message alone', async () => {
    const { supabase } = setup({
      owner_bot_confirm: () => ({ data: null, error: { message: 'This button belongs to another Telegram account.', code: '42501', hint: 'owner_bot_forbidden' } }),
    });
    expect(await handleOwnerBotCallback(supabase, press('yes', CHOICE), { now: NOW }))
      .toEqual({ answer: { text: refusalText('forbidden'), showAlert: true }, edit: null });
  });

  it('alerts a refused save and redraws the day, so the question does not stay', async () => {
    const { supabase } = setup({
      owner_bot_confirm: () => ({ data: null, error: { message: 'Insufficient payment method balance', code: 'P0001', hint: 'INSUFFICIENT_BALANCE' } }),
    });
    const reply = await handleOwnerBotCallback(supabase, press('yes', CHOICE), { now: NOW });
    expect(reply.answer).toEqual({ text: refusalText('till_short'), showAlert: true });
    expect(reply.edit?.text.startsWith('🏢 Square · 27 ноября 2026')).toBe(true);
    expect(reply.edit?.text).not.toContain('?');
  });

  it('refuses a menu for a line that is already marked, redrawing it', async () => {
    const { supabase } = setup({
      owner_bot_pending: () => ({ data: dayPayload({ pending: { id: LINE, payment_method: 'card', action: null, amount: null } }), error: null }),
    });
    const reply = await handleOwnerBotCallback(supabase, press('menu', LINE), { now: NOW });
    expect(reply.answer).toEqual({ text: refusalText('already_marked'), showAlert: true });
    expect(reply.edit?.text).toContain('🏧 Карта: 300 000 сум · ✅ забрал');
  });

  it('still confirms a saved press when the day cannot be read again, leaving the message', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = fakeSupabase({
      // The day's tables are unavailable after the money was saved.
      failTables: ['daily_cash_entries'],
      rpc: {
        owner_bot_confirm: () => ({
          data: dayPayload({ result: { status: 'saved', handover_id: HANDOVER, payment_method: 'cash', action: 'collected', amount: 1_200_000 } }),
          error: null,
        }),
      },
    });
    expect(await handleOwnerBotCallback(supabase, press('yes', CHOICE), { now: NOW }))
      .toEqual({ answer: { text: '✅ Забрал: Наличные 1 200 000 сум', showAlert: false }, edit: null });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('says "already undone" for a resent ✅ Да after the undo', async () => {
    const { supabase } = setup({
      owner_bot_confirm: () => ({
        data: dayPayload({ result: { status: 'already_undone', handover_id: HANDOVER, payment_method: 'cash', action: 'collected', amount: 1_200_000 } }),
        error: null,
      }),
    });
    const reply = await handleOwnerBotCallback(supabase, press('yes', CHOICE), { now: NOW });
    expect(reply.answer).toEqual({ text: '↩️ Уже отменено: Наличные 1 200 000 сум', showAlert: false });
  });

  it('alerts a failure it cannot explain and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = setup({ owner_bot_undo: () => ({ data: null, error: { message: 'connection reset', code: '08006' } }) });
    const reply = await handleOwnerBotCallback(supabase, press('undo', HANDOVER), { now: NOW });
    expect(reply).toEqual({ answer: { text: '⚠️ Не получилось. Попробуйте ещё раз через минуту.', showAlert: true }, edit: null });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
