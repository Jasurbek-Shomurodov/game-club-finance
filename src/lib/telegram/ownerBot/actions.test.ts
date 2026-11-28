import { describe, expect, it } from 'vitest';
import { fakeSupabase } from './__tests__/fakeSupabase';
import { CHOICE, CLUB, HANDOVER, LINE, dayPayload } from './__tests__/ownerBotPayloads';
import {
  OwnerBotActionError,
  chooseOwnerBotAction,
  confirmOwnerBotAction,
  openOwnerBotDay,
  ownerBotRefusal,
  parseOwnerBotDayState,
  readOwnerBotPending,
  undoOwnerBotAction,
} from './actions';

describe('owner bot day state', () => {
  it('reads the till, the Game Club marks and the line ids', () => {
    expect(parseOwnerBotDayState(dayPayload())).toEqual({
      clubId: CLUB,
      clubName: 'Square',
      businessDate: '2026-11-27',
      till: { cash: 1_200_000, terminal: 700_000.4, card: 0, playstation: 0 },
      handovers: [{
        id: HANDOVER, method: 'card', action: 'collected', amount: 300_000,
        createdAt: '2026-11-28T04:55:00+00:00', undoUntil: '2026-11-28T05:05:00+00:00', mine: true,
      }],
      lineIds: { cash: LINE, terminal: LINE, card: LINE, playstation: LINE },
    });
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
    expect(ownerBotRefusal({ hint: 'owner_bot_undo_expired' })).toBe('undo_expired');
    expect(ownerBotRefusal({ hint: 'owner_bot_cannot_undo' })).toBe('cannot_undo');
    expect(ownerBotRefusal({ code: 'P0001', hint: 'INSUFFICIENT_BALANCE' })).toBe('till_short');
    expect(ownerBotRefusal({ code: '23514', hint: 'reserve_exceeds_available' })).toBe('reserve_exceeds_available');
    expect(ownerBotRefusal({ code: '55000', hint: 'day_collected' })).toBe('day_closed');
    expect(ownerBotRefusal({ code: 'P0001', hint: 'COLLECTED_INSUFFICIENT' })).toBe('already_spent');
    expect(ownerBotRefusal({ code: '23514', hint: 'reserve_already_used' })).toBe('already_spent');
  });

  it('leaves other failures to be logged, not answered as a refusal', () => {
    expect(ownerBotRefusal({ code: 'PGRST202', message: 'function owner_bot_open_day does not exist' })).toBeNull();
    expect(ownerBotRefusal({ code: '57014', message: 'canceling statement due to statement timeout' })).toBeNull();
    expect(ownerBotRefusal(null)).toBeNull();
  });
});

describe('owner bot calls', () => {
  it('names only the Telegram id and row ids, never a club, amount or method from the button', async () => {
    const { supabase, rpcCalls } = fakeSupabase({
      rpc: {
        owner_bot_open_day: () => ({ data: dayPayload(), error: null }),
        owner_bot_pending: () => ({ data: dayPayload({ pending: { id: LINE, payment_method: 'cash', action: null, amount: null } }), error: null }),
        owner_bot_choose: () => ({ data: dayPayload({ pending: { id: CHOICE, payment_method: 'cash', action: 'reserve', amount: 1_200_000 } }), error: null }),
        owner_bot_confirm: () => ({ data: dayPayload({ result: { status: 'saved', handover_id: HANDOVER, payment_method: 'cash', action: 'reserve', amount: 1_200_000 } }), error: null }),
        owner_bot_undo: () => ({ data: dayPayload({ result: { status: 'undone', handover_id: HANDOVER, payment_method: 'cash', action: 'reserve', amount: '1200000' } }), error: null }),
      },
    });
    await openOwnerBotDay(supabase, { telegramUserId: 42, clubId: CLUB, businessDate: '2026-11-27' });
    expect((await readOwnerBotPending(supabase, 42, LINE)).pending).toEqual({ id: LINE, method: 'cash', action: null, amount: null });
    expect((await chooseOwnerBotAction(supabase, 42, LINE, 'reserve')).pending).toEqual({ id: CHOICE, method: 'cash', action: 'reserve', amount: 1_200_000 });
    expect((await confirmOwnerBotAction(supabase, { telegramUserId: 42, choiceId: CHOICE, chatId: 42, messageId: 7 })).result)
      .toEqual({ status: 'saved', handoverId: HANDOVER, method: 'cash', action: 'reserve', amount: 1_200_000 });
    expect((await undoOwnerBotAction(supabase, 42, HANDOVER)).result).toMatchObject({ status: 'undone', amount: 1_200_000 });
    expect(rpcCalls).toEqual([
      { name: 'owner_bot_open_day', args: { p_telegram_user_id: 42, p_club_id: CLUB, p_date: '2026-11-27' } },
      { name: 'owner_bot_pending', args: { p_telegram_user_id: 42, p_id: LINE } },
      { name: 'owner_bot_choose', args: { p_telegram_user_id: 42, p_line_id: LINE, p_action: 'reserve' } },
      { name: 'owner_bot_confirm', args: { p_telegram_user_id: 42, p_choice_id: CHOICE, p_chat_id: 42, p_message_id: 7 } },
      { name: 'owner_bot_undo', args: { p_telegram_user_id: 42, p_handover_id: HANDOVER } },
    ]);
  });

  it('throws a refusal with the database hint, and a failure without one', async () => {
    const { supabase } = fakeSupabase({
      rpc: { owner_bot_confirm: () => ({ data: null, error: { message: 'Insufficient payment method balance', code: 'P0001', hint: 'INSUFFICIENT_BALANCE' } }) },
    });
    const refused = confirmOwnerBotAction(supabase, { telegramUserId: 42, choiceId: CHOICE, chatId: 42, messageId: 7 });
    await expect(refused).rejects.toBeInstanceOf(OwnerBotActionError);
    await expect(refused).rejects.toMatchObject({ refusal: 'till_short', hint: 'INSUFFICIENT_BALANCE' });
    await expect(undoOwnerBotAction(supabase, 42, HANDOVER)).rejects.toMatchObject({ refusal: null, code: 'PGRST202' });
  });
});
