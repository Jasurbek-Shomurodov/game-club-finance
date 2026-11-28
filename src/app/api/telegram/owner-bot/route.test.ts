import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  handleOwnerBotMessage: vi.fn(),
  handleOwnerBotCallback: vi.fn(),
  answerOwnerBotCallback: vi.fn(),
  editOwnerBotMessage: vi.fn(),
  sendTelegramMessage: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock('@/lib/telegram/ownerBot/handler', () => ({ handleOwnerBotMessage: mocks.handleOwnerBotMessage }));
vi.mock('@/lib/telegram/ownerBot/callbacks', () => ({ handleOwnerBotCallback: mocks.handleOwnerBotCallback }));
vi.mock('@/lib/telegram/ownerBot/telegramApi', () => ({
  answerOwnerBotCallback: mocks.answerOwnerBotCallback,
  editOwnerBotMessage: mocks.editOwnerBotMessage,
}));
vi.mock('@/lib/telegram/sendDailyFinanceReport', () => ({ sendTelegramMessage: mocks.sendTelegramMessage }));

import { errorText, pressFailedText } from '@/lib/telegram/ownerBot/texts';
import { POST } from './route';

const SECRET = 'test-owner-bot-secret_0123456789';
const TOKEN = 'test-owner-bot-token';
const SUPABASE = { kind: 'service client' };
const KEYBOARD = { inline_keyboard: [[{ text: '💵 Наличные', callback_data: 'v1:menu:x' }]] };
const REPLIES = [{ text: 'first', keyboard: KEYBOARD }, { text: 'second', keyboard: null }];

const buttonPress = (chat: Record<string, unknown> = { id: 4242, type: 'private' }) => ({
  update_id: 2,
  callback_query: { id: 'q1', from: { id: 4242, is_bot: false }, data: 'v1:yes:x', message: { message_id: 7, chat } },
});

const privateUpdate = (text = '/today', chatType = 'private') => ({
  update_id: 1,
  message: { message_id: 3, chat: { id: chatType === 'private' ? 4242 : -100777, type: chatType }, from: { id: 4242, is_bot: false }, text },
});

function call(body: unknown, secret: string | null = SECRET) {
  return POST(new Request('https://example.test/api/telegram/owner-bot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('TELEGRAM_OWNER_BOT_WEBHOOK_SECRET', SECRET);
  vi.stubEnv('TELEGRAM_OWNER_BOT_TOKEN', TOKEN);
  mocks.createServiceClient.mockReturnValue(SUPABASE);
  mocks.handleOwnerBotMessage.mockResolvedValue(REPLIES);
  mocks.sendTelegramMessage.mockResolvedValue({ ok: true, result: { message_id: 9 } });
  mocks.handleOwnerBotCallback.mockResolvedValue({ answer: { text: '✅ Забрал', showAlert: false }, edit: { text: 'day', keyboard: KEYBOARD } });
  mocks.answerOwnerBotCallback.mockResolvedValue(undefined);
  mocks.editOwnerBotMessage.mockResolvedValue(undefined);
});

describe('POST /api/telegram/owner-bot', () => {
  it('refuses with 503 while the secret or token is not configured', async () => {
    vi.stubEnv('TELEGRAM_OWNER_BOT_WEBHOOK_SECRET', '');
    expect((await call(privateUpdate())).status).toBe(503);
    vi.stubEnv('TELEGRAM_OWNER_BOT_WEBHOOK_SECRET', 'too-short');
    expect((await call(privateUpdate(), 'too-short')).status).toBe(503);
    vi.stubEnv('TELEGRAM_OWNER_BOT_WEBHOOK_SECRET', SECRET);
    vi.stubEnv('TELEGRAM_OWNER_BOT_TOKEN', '');
    expect((await call(privateUpdate())).status).toBe(503);
    vi.stubEnv('TELEGRAM_OWNER_BOT_TOKEN', TOKEN);
    mocks.createServiceClient.mockImplementation(() => { throw new Error('Missing Supabase service environment variables'); });
    expect((await call(privateUpdate())).status).toBe(503);
    expect(mocks.handleOwnerBotMessage).not.toHaveBeenCalled();
  });

  it('refuses a wrong or missing secret with 401 and reads nothing', async () => {
    expect((await call(privateUpdate(), `${SECRET}x`)).status).toBe(401);
    expect((await call(privateUpdate(), null)).status).toBe(401);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.handleOwnerBotMessage).not.toHaveBeenCalled();
  });

  it('answers a private message and sends each reply in order to that chat', async () => {
    const response = await call(privateUpdate('/today'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.handleOwnerBotMessage).toHaveBeenCalledWith(SUPABASE, expect.objectContaining({ chatId: 4242, telegramUserId: 4242, text: '/today' }));
    expect(mocks.sendTelegramMessage.mock.calls.map(([options]) => [options.botToken, options.chatId, options.text, options.replyMarkup]))
      .toEqual([[TOKEN, '4242', 'first', KEYBOARD], [TOKEN, '4242', 'second', null]]);
  });

  it('ignores groups, button presses without a person and bodies that are not JSON with 200', async () => {
    expect((await call(privateUpdate('/today', 'supergroup'))).status).toBe(200);
    expect((await call({ update_id: 2, callback_query: { id: 'x' } })).status).toBe(200);
    expect((await call('{not json')).status).toBe(200);
    expect(mocks.handleOwnerBotMessage).not.toHaveBeenCalled();
    expect(mocks.handleOwnerBotCallback).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('answers a button press with its toast, then redraws that message', async () => {
    const response = await call(buttonPress());
    expect(response.status).toBe(200);
    expect(mocks.handleOwnerBotCallback).toHaveBeenCalledWith(SUPABASE, expect.objectContaining({
      callbackQueryId: 'q1', telegramUserId: 4242, chatId: 4242, messageId: 7, privateChat: true, data: 'v1:yes:x',
    }));
    expect(mocks.answerOwnerBotCallback).toHaveBeenCalledWith({ botToken: TOKEN, callbackQueryId: 'q1', text: '✅ Забрал', showAlert: false });
    expect(mocks.editOwnerBotMessage).toHaveBeenCalledWith({ botToken: TOKEN, chatId: 4242, messageId: 7, text: 'day', keyboard: KEYBOARD });
    expect(mocks.answerOwnerBotCallback.mock.invocationCallOrder[0]).toBeLessThan(mocks.editOwnerBotMessage.mock.invocationCallOrder[0]);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('never redraws a message outside the presser\'s own chat', async () => {
    mocks.handleOwnerBotCallback.mockResolvedValue({ answer: { text: '🚫 Нет доступа.', showAlert: true }, edit: { text: 'day', keyboard: null } });
    expect((await call(buttonPress({ id: -100777, type: 'supergroup' }))).status).toBe(200);
    expect(mocks.handleOwnerBotCallback).toHaveBeenCalledWith(SUPABASE, expect.objectContaining({ privateChat: false }));
    expect(mocks.answerOwnerBotCallback).toHaveBeenCalledWith(expect.objectContaining({ text: '🚫 Нет доступа.', showAlert: true }));
    expect(mocks.editOwnerBotMessage).not.toHaveBeenCalled();
  });

  it('still answers 200 when a press fails, and redraws even when the answer is refused', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.handleOwnerBotCallback.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await call(buttonPress())).status).toBe(200);
    expect(mocks.answerOwnerBotCallback).toHaveBeenCalledWith(expect.objectContaining({ text: pressFailedText(), showAlert: true }));
    expect(mocks.editOwnerBotMessage).not.toHaveBeenCalled();

    mocks.answerOwnerBotCallback.mockRejectedValueOnce(new Error('Telegram answerCallbackQuery failed: query is too old'));
    expect((await call(buttonPress())).status).toBe(200);
    expect(mocks.editOwnerBotMessage).toHaveBeenCalledTimes(1);
    mocks.editOwnerBotMessage.mockRejectedValueOnce(new Error('Telegram editMessageText failed'));
    expect((await call(buttonPress())).status).toBe(200);
    expect(error.mock.calls.flat().join(' ')).not.toContain(TOKEN);
    error.mockRestore();
  });

  it('still answers 200 when the update fails, telling the owner to try again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.handleOwnerBotMessage.mockRejectedValue(new Error('database unavailable'));
    expect((await call(privateUpdate())).status).toBe(200);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendTelegramMessage.mock.calls[0][0].text).toBe(errorText());

    mocks.sendTelegramMessage.mockRejectedValue(new Error('Telegram send failed after 2 attempts'));
    mocks.handleOwnerBotMessage.mockResolvedValue(REPLIES);
    mocks.sendTelegramMessage.mockClear();
    expect((await call(privateUpdate())).status).toBe(200);
    // After a failed send the rest are not tried within this update.
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(error.mock.calls.flat().join(' ')).not.toContain(TOKEN);
    error.mockRestore();
  });
});
