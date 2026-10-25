import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  sendTelegramMessage: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
// after() needs a live request scope; run the task immediately and let tests await it.
vi.mock('next/server', () => ({ after: (task: () => unknown) => { mocks.afterTasks.push(Promise.resolve().then(task)); } }));
vi.mock('@/lib/telegram/sendDailyFinanceReport', () => ({ sendTelegramMessage: mocks.sendTelegramMessage }));

import { DELETE, POST } from './route';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const DATE = '2026-10-12';

function mockSupabase({
  rpcResult = { data: true as unknown, error: null as { code: string; message: string } | null },
  collected = true,
  user = { id: 'u1', email: 'o@example.test', user_metadata: {} } as object | null,
} = {}) {
  const rpc = vi.fn(() => Promise.resolve(rpcResult));
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({
      data: table === 'profiles' ? { full_name: 'Izzatilla' } : collected ? { date: DATE } : null,
      error: null,
    });
    return builder;
  });
  mocks.createClient.mockResolvedValue({ auth: { getUser: () => Promise.resolve({ data: { user } }) }, from, rpc });
  return { rpc };
}

async function call(handler: (request: Request) => Promise<Response>, body: unknown): Promise<Response> {
  const response = await handler(new Request('https://example.test/api/collections', {
    method: handler === POST ? 'POST' : 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  await Promise.all(mocks.afterTasks.splice(0));
  return response;
}

describe('/api/collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'token');
    vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB);
    vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-1001');
    mocks.sendTelegramMessage.mockResolvedValue({});
  });

  it('ticks the date as the user and tells the club group', async () => {
    const { rpc } = mockSupabase();
    expect((await call(POST, { clubId: CLUB, date: DATE })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('mark_daily_cash_collected', { p_club_id: CLUB, p_date: DATE });
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '-1001',
      text: expect.stringMatching(/✅ День отмечен как собранный[\s\S]*Дата: 12 октября[\s\S]*Собрал\(а\): Izzatilla/),
    }));
  });

  it('sends nothing when the date was already ticked', async () => {
    mockSupabase({ rpcResult: { data: false, error: null } });
    expect((await call(POST, { clubId: CLUB, date: DATE })).status).toBe(200);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('unticks the date and tells the club group', async () => {
    const { rpc } = mockSupabase({ rpcResult: { data: null, error: null } });
    expect((await call(DELETE, { clubId: CLUB, date: DATE })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('unmark_daily_cash_collected', { p_club_id: CLUB, p_date: DATE });
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringMatching(/↩️ Снята отметка о сборе[\s\S]*Снял\(а\): Izzatilla/),
    }));
  });

  it('sends nothing when an untick finds no tick', async () => {
    mockSupabase({ rpcResult: { data: null, error: null }, collected: false });
    expect((await call(DELETE, { clubId: CLUB, date: DATE })).status).toBe(200);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('maps a refused RPC to 403 and sends nothing', async () => {
    mockSupabase({ rpcResult: { data: null, error: { code: '42501', message: 'Only a club owner can undo a collection.' } } });
    expect((await call(DELETE, { clubId: CLUB, date: DATE })).status).toBe(403);
    expect((await call(POST, { clubId: CLUB, date: DATE })).status).toBe(403);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('rejects a signed-out user and a malformed request', async () => {
    mockSupabase({ user: null });
    expect((await call(POST, { clubId: CLUB, date: DATE })).status).toBe(401);
    const { rpc } = mockSupabase();
    expect((await call(POST, { clubId: CLUB, date: '12.10.2026' })).status).toBe(400);
    expect((await call(DELETE, { clubId: 'x', date: DATE })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
