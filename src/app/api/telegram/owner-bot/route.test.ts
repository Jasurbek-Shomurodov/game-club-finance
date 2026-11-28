import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  handleOwnerBotMessage: vi.fn(),
  sendTelegramMessage: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock('@/lib/telegram/ownerBot/handler', () => ({ handleOwnerBotMessage: mocks.handleOwnerBotMessage }));
vi.mock('@/lib/telegram/sendDailyFinanceReport', () => ({ sendTelegramMessage: mocks.sendTelegramMessage }));

import { errorText } from '@/lib/telegram/ownerBot/texts';
import { POST } from './route';

const SECRET = 'test-owner-bot-secret_0123456789';
const TOKEN = 'test-owner-bot-token';
const SUPABASE = { kind: 'service client' };

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
  mocks.handleOwnerBotMessage.mockResolvedValue(['first', 'second']);
  mocks.sendTelegramMessage.mockResolvedValue({ ok: true, result: { message_id: 9 } });
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
    expect(mocks.sendTelegramMessage.mock.calls.map(([options]) => [options.botToken, options.chatId, options.text]))
      .toEqual([[TOKEN, '4242', 'first'], [TOKEN, '4242', 'second']]);
  });

  it('ignores groups, button presses and bodies that are not JSON with 200', async () => {
    expect((await call(privateUpdate('/today', 'supergroup'))).status).toBe(200);
    expect((await call({ update_id: 2, callback_query: { id: 'x' } })).status).toBe(200);
    expect((await call('{not json')).status).toBe(200);
    expect(mocks.handleOwnerBotMessage).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('still answers 200 when the update fails, telling the owner to try again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.handleOwnerBotMessage.mockRejectedValue(new Error('database unavailable'));
    expect((await call(privateUpdate())).status).toBe(200);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendTelegramMessage.mock.calls[0][0].text).toBe(errorText());

    mocks.sendTelegramMessage.mockRejectedValue(new Error('Telegram send failed after 2 attempts'));
    mocks.handleOwnerBotMessage.mockResolvedValue(['first', 'second']);
    mocks.sendTelegramMessage.mockClear();
    expect((await call(privateUpdate())).status).toBe(200);
    // After a failed send the rest are not tried within this update.
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(error.mock.calls.flat().join(' ')).not.toContain(TOKEN);
    error.mockRestore();
  });
});
