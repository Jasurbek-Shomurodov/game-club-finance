import { describe, expect, it, vi } from 'vitest';
import { fakeSupabase, type RpcAnswer } from './__tests__/fakeSupabase';
import { CHOICE, CLUB, DAY, HANDOVER, LINE, PROMPT, dayPayload, pendingPayload } from './__tests__/ownerBotPayloads';
import { buildOwnerBotCallbackData, parseOwnerBotCallbackData, type OwnerBotCallbackAction } from './callbackData';
import { handleOwnerBotCallback } from './callbacks';
import { amountPromptToastText, refusalText } from './texts';
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

const buttonRow = (id: string) => {
  if (id === DAY) return pendingPayload({ id: DAY, kind: 'day', side: 'game_club', payment_method: null });
  if (id === CHOICE) return pendingPayload({ id: CHOICE, kind: 'choice', action: 'reserve', amount: 1_200_000 });
  return pendingPayload({ id });
};

function setup(rpc: Record<string, RpcAnswer> = {}) {
  return fakeSupabase({
    tables: {
      clubs: [{ id: CLUB, business_day_start_hour: 0, enabled_payment_methods: ['cash', 'terminal', 'card'] }],
      daily_cash_entries: [{ club_id: CLUB, date: '2026-11-27', cash_income: 1_200_000, terminal_income: 800_000, card_income: 300_000, playstation_income: 0 }],
      daily_stock_counts: [{ club_id: CLUB, product_id: 'a', date: '2026-11-27', bar_income: 450_000 }],
    },
    rpc: {
      owner_bot_button: (args) => ({ data: dayPayload({ pending: buttonRow(String(args.p_id)) }), error: null }),
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
    expect(buttonsOf(reply)).toEqual([
      { action: 'collect', id: LINE }, { action: 'reserve', id: LINE }, { action: 'amount', id: LINE }, { action: 'back', id: LINE },
    ]);
    expect(rpcCalls).toEqual([{ name: 'owner_bot_button', args: { p_telegram_user_id: TELEGRAM, p_id: LINE } }]);
  });

  it('opens the bar\'s submenu from the day row', async () => {
    const { supabase } = setup();
    const reply = await handleOwnerBotCallback(supabase, press('menu', DAY), { now: NOW });
    expect(reply.edit?.text).toContain('🍺 Бар (продажи): 450 000 сум · ⏳ не отмечено');
    expect(reply.edit?.text.split('\n').at(-1)).toBe('👉 🍺 Бар: 450 000 сум. Что сделали с этими деньгами?');
    expect(buttonsOf(reply)).toEqual([
      { action: 'reserve', id: DAY }, { action: 'left', id: DAY }, { action: 'askreserve', id: DAY }, { action: 'back', id: DAY },
    ]);
  });

  it('shows the day with the bar and "Всё…" buttons when going back', async () => {
    const { supabase } = setup();
    const back = await handleOwnerBotCallback(supabase, press('back', LINE), { now: NOW });
    // Cash and terminal have money (two open methods, so "Всё…" too), then the bar and the card's undo.
    expect(buttonsOf(back).map((button) => button?.action)).toEqual(['menu', 'menu', 'menu', 'allcollect', 'allreserve', 'undo']);
    const oneOpen = setup({
      owner_bot_button: () => ({ data: dayPayload({ balances: { ...dayPayload().balances, terminal: { till: 0, collected: 0 } }, pending: buttonRow(LINE) }), error: null }),
    });
    const day = await handleOwnerBotCallback(oneOpen.supabase, press('back', LINE), { now: NOW });
    expect(buttonsOf(day).map((button) => button?.action)).toEqual(['menu', 'menu', 'undo']);
  });

  it('asks to confirm the amount the database fixed, and goes back without saving, also from an expired choice', async () => {
    const { supabase, rpcCalls } = setup({
      owner_bot_pick: (args) => ({
        data: dayPayload({ pending: pendingPayload({ id: CHOICE, kind: 'choice', action: args.p_action, amount: 1_200_000 }) }),
        error: null,
      }),
    });
    const reply = await handleOwnerBotCallback(supabase, press('reserve', LINE), { now: NOW });
    expect(reply.edit?.text.split('\n').at(-1)).toBe('🏦 Переместить в резерв 1 200 000 сум · 💵 Наличные · Square?');
    expect(buttonsOf(reply)).toEqual([{ action: 'yes', id: CHOICE }, { action: 'no', id: CHOICE }]);
    expect(rpcCalls[0]).toEqual({ name: 'owner_bot_pick', args: { p_telegram_user_id: TELEGRAM, p_id: LINE, p_action: 'reserve' } });

    // ✖️ Нет is read only: an expired choice still brings the day back.
    const expired = setup({
      owner_bot_button: () => ({ data: dayPayload({ pending: pendingPayload({ id: CHOICE, kind: 'choice', action: 'reserve', amount: 1, expired: true }) }), error: null }),
    });
    const no = await handleOwnerBotCallback(expired.supabase, press('no', CHOICE), { now: NOW });
    expect(no.answer).toEqual({ text: '', showAlert: false });
    expect(no.edit?.text.startsWith('🏢 Square · 27 ноября 2026')).toBe(true);
    expect(no.edit?.text).not.toContain('?');
  });

  it('confirms the bar reserve, noting a cap, and "left in the bar"', async () => {
    const { supabase, rpcCalls } = setup({
      owner_bot_pick: (args) => ({
        data: dayPayload({
          pending: pendingPayload({
            id: CHOICE, kind: 'bar_choice', side: 'bar', payment_method: null, action: args.p_action,
            amount: args.p_action === 'reserve' ? 300_000 : 450_000, capped: args.p_action === 'reserve',
          }),
        }),
        error: null,
      }),
    });
    const reserve = await handleOwnerBotCallback(supabase, press('reserve', DAY), { now: NOW });
    expect(reserve.edit?.text.split('\n').slice(-2)).toEqual([
      '🏦 Переместить в резерв 300 000 сум · 🍺 Бар · Square?',
      'ℹ️ Не больше прибыли бара за месяц, поэтому меньше продаж дня (450 000 сум).',
    ]);
    const left = await handleOwnerBotCallback(supabase, press('left', DAY), { now: NOW });
    expect(left.edit?.text.split('\n').at(-1)).toBe('👌 Отметить, что 450 000 сум · 🍺 Бар · Square остались в баре?');
    expect(buttonsOf(left)).toEqual([{ action: 'yes', id: CHOICE }, { action: 'no', id: CHOICE }]);
    expect(rpcCalls.map((call) => call.args.p_action)).toEqual(['reserve', 'left']);
  });

  it('lists every method before "Всё в резерв" is saved', async () => {
    const { supabase, rpcCalls } = setup({
      owner_bot_pick: () => ({
        data: dayPayload({
          pending: pendingPayload({
            id: CHOICE, kind: 'all_choice', payment_method: null, action: 'reserve', amount: 1_900_000,
            items: [{ payment_method: 'cash', amount: 1_200_000 }, { payment_method: 'terminal', amount: 700_000 }],
          }),
        }),
        error: null,
      }),
    });
    const reply = await handleOwnerBotCallback(supabase, press('allreserve', DAY), { now: NOW });
    expect(reply.edit?.text.split('\n').slice(-4)).toEqual([
      '🏦 Переместить всё в резерв · Square?', '💵 Наличные: 1 200 000 сум', '💳 Терминал: 700 000 сум', '💰 Всего: 1 900 000 сум',
    ]);
    expect(rpcCalls[0].args).toEqual({ p_telegram_user_id: TELEGRAM, p_id: DAY, p_action: 'all_reserve' });
  });

  it('asks what a part is for, then sends the question for its amount', async () => {
    const { supabase, rpcCalls } = setup({
      owner_bot_ask_amount: (args) => ({
        data: dayPayload({
          prompt: { id: PROMPT, side: 'game_club', payment_method: 'cash', action: args.p_action, max_amount: 1_200_000, day_chat_id: TELEGRAM, day_message_id: 7 },
        }),
        error: null,
      }),
    });
    const amount = await handleOwnerBotCallback(supabase, press('amount', LINE), { now: NOW });
    expect(amount.edit?.text.split('\n').at(-1)).toBe('✏️ 💵 Наличные: часть от 1 200 000 сум. Что сделали с этой частью?');
    expect(buttonsOf(amount)).toEqual([{ action: 'askcollect', id: LINE }, { action: 'askreserve', id: LINE }, { action: 'menu', id: LINE }]);

    const asked = await handleOwnerBotCallback(supabase, press('askcollect', LINE), { now: NOW });
    expect(asked.answer).toEqual({ text: amountPromptToastText(), showAlert: false });
    expect(asked.edit?.text.startsWith('🏢 Square')).toBe(true);
    expect(asked.prompt).toEqual({
      promptId: PROMPT,
      text: '✏️ Square · 💵 Наличные: сколько забрали?\n👇 Ответьте на это сообщение суммой до 1 200 000 сум.',
    });
    expect(rpcCalls.at(-1)).toEqual({
      name: 'owner_bot_ask_amount',
      args: { p_telegram_user_id: TELEGRAM, p_id: LINE, p_action: 'collected', p_chat_id: TELEGRAM, p_message_id: 7 },
    });
  });

  it('alerts a bar reserve the month\'s profit does not allow, redrawing the day', async () => {
    const { supabase } = setup({
      owner_bot_pick: () => ({ data: null, error: { message: 'no', code: 'P0001', hint: 'owner_bot_bar_reserve_unavailable' } }),
      owner_bot_ask_amount: () => ({ data: null, error: { message: 'no', code: 'P0001', hint: 'owner_bot_bar_reserve_unavailable' } }),
    });
    for (const action of ['reserve', 'askreserve'] as const) {
      const reply = await handleOwnerBotCallback(supabase, press(action, DAY), { now: NOW });
      expect(reply.answer).toEqual({ text: refusalText('bar_reserve_unavailable'), showAlert: true });
      expect(reply.edit?.text.startsWith('🏢 Square')).toBe(true);
      expect(reply.prompt).toBeUndefined();
    }
  });

  it('saves on ✅ Да, toasts it and redraws the day with the new mark and its undo', async () => {
    const { supabase, rpcCalls } = setup({
      owner_bot_confirm_any: () => ({
        data: dayPayload({
          balances: { cash: { till: 0, collected: 0 }, terminal: { till: 700_000, collected: 0 }, card: { till: 0, collected: 0 }, playstation: { till: 0, collected: 0 } },
          handovers: [
            { id: HANDOVER, side: 'game_club', payment_method: 'cash', action: 'reserve', amount: 1_200_000, group_id: null, created_at: '2026-11-28T04:59:00+00:00', undo_until: '2026-11-28T05:09:00+00:00', mine: true },
          ],
          result: { status: 'saved', handover_id: HANDOVER, side: 'game_club', payment_method: 'cash', action: 'reserve', amount: 1_200_000, group: false },
        }),
        error: null,
      }),
    });
    const reply = await handleOwnerBotCallback(supabase, press('yes', CHOICE), { now: NOW });
    expect(reply.answer).toEqual({ text: '🏦 В резерве: Наличные 1 200 000 сум', showAlert: false });
    expect(reply.edit?.text).toContain('💵 Наличные: 1 200 000 сум · 🏦 в резерве');
    expect(reply.edit?.keyboard?.inline_keyboard.map((row) => row.map((button) => button.text)))
      .toEqual([['💳 Терминал'], ['🍺 Бар'], ['↩️ Отменить: наличные в резерв']]);
    expect(rpcCalls[0]).toEqual({
      name: 'owner_bot_confirm_any',
      args: { p_telegram_user_id: TELEGRAM, p_choice_id: CHOICE, p_chat_id: TELEGRAM, p_message_id: 7 },
    });
  });

  it('undoes a group with a toast and redraws its lines as not marked', async () => {
    const { supabase, rpcCalls } = setup({
      owner_bot_undo_any: () => ({
        data: dayPayload({ handovers: [], result: { status: 'undone', handover_id: HANDOVER, side: 'game_club', payment_method: null, action: 'collected', amount: 1_900_000, group: true } }),
        error: null,
      }),
    });
    const reply = await handleOwnerBotCallback(supabase, press('undo', HANDOVER), { now: NOW });
    expect(reply.answer).toEqual({ text: '↩️ Отменено: всё 1 900 000 сум', showAlert: false });
    expect(reply.edit?.text).toContain('🏧 Карта: 0 сум (за день 300 000 сум) · 👌 в кассе ничего нет');
    expect(rpcCalls[0].name).toBe('owner_bot_undo_any');
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
      owner_bot_confirm_any: () => ({ data: null, error: { message: 'This button belongs to another Telegram account.', code: '42501', hint: 'owner_bot_forbidden' } }),
    });
    expect(await handleOwnerBotCallback(supabase, press('yes', CHOICE), { now: NOW }))
      .toEqual({ answer: { text: refusalText('forbidden'), showAlert: true }, edit: null });
  });

  it('alerts a refused save and redraws the day, so the question does not stay', async () => {
    const { supabase } = setup({
      owner_bot_confirm_any: () => ({ data: null, error: { message: 'Insufficient payment method balance', code: 'P0001', hint: 'INSUFFICIENT_BALANCE' } }),
    });
    const reply = await handleOwnerBotCallback(supabase, press('yes', CHOICE), { now: NOW });
    expect(reply.answer).toEqual({ text: refusalText('till_short'), showAlert: true });
    expect(reply.edit?.text.startsWith('🏢 Square · 27 ноября 2026')).toBe(true);
    expect(reply.edit?.text).not.toContain('?');
  });

  it('alerts an expired button and redraws the day with new buttons', async () => {
    const { supabase } = setup({
      owner_bot_button: () => ({ data: dayPayload({ pending: pendingPayload({ expired: true }) }), error: null }),
    });
    const reply = await handleOwnerBotCallback(supabase, press('menu', LINE), { now: NOW });
    expect(reply.answer).toEqual({ text: refusalText('expired'), showAlert: true });
    expect(buttonsOf(reply).map((button) => button?.action)).toContain('menu');
  });

  it('refuses a menu for a line that is already marked, redrawing it', async () => {
    const { supabase } = setup({
      owner_bot_button: () => ({ data: dayPayload({ pending: pendingPayload({ payment_method: 'card' }) }), error: null }),
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
        owner_bot_confirm_any: () => ({
          data: dayPayload({ result: { status: 'saved', handover_id: HANDOVER, side: 'bar', payment_method: null, action: 'left', amount: 450_000, group: false } }),
          error: null,
        }),
      },
    });
    expect(await handleOwnerBotCallback(supabase, press('yes', CHOICE), { now: NOW }))
      .toEqual({ answer: { text: '👌 Оставил в баре: 450 000 сум', showAlert: false }, edit: null });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('says "already undone" for a resent ✅ Да after the undo', async () => {
    const { supabase } = setup({
      owner_bot_confirm_any: () => ({
        data: dayPayload({ result: { status: 'already_undone', handover_id: HANDOVER, side: 'game_club', payment_method: 'cash', action: 'collected', amount: 1_200_000, group: false } }),
        error: null,
      }),
    });
    const reply = await handleOwnerBotCallback(supabase, press('yes', CHOICE), { now: NOW });
    expect(reply.answer).toEqual({ text: '↩️ Уже отменено: Наличные 1 200 000 сум', showAlert: false });
  });

  it('alerts a failure it cannot explain and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = setup({ owner_bot_undo_any: () => ({ data: null, error: { message: 'connection reset', code: '08006' } }) });
    const reply = await handleOwnerBotCallback(supabase, press('undo', HANDOVER), { now: NOW });
    expect(reply).toEqual({ answer: { text: '⚠️ Не получилось. Попробуйте ещё раз через минуту.', showAlert: true }, edit: null });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
