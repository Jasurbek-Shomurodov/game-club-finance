import { describe, expect, it, vi } from 'vitest';
import { answerOwnerBotCallback, editOwnerBotMessage } from './telegramApi';

const TOKEN = 'test-owner-bot-token';
const KEYBOARD = { inline_keyboard: [[{ text: '✅ Да', callback_data: 'v1:yes:x' }]] };

const answering = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));
const sent = (fetchImpl: ReturnType<typeof answering>) => {
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  return { url, body: JSON.parse(String(init.body)) };
};

describe('owner bot Telegram calls', () => {
  it('answers a press with a toast or an alert, cut to 200 characters', async () => {
    const fetchImpl = answering(200, { ok: true, result: true });
    await answerOwnerBotCallback({ botToken: TOKEN, callbackQueryId: 'q1', text: 'x'.repeat(250), showAlert: true, fetchImpl });
    const { url, body } = sent(fetchImpl);
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/answerCallbackQuery`);
    expect(body).toEqual({ callback_query_id: 'q1', text: 'x'.repeat(200), show_alert: true });

    const quiet = answering(200, { ok: true, result: true });
    await answerOwnerBotCallback({ botToken: TOKEN, callbackQueryId: 'q2', text: '', fetchImpl: quiet });
    expect(sent(quiet).body).toEqual({ callback_query_id: 'q2' });
  });

  it('redraws a message with its keyboard, or without one', async () => {
    const fetchImpl = answering(200, { ok: true, result: {} });
    await editOwnerBotMessage({ botToken: TOKEN, chatId: 42, messageId: 7, text: '🏢 Square', keyboard: KEYBOARD, fetchImpl });
    expect(sent(fetchImpl).body).toEqual({ chat_id: 42, message_id: 7, text: '🏢 Square', reply_markup: KEYBOARD });

    const bare = answering(200, { ok: true, result: {} });
    await editOwnerBotMessage({ botToken: TOKEN, chatId: 42, messageId: 7, text: '🏢 Square', keyboard: null, fetchImpl: bare });
    expect(sent(bare).body).toEqual({ chat_id: 42, message_id: 7, text: '🏢 Square' });
  });

  it('treats an unchanged message as done and other refusals as errors without the token', async () => {
    const same = answering(400, { ok: false, description: 'Bad Request: message is not modified' });
    await expect(editOwnerBotMessage({ botToken: TOKEN, chatId: 42, messageId: 7, text: 'a', keyboard: null, fetchImpl: same })).resolves.toBeUndefined();

    const old = answering(400, { ok: false, description: `Bad Request: query is too old (${TOKEN})` });
    const failure = answerOwnerBotCallback({ botToken: TOKEN, callbackQueryId: 'q1', text: 'a', fetchImpl: old });
    await expect(failure).rejects.toThrow(/query is too old/);
    await expect(failure).rejects.not.toThrow(TOKEN);

    const down = vi.fn(async () => { throw new Error(`connect failed for ${TOKEN}`); });
    await expect(answerOwnerBotCallback({ botToken: TOKEN, callbackQueryId: 'q1', text: 'a', fetchImpl: down }))
      .rejects.toThrow('[REDACTED]');
  });
});
