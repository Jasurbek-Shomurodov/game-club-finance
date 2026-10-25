import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  sendTelegramMessage: vi.fn(),
  deleteTelegramMessage: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
// after() needs a live request scope; run the task immediately and let tests await it.
vi.mock('next/server', () => ({ after: (task: () => unknown) => { mocks.afterTasks.push(Promise.resolve().then(task)); } }));
vi.mock('@/lib/telegram/sendDailyFinanceReport', async (importOriginal) => ({
  isIsoDate: (await importOriginal<typeof import('@/lib/telegram/sendDailyFinanceReport')>()).isIsoDate,
  sendTelegramMessage: mocks.sendTelegramMessage,
}));
vi.mock('@/lib/telegram/deleteTelegramMessage', () => ({ deleteTelegramMessage: mocks.deleteTelegramMessage }));

import { DELETE, POST } from './route';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const EXCHANGE = '40c05af5-5a59-45ae-a891-19a18228a721';
const saved = {
  id: EXCHANGE, club_id: CLUB, date: '2026-10-24', from_method: 'cash', to_method: 'usd',
  from_amount: '1265000', to_amount: '100', rate: '12650', comment: '',
  telegram_chat_id: '-1001' as string | null, telegram_message_id: 42 as number | null,
};

function mockSupabase({ created = true, rpcError = null as { message: string; code?: string } | null, exchange = saved as typeof saved | null } = {}) {
  const rpc = vi.fn((name: string) => Promise.resolve(name === 'record_money_exchange' && !rpcError
    ? { data: [{ exchange_id: EXCHANGE, created }], error: null }
    : { data: null, error: name === 'set_money_exchange_telegram_message' ? null : rpcError }));
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: table === 'profiles' ? { full_name: 'Alisher' } : exchange, error: null });
    return builder;
  });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1', email: 'o@example.test', user_metadata: {} } } }) },
    rpc,
    from,
  });
  return { rpc };
}

async function call(handler: typeof POST, body: unknown) {
  const response = await handler(new Request('https://example.test/api/exchanges', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  await Promise.all(mocks.afterTasks.splice(0));
  return response;
}

const purchase = { id: EXCHANGE, clubId: CLUB, date: '2026-10-24', from: 'cash', to: 'usd', amount: 1_265_000, rate: 12_650, comment: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'token');
  vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB);
  vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-1001');
  mocks.sendTelegramMessage.mockResolvedValue({ result: { chat: { id: -1001 }, message_id: 7 } });
  mocks.deleteTelegramMessage.mockResolvedValue(undefined);
});

describe('POST /api/exchanges', () => {
  it('records through the RPC, posts to the club group and remembers the message', async () => {
    const { rpc } = mockSupabase();
    const response = await call(POST, purchase);
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('record_money_exchange', {
      p_id: EXCHANGE, p_club_id: CLUB, p_date: '2026-10-24', p_from_method: 'cash', p_to_method: 'usd',
      p_from_amount: 1_265_000, p_rate: 12_650, p_comment: '',
    });
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({ chatId: '-1001', text: expect.stringContaining('Курс: 1 $ = 12 650 сум') }));
    expect(rpc).toHaveBeenCalledWith('set_money_exchange_telegram_message', { p_club_id: CLUB, p_id: EXCHANGE, p_chat_id: '-1001', p_message_id: 7 });
  });

  it('does not post a retried request again', async () => {
    mockSupabase({ created: false });
    expect((await call(POST, purchase)).status).toBe(200);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('rejects malformed exchanges before the database', async () => {
    const { rpc } = mockSupabase();
    for (const body of [
      { ...purchase, to: 'cash', from: 'cash' },
      { ...purchase, rate: null },
      { ...purchase, from: 'terminal', to: 'card', rate: 12_650 },
      { ...purchase, from: 'bitcoin' },
      { ...purchase, amount: -5 },
      { ...purchase, date: '2026-02-30' },
    ]) expect((await call(POST, body)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps database refusals to stable codes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSupabase({ rpcError: { message: 'Payment method is not enabled for this club.', code: 'P0001' } });
    expect(await (await call(POST, purchase)).json()).toMatchObject({ code: 'PAYMENT_METHOD_DISABLED' });
    mockSupabase({ rpcError: { message: 'denied', code: '42501' } });
    expect((await call(POST, purchase)).status).toBe(403);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/exchanges', () => {
  const body = { clubId: CLUB, exchangeId: EXCHANGE };

  it('deletes through the owner-only RPC and removes the group message', async () => {
    const { rpc } = mockSupabase();
    expect((await call(DELETE, body)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('delete_money_exchange', { p_club_id: CLUB, p_id: EXCHANGE });
    expect(mocks.deleteTelegramMessage).toHaveBeenCalledWith({ botToken: 'token', chatId: '-1001', messageId: 42 });
    // The deletion is silent in Telegram, so the group gets its own notice.
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '-1001',
      text: expect.stringMatching(/🗑 Удалён обмен денег[\s\S]*Удалил\(а\): Alisher/),
    }));
  });

  it('keeps the message when the delete is refused, and never deletes outside the club group', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSupabase({ rpcError: { message: 'Only a club owner can delete an exchange.', code: '42501' } });
    expect((await call(DELETE, body)).status).toBe(403);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    mockSupabase({ exchange: { ...saved, telegram_chat_id: '-1009' } });
    expect((await call(DELETE, body)).status).toBe(200);
    expect(mocks.deleteTelegramMessage).not.toHaveBeenCalled();
  });

  it('returns 404 for an exchange outside the club', async () => {
    mockSupabase({ exchange: null });
    expect((await call(DELETE, body)).status).toBe(404);
  });
});
