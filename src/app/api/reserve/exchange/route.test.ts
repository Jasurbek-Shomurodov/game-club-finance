import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  sendTelegramMessage: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
// after() needs a live request scope; run the task immediately and let tests await it.
vi.mock('next/server', () => ({ after: (task: () => unknown) => { mocks.afterTasks.push(Promise.resolve().then(task)); } }));
vi.mock('@/lib/telegram/sendDailyFinanceReport', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/telegram/sendDailyFinanceReport')>(),
  sendTelegramMessage: mocks.sendTelegramMessage,
}));

import { POST } from './route';

const CLUB_ID = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const ID_1 = '40c05af5-5a59-45ae-a891-19a18228a721';
const ID_2 = '40c05af5-5a59-45ae-a891-19a18228a722';

const request = (body: unknown) => new Request('https://example.test/api/reserve/exchange', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

async function flush(response: Promise<Response>) {
  const result = await response;
  await Promise.all(mocks.afterTasks.splice(0));
  return result;
}

const savedExchange = {
  id: ID_1, club_id: CLUB_ID, date: '2026-11-19', from_method: 'cash', to_method: 'usd',
  from_amount: '2500000', to_amount: '200', rate: '12500', comment: 'Dollars for the savings',
  telegram_chat_id: null, telegram_message_id: null,
};

function mockSupabase(options: { user?: boolean; rpc?: Array<{ data?: unknown; error?: unknown }> } = {}) {
  const results = [...(options.rpc ?? [])];
  const rpc = vi.fn(() => Promise.resolve({ data: true, error: null, ...(results.shift() ?? {}) }));
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve({ data: savedExchange, error: null })),
  };
  const from = vi.fn((table: string) => (table === 'profiles'
    ? { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { full_name: 'Owner Ali' }, error: null }) }) }) }
    : query));
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: options.user === false ? null : { id: 'user-1', user_metadata: {} } } }) },
    from,
    rpc,
  });
  return { rpc };
}

const buy = {
  clubId: CLUB_ID, id: ID_1, entryId: ID_2, date: '2026-11-19', direction: 'buy', method: 'cash',
  amount: 2_500_000, rate: 12_500, comment: 'Dollars for the savings',
};

describe('/api/reserve/exchange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.afterTasks.length = 0;
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
    vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB_ID);
    vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-1001');
    mocks.sendTelegramMessage.mockResolvedValue({ result: { chat: { id: -1001 }, message_id: 7 } });
  });

  it('records both halves in one call and tells the group it stayed inside the reserve', async () => {
    const { rpc } = mockSupabase();
    const response = await flush(POST(request(buy)));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('exchange_owner_reserve', {
      p_club_id: CLUB_ID, p_id: ID_1, p_entry_id: ID_2, p_date: '2026-11-19', p_direction: 'buy', p_method: 'cash',
      p_amount: 2_500_000, p_rate: 12_500, p_comment: 'Dollars for the savings',
    });
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendTelegramMessage.mock.calls[0][0].text).toContain('внутри резерва: сумы → доллары');
    expect(rpc).toHaveBeenCalledWith('set_money_exchange_telegram_message', expect.objectContaining({ p_id: ID_1, p_message_id: 7 }));
  });

  it('stays quiet for a retried request', async () => {
    mockSupabase({ rpc: [{ data: false }] });
    const response = await flush(POST(request(buy)));
    expect(response.status).toBe(200);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('refuses bad input, a short note and signed-out users before the database', async () => {
    const { rpc } = mockSupabase();
    expect((await POST(request({ ...buy, method: 'playstation' }))).status).toBe(400);
    expect((await POST(request({ ...buy, entryId: ID_1 }))).status).toBe(400);
    expect((await POST(request({ ...buy, rate: 0 }))).status).toBe(400);
    const short = await POST(request({ ...buy, comment: 'dollars' }));
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ failure: 'note_required' });
    expect(rpc).not.toHaveBeenCalled();
    mockSupabase({ user: false });
    expect((await POST(request(buy))).status).toBe(401);
  });

  it('passes the database refusal on as a reserve error', async () => {
    mockSupabase({ rpc: [{ data: null, error: { code: '23514', message: 'The reserve holds 0', hint: 'reserve_insufficient' } }] });
    const response = await flush(POST(request(buy)));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ failure: 'insufficient' });
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });
});
