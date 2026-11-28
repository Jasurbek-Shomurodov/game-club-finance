import { describe, expect, it } from 'vitest';
import { fakeSupabase } from './__tests__/fakeSupabase';
import { CHOICE, CLUB, DAY, HANDOVER, LINE, PROMPT, dayPayload, pendingPayload } from './__tests__/ownerBotPayloads';
import {
  OwnerBotActionError,
  answerOwnerBotAmount,
  askOwnerBotAmount,
  confirmOwnerBotAction,
  openOwnerBotDay,
  ownerBotRefusal,
  parseOwnerBotDayState,
  pickOwnerBotAction,
  readOwnerBotButton,
  recordOwnerBotPrompt,
  undoOwnerBotAction,
} from './actions';

const promptPayload = (extra: Record<string, unknown> = {}) => ({
  id: PROMPT, side: 'game_club', payment_method: 'cash', action: 'collected', max_amount: 1_200_000, day_chat_id: 42, day_message_id: 7, ...extra,
});

describe('owner bot day state', () => {
  it('reads the till, the marks of both sides, the line ids and the day row', () => {
    const state = parseOwnerBotDayState(dayPayload({
      handovers: [
        ...dayPayload().handovers,
        { id: 'b1', side: 'bar', payment_method: null, action: 'left', amount: 450_000, group_id: null, created_at: 'x', undo_until: 'y', mine: false },
        { id: 'g1', side: 'game_club', payment_method: 'cash', action: 'reserve', amount: 5, group_id: 'grp', created_at: 'x', undo_until: 'y', mine: true },
      ],
    }));
    expect(state).toEqual({
      clubId: CLUB,
      clubName: 'Square',
      businessDate: '2026-11-27',
      till: { cash: 1_200_000, terminal: 700_000.4, card: 0, playstation: 0 },
      handovers: [
        {
          id: HANDOVER, side: 'game_club', method: 'card', action: 'collected', amount: 300_000, groupId: null,
          createdAt: '2026-11-28T04:55:00+00:00', undoUntil: '2026-11-28T05:05:00+00:00', mine: true,
        },
        { id: 'b1', side: 'bar', method: null, action: 'left', amount: 450_000, groupId: null, createdAt: 'x', undoUntil: 'y', mine: false },
        { id: 'g1', side: 'game_club', method: 'cash', action: 'reserve', amount: 5, groupId: 'grp', createdAt: 'x', undoUntil: 'y', mine: true },
      ],
      lineIds: { cash: LINE, terminal: LINE, card: LINE, playstation: LINE },
      dayId: DAY,
    });
    expect(parseOwnerBotDayState(dayPayload({ day_id: undefined })).dayId).toBeNull();
  });

  it('refuses a payload without a club, a date or balances', () => {
    expect(() => parseOwnerBotDayState(null)).toThrow(/unexpected shape/);
    expect(() => parseOwnerBotDayState({ ...dayPayload(), club_id: undefined })).toThrow(/unexpected shape/);
    expect(() => parseOwnerBotDayState({ ...dayPayload(), balances: null })).toThrow(/unexpected shape/);
  });
});

describe('owner bot refusals', () => {
  it('maps the wrapper and money RPC hints to a reply', () => {
    expect(ownerBotRefusal({ code: '42501', hint: 'owner_bot_not_linked' })).toBe('forbidden');
    expect(ownerBotRefusal({ code: '42501', hint: 'owner_bot_not_owner' })).toBe('forbidden');
    expect(ownerBotRefusal({ code: '42501', hint: 'owner_bot_forbidden' })).toBe('forbidden');
    expect(ownerBotRefusal({ code: '42501', message: 'Only a club owner can use the reserve.' })).toBe('forbidden');
    expect(ownerBotRefusal({ code: 'P0002', hint: 'owner_bot_expired' })).toBe('expired');
    expect(ownerBotRefusal({ hint: 'owner_bot_already_marked' })).toBe('already_marked');
    expect(ownerBotRefusal({ hint: 'owner_bot_nothing_in_till' })).toBe('nothing_in_till');
    expect(ownerBotRefusal({ hint: 'owner_bot_nothing_in_bar' })).toBe('nothing_in_bar');
    expect(ownerBotRefusal({ hint: 'owner_bot_bar_reserve_unavailable' })).toBe('bar_reserve_unavailable');
    expect(ownerBotRefusal({ hint: 'owner_bot_undo_expired' })).toBe('undo_expired');
    expect(ownerBotRefusal({ hint: 'owner_bot_cannot_undo' })).toBe('cannot_undo');
    expect(ownerBotRefusal({ code: 'P0001', hint: 'INSUFFICIENT_BALANCE' })).toBe('till_short');
    expect(ownerBotRefusal({ code: '23514', hint: 'reserve_exceeds_available' })).toBe('reserve_exceeds_available');
    expect(ownerBotRefusal({ code: '55000', hint: 'day_collected' })).toBe('day_closed');
    expect(ownerBotRefusal({ code: 'P0001', hint: 'COLLECTED_INSUFFICIENT' })).toBe('already_spent');
    expect(ownerBotRefusal({ code: '23514', hint: 'reserve_already_used' })).toBe('already_spent');
  });

  it('leaves other failures to be logged, not answered as a refusal', () => {
    expect(ownerBotRefusal({ code: 'PGRST202', message: 'function owner_bot_today does not exist' })).toBeNull();
    expect(ownerBotRefusal({ code: '57014', message: 'canceling statement due to statement timeout' })).toBeNull();
    expect(ownerBotRefusal(null)).toBeNull();
  });
});

describe('owner bot calls', () => {
  it('names only the Telegram id and row ids, never a club, amount or method from the button', async () => {
    const { supabase, rpcCalls } = fakeSupabase({
      rpc: {
        owner_bot_today: () => ({ data: dayPayload(), error: null }),
        owner_bot_button: () => ({ data: dayPayload({ pending: pendingPayload({ expired: true }) }), error: null }),
        owner_bot_pick: () => ({
          data: dayPayload({
            pending: pendingPayload({
              id: CHOICE, kind: 'all_choice', payment_method: null, action: 'reserve', amount: 1_900_000,
              items: [{ payment_method: 'cash', amount: 1_200_000, request_id: 'r1' }, { payment_method: 'terminal', amount: '700000' }, { payment_method: 'usd', amount: 1 }],
            }),
          }),
          error: null,
        }),
        owner_bot_confirm_any: () => ({
          data: dayPayload({ result: { status: 'saved', handover_id: HANDOVER, side: 'bar', payment_method: null, action: 'reserve', amount: 300_000, group: false } }),
          error: null,
        }),
        owner_bot_undo_any: () => ({
          data: dayPayload({ result: { status: 'undone', handover_id: HANDOVER, side: 'game_club', payment_method: null, action: 'collected', amount: '1900000', group: true } }),
          error: null,
        }),
      },
    });
    expect((await openOwnerBotDay(supabase, { telegramUserId: 42, clubId: CLUB, businessDate: '2026-11-27' })).dayId).toBe(DAY);
    expect((await readOwnerBotButton(supabase, 42, LINE)).pending).toEqual({
      id: LINE, kind: 'line', side: 'game_club', method: 'cash', action: null, amount: null, items: [], capped: false, expired: true,
    });
    expect((await pickOwnerBotAction(supabase, 42, DAY, 'all_reserve')).pending).toEqual({
      id: CHOICE, kind: 'all_choice', side: 'game_club', method: null, action: 'reserve', amount: 1_900_000,
      items: [{ method: 'cash', amount: 1_200_000 }, { method: 'terminal', amount: 700_000 }], capped: false, expired: false,
    });
    expect((await confirmOwnerBotAction(supabase, { telegramUserId: 42, choiceId: CHOICE, chatId: 42, messageId: 7 })).result)
      .toEqual({ status: 'saved', handoverId: HANDOVER, side: 'bar', method: null, action: 'reserve', amount: 300_000, group: false });
    expect((await undoOwnerBotAction(supabase, 42, HANDOVER)).result).toMatchObject({ status: 'undone', amount: 1_900_000, group: true, method: null });
    expect(rpcCalls).toEqual([
      { name: 'owner_bot_today', args: { p_telegram_user_id: 42, p_club_id: CLUB, p_date: '2026-11-27' } },
      { name: 'owner_bot_button', args: { p_telegram_user_id: 42, p_id: LINE } },
      { name: 'owner_bot_pick', args: { p_telegram_user_id: 42, p_id: DAY, p_action: 'all_reserve' } },
      { name: 'owner_bot_confirm_any', args: { p_telegram_user_id: 42, p_choice_id: CHOICE, p_chat_id: 42, p_message_id: 7 } },
      { name: 'owner_bot_undo_any', args: { p_telegram_user_id: 42, p_handover_id: HANDOVER } },
    ]);
  });

  it('asks for an amount, records the question\'s message and reads the answer', async () => {
    const { supabase, rpcCalls } = fakeSupabase({
      rpc: {
        owner_bot_ask_amount: () => ({ data: dayPayload({ prompt: promptPayload() }), error: null }),
        owner_bot_prompt_sent: () => ({ data: null, error: null }),
        owner_bot_answer_amount: (args) => ({
          data: args.p_amount === null
            ? { status: 'invalid', club_name: 'Square', prompt: promptPayload() }
            : dayPayload({ status: 'chosen', prompt: promptPayload(), pending: pendingPayload({ id: CHOICE, kind: 'choice', action: 'collected', amount: 500_000 }) }),
          error: null,
        }),
      },
    });
    expect((await askOwnerBotAmount(supabase, { telegramUserId: 42, id: LINE, action: 'collected', chatId: 42, messageId: 7 })).prompt).toEqual({
      id: PROMPT, side: 'game_club', method: 'cash', action: 'collected', maxAmount: 1_200_000, dayChatId: 42, dayMessageId: 7,
    });
    await recordOwnerBotPrompt(supabase, { telegramUserId: 42, promptId: PROMPT, promptMessageId: 901 });
    expect(await answerOwnerBotAmount(supabase, { telegramUserId: 42, promptMessageId: 901, amount: null }))
      .toMatchObject({ status: 'invalid', clubName: 'Square', prompt: { id: PROMPT, maxAmount: 1_200_000 } });
    const chosen = await answerOwnerBotAmount(supabase, { telegramUserId: 42, promptMessageId: 901, amount: 500_000 });
    expect(chosen).toMatchObject({ status: 'chosen', dayId: DAY, pending: { id: CHOICE, kind: 'choice', amount: 500_000 } });
    expect(rpcCalls.map((call) => [call.name, call.args])).toEqual([
      ['owner_bot_ask_amount', { p_telegram_user_id: 42, p_id: LINE, p_action: 'collected', p_chat_id: 42, p_message_id: 7 }],
      ['owner_bot_prompt_sent', { p_telegram_user_id: 42, p_prompt_id: PROMPT, p_prompt_message_id: 901 }],
      ['owner_bot_answer_amount', { p_telegram_user_id: 42, p_prompt_message_id: 901, p_amount: null }],
      ['owner_bot_answer_amount', { p_telegram_user_id: 42, p_prompt_message_id: 901, p_amount: 500_000 }],
    ]);
  });

  it('throws a refusal with the database hint, and a failure without one', async () => {
    const { supabase } = fakeSupabase({
      rpc: { owner_bot_confirm_any: () => ({ data: null, error: { message: 'Insufficient payment method balance', code: 'P0001', hint: 'INSUFFICIENT_BALANCE' } }) },
    });
    const refused = confirmOwnerBotAction(supabase, { telegramUserId: 42, choiceId: CHOICE, chatId: 42, messageId: 7 });
    await expect(refused).rejects.toBeInstanceOf(OwnerBotActionError);
    await expect(refused).rejects.toMatchObject({ refusal: 'till_short', hint: 'INSUFFICIENT_BALANCE' });
    await expect(undoOwnerBotAction(supabase, 42, HANDOVER)).rejects.toMatchObject({ refusal: null, code: 'PGRST202' });
    await expect(recordOwnerBotPrompt(supabase, { telegramUserId: 42, promptId: PROMPT, promptMessageId: 1 })).rejects.toMatchObject({ code: 'PGRST202' });
  });
});
