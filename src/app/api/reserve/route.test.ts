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

const CLUB_ID = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const ID_1 = '40c05af5-5a59-45ae-a891-19a18228a721';
const ID_2 = '40c05af5-5a59-45ae-a891-19a18228a722';

const request = (method: 'POST' | 'DELETE', body: unknown) => new Request('https://example.test/api/reserve', {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

async function flush(response: Promise<Response>) {
  const result = await response;
  await Promise.all(mocks.afterTasks.splice(0));
  return result;
}

function mockSupabase(options: { user?: boolean; rpc?: Array<{ data?: unknown; error?: unknown }>; entry?: unknown } = {}) {
  const results = [...(options.rpc ?? [])];
  const rpc = vi.fn(() => Promise.resolve({ data: true, error: null, ...(results.shift() ?? {}) }));
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn((): Promise<{ data: unknown; error: unknown }> => Promise.resolve({ data: options.entry ?? null, error: null })),
  };
  const from = vi.fn((table: string) => (table === 'profiles'
    ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { full_name: 'Owner Ali' }, error: null }) }) }) }
    : query));
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user === false ? null : { id: 'user-1', user_metadata: {} } } }) },
    from,
    rpc,
  });
  return { rpc, from };
}

const deposit = {
  clubId: CLUB_ID,
  kind: 'deposit',
  month: '2026-10',
  source: 'game_club',
  comment: '',
  parts: [{ id: ID_1, method: 'cash', amount: 649_200 }, { id: ID_2, method: 'playstation', amount: 210_000 }],
};

describe('/api/reserve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterTasks.length = 0;
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
    vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB_ID);
    vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-1001');
    mocks.sendTelegramMessage.mockResolvedValue({ result: { chat: { id: -1001 }, message_id: 1 } });
  });

  it('records each method part and posts one message naming the source month', async () => {
    const { rpc } = mockSupabase();
    const response = await flush(POST(request('POST', deposit)));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, 'move_owner_profit_to_reserve', expect.objectContaining({
      p_club_id: CLUB_ID, p_id: ID_1, p_period_month: '2026-10-01', p_payment_method: 'cash', p_amount: 649_200,
    }));
    expect(mocks.sendTelegramMessage).toHaveBeenCalledOnce();
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith({
      botToken: 'bot-token',
      chatId: '-1001',
      text: '🏦 В резерв: 859 200 сум\nИгровой клуб · Наличные 649 200 · PlayStation 210 000 · из прибыли за октябрь 2026\nOwner Ali',
    });
  });

  it('posts nothing for a retried request the database already recorded', async () => {
    mockSupabase({ rpc: [{ data: false }, { data: false }] });
    expect((await flush(POST(request('POST', deposit)))).status).toBe(200);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('names the stored and the refused parts, and returns the refusal', async () => {
    mockSupabase({ rpc: [{}, { data: null, error: { hint: 'reserve_exceeds_available' } }] });
    const response = await flush(POST(request('POST', deposit)));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      failure: 'exceeds_available',
      saved: [{ id: ID_1, method: 'cash', amount: 649_200 }],
      failed: [{ id: ID_2, method: 'playstation', amount: 210_000, failure: 'exceeds_available' }],
    });
    expect(mocks.sendTelegramMessage.mock.calls[0][0].text).toContain('🏦 В резерв: 649 200 сум');
  });

  it('still stores the parts after a refused one: each method has its own balance', async () => {
    const { rpc } = mockSupabase({ rpc: [{ data: null, error: { hint: 'reserve_insufficient' } }, {}] });
    const response = await flush(POST(request('POST', deposit)));

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      failure: 'insufficient',
      saved: [{ id: ID_2, method: 'playstation', amount: 210_000 }],
      failed: [{ id: ID_1, method: 'cash', amount: 649_200, failure: 'insufficient' }],
    });
    expect(mocks.sendTelegramMessage.mock.calls[0][0].text).toContain('🏦 В резерв: 210 000 сум');
  });

  it('lists a retried part as stored though nothing new was recorded', async () => {
    mockSupabase({ rpc: [{ data: false }, { data: true }] });
    const response = await flush(POST(request('POST', deposit)));

    expect(await response.json()).toEqual({ recorded: 1, saved: deposit.parts, failed: [] });
  });

  it('refuses a signed-out caller, a Bar part with a method, and a Game Club part without one', async () => {
    mockSupabase({ user: false });
    expect((await POST(request('POST', deposit))).status).toBe(401);
    const { rpc } = mockSupabase();
    expect((await POST(request('POST', { ...deposit, source: 'bar', parts: [{ id: ID_1, method: 'cash', amount: 1 }] }))).status).toBe(400);
    expect((await POST(request('POST', { ...deposit, parts: [{ id: ID_1, method: null, amount: 1 }] }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes the day the money moved, and refuses one outside the month', async () => {
    const { rpc } = mockSupabase();
    expect((await flush(POST(request('POST', { ...deposit, date: '2026-10-11' })))).status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(1, 'move_owner_profit_to_reserve', expect.objectContaining({ p_date: '2026-10-11' }));
    rpc.mockClear();
    expect((await POST(request('POST', { ...deposit, date: '2026-11-11' }))).status).toBe(400);
    expect((await POST(request('POST', { ...deposit, date: '11.10.2026' }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('deletes an entry, then tells the group where its money went back', async () => {
    const { rpc } = mockSupabase({ entry: {
      kind: 'deposit', period_month: '2026-10-01', source: 'game_club', payment_method: 'cash', amount: '649200', comment: null,
    } });
    const response = await flush(DELETE(request('DELETE', { clubId: CLUB_ID, entryId: ID_1 })));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('delete_owner_reserve_entry', { p_club_id: CLUB_ID, p_entry_id: ID_1 });
    expect(mocks.sendTelegramMessage.mock.calls[0][0].text).toBe(
      '🗑 Удалено внесение в резерв: 649 200 сум\nИгровой клуб · Наличные · деньги вернулись в прибыль за октябрь 2026\nУдалил(а) Owner Ali',
    );
  });

  it('keeps quiet when the database refuses the deletion', async () => {
    mockSupabase({
      entry: { kind: 'deposit', period_month: '2026-10-01', source: 'game_club', payment_method: 'cash', amount: 1, comment: null },
      rpc: [{ data: null, error: { hint: 'reserve_already_used' } }],
    });
    const response = await flush(DELETE(request('DELETE', { clubId: CLUB_ID, entryId: ID_1 })));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ failure: 'already_used' });
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });
});
