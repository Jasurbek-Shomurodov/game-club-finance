import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sendTelegramMessage: vi.fn(), editOwnerBotMessage: vi.fn() }));
vi.mock('../sendDailyFinanceReport', () => ({ sendTelegramMessage: mocks.sendTelegramMessage }));
vi.mock('./telegramApi', () => ({ editOwnerBotMessage: mocks.editOwnerBotMessage }));

import { fakeSupabase } from './__tests__/fakeSupabase';
import { AMOUNT_PROMPT_MARKUP } from './keyboard';
import { deliverOwnerBotReply, sendOwnerBotPrompt } from './outgoing';

const OPTIONS = { botToken: 'test-owner-bot-token', chatId: 4242, telegramUserId: 4242, deadlineAt: Date.now() + 20_000 };
const PROMPT = '30000000-0000-4000-8000-000000000005';
const KEYBOARD = { inline_keyboard: [[{ text: '✅ Да', callback_data: 'v1:yes:x' }]] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendTelegramMessage.mockResolvedValue({ ok: true, result: { message_id: 901, chat: { id: 4242, type: 'private' }, date: 1 } });
  mocks.editOwnerBotMessage.mockResolvedValue(undefined);
});

const setup = () => fakeSupabase({ rpc: { owner_bot_prompt_sent: () => ({ data: null, error: null }) } });

describe('owner bot replies', () => {
  it('sends a plain reply with its buttons to the chat', async () => {
    const { supabase, rpcCalls } = setup();
    await deliverOwnerBotReply(supabase, { text: 'day', keyboard: KEYBOARD }, OPTIONS);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({
      botToken: OPTIONS.botToken, chatId: '4242', text: 'day', replyMarkup: KEYBOARD, maxAttempts: 2,
    }));
    expect(mocks.editOwnerBotMessage).not.toHaveBeenCalled();
    expect(rpcCalls).toEqual([]);
  });

  it('sends a question with ForceReply and records the message it became', async () => {
    const { supabase, rpcCalls } = setup();
    await deliverOwnerBotReply(supabase, { text: 'how much?', keyboard: null, promptId: PROMPT }, OPTIONS);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'how much?', replyMarkup: AMOUNT_PROMPT_MARKUP }));
    expect(rpcCalls).toEqual([{ name: 'owner_bot_prompt_sent', args: { p_telegram_user_id: 4242, p_prompt_id: PROMPT, p_prompt_message_id: 901 } }]);
  });

  it('takes the buttons off the earlier day message first, and still sends when that fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { supabase } = setup();
    const reply = { text: 'confirm', keyboard: KEYBOARD, retire: { chatId: 4242, messageId: 7, text: 'day' } };
    await deliverOwnerBotReply(supabase, reply, OPTIONS);
    expect(mocks.editOwnerBotMessage).toHaveBeenCalledWith({ botToken: OPTIONS.botToken, chatId: 4242, messageId: 7, text: 'day', keyboard: null });
    expect(mocks.editOwnerBotMessage.mock.invocationCallOrder[0]).toBeLessThan(mocks.sendTelegramMessage.mock.invocationCallOrder[0]);

    mocks.editOwnerBotMessage.mockRejectedValueOnce(new Error('Telegram editMessageText failed: message to edit not found'));
    await deliverOwnerBotReply(supabase, reply, OPTIONS);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('fails when the question could not be sent or recorded', async () => {
    mocks.sendTelegramMessage.mockRejectedValueOnce(new Error('Telegram send failed'));
    await expect(sendOwnerBotPrompt(setup().supabase, { ...OPTIONS, promptId: PROMPT, text: 'q' })).rejects.toThrow('Telegram send failed');
    await expect(sendOwnerBotPrompt(fakeSupabase().supabase, { ...OPTIONS, promptId: PROMPT, text: 'q' })).rejects.toMatchObject({ code: 'PGRST202' });
  });
});
