import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  sendTelegramMessage: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('next/server', () => ({ after: (task: () => unknown) => { mocks.afterTasks.push(Promise.resolve().then(task)); } }));
vi.mock('@/lib/telegram/sendDailyFinanceReport', () => ({ sendTelegramMessage: mocks.sendTelegramMessage }));

import { POST } from './route';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const REQUEST = '11111111-2222-4333-8444-555555555555';
const DATE = '2026-11-03';

function mockSupabase({
  rpcResult = { data: true as unknown, error: null as { code: string; message: string; hint?: string } | null },
  user = { id: 'u1', email: 'o@example.test', user_metadata: {} } as object | null,
} = {}) {
  const rpc = vi.fn(() => Promise.resolve(rpcResult));
  const from = vi.fn(() => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: { full_name: 'Mother' }, error: null });
    return builder;
  });
  mocks.createClient.mockResolvedValue({ auth: { getUser: () => Promise.resolve({ data: { user } }) }, from, rpc });
  return { rpc };
}

async function call(body: unknown): Promise<Response> {
  const response = await POST(new Request('https://example.test/api/money-collections', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  await Promise.all(mocks.afterTasks.splice(0));
  return response;
}

const body = { clubId: CLUB, requestId: REQUEST, date: DATE, amounts: { cash: 3_000_000, card: 0, terminal: 500_000 }, comment: ' three days ' };

describe('/api/money-collections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'token');
    vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB);
    vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-1001');
    mocks.sendTelegramMessage.mockResolvedValue({});
  });

  it('collects as the user, dropping zero methods, and tells the club group', async () => {
    const { rpc } = mockSupabase();
    expect((await call(body)).status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('collect_money', {
      p_club_id: CLUB, p_request_id: REQUEST, p_date: DATE, p_amounts: { cash: 3_000_000, terminal: 500_000 }, p_comment: 'three days',
    });
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '-1001',
      text: expect.stringContaining('Деньги собраны: 3 500 000 сум'),
    }));
  });

  it('does not notify twice for a retried request', async () => {
    mockSupabase({ rpcResult: { data: false, error: null } });
    expect((await call(body)).status).toBe(200);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('refuses malformed bodies and nothing to collect', async () => {
    mockSupabase();
    expect((await call({ ...body, amounts: { cash: 0 } })).status).toBe(400);
    expect((await call({ ...body, amounts: { usd: 5 } })).status).toBe(400);
    expect((await call({ ...body, amounts: { cash: 1.5 } })).status).toBe(400);
    expect((await call({ ...body, requestId: 'x' })).status).toBe(400);
  });

  it('maps refusals', async () => {
    mockSupabase({ user: null });
    expect((await call(body)).status).toBe(401);
    mockSupabase({ rpcResult: { data: null, error: { code: '42501', message: 'no' } } });
    expect((await call(body)).status).toBe(403);
    mockSupabase({ rpcResult: { data: null, error: { code: 'P0001', message: 'short', hint: 'INSUFFICIENT_BALANCE' } } });
    expect((await call(body)).status).toBe(409);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSupabase({ rpcResult: { data: null, error: { code: 'XX000', message: 'boom' } } });
    expect((await call(body)).status).toBe(500);
  });
});
