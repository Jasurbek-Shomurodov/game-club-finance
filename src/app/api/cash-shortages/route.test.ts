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
  isIsoDate: (await importOriginal<typeof import('@/lib/telegram/sendDailyFinanceReport')>()).isIsoDate,
  sendTelegramMessage: mocks.sendTelegramMessage,
}));

import { POST } from './route';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const SHORTAGE = '40c05af5-5a59-45ae-a891-19a18228a721';
const EMPLOYEE = '50c05af5-5a59-45ae-a891-19a18228a722';
const RECOVERY = '60c05af5-5a59-45ae-a891-19a18228a723';

function mockSupabase({ created = true, rpcError = null as { message: string; code?: string; hint?: string } | null } = {}) {
  const rpc = vi.fn(() => Promise.resolve(rpcError ? { data: null, error: rpcError } : { data: created, error: null }));
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: table === 'profiles' ? { full_name: 'Jasurbek' } : { name: 'Izzat' }, error: null });
    return builder;
  });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1', email: 'o@example.test', user_metadata: {} } } }) },
    rpc,
    from,
  });
  return { rpc };
}

async function call(body: unknown) {
  const response = await POST(new Request('https://example.test/api/cash-shortages', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  await Promise.all(mocks.afterTasks.splice(0));
  return response;
}

const shortage = {
  id: SHORTAGE, clubId: CLUB, date: '2026-11-11', source: 'game_club', method: 'cash', amount: 300_000,
  reason: 'stolen', employeeId: EMPLOYEE, comment: 'Cash was missing at the evening handover', recoverAmount: 100_000, recoveryId: RECOVERY,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'token');
  vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB);
  vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-100club');
  vi.stubEnv('TELEGRAM_MAIN_OWNER_CHAT_ID', '-100owners');
  mocks.sendTelegramMessage.mockResolvedValue({ result: { chat: { id: -100 }, message_id: 7 } });
});

describe('POST /api/cash-shortages', () => {
  it('records through the RPC and tells only the owners group', async () => {
    const { rpc } = mockSupabase();
    const response = await call(shortage);
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('record_cash_shortage', {
      p_club_id: CLUB, p_id: SHORTAGE, p_date: '2026-11-11', p_payment_source: 'game_club', p_payment_method: 'cash',
      p_amount: 300_000, p_reason: 'stolen', p_employee_id: EMPLOYEE, p_comment: 'Cash was missing at the evening handover',
      p_recover_amount: 100_000, p_recovery_id: RECOVERY,
    });
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '-100owners', text: expect.stringContaining('Ответственный: Izzat'),
    }));
  });

  it('sends nothing without an owners group, never to the club group admins read', async () => {
    vi.stubEnv('TELEGRAM_MAIN_OWNER_CHAT_ID', '');
    mockSupabase();
    expect((await call(shortage)).status).toBe(201);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('does not message again for a retried request', async () => {
    mockSupabase({ created: false });
    expect((await call(shortage)).status).toBe(200);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('refuses a short note, a recovery without a responsible person, and non-owners', async () => {
    mockSupabase();
    expect((await call({ ...shortage, comment: 'missing' })).status).toBe(400);
    expect((await call({ ...shortage, employeeId: null })).status).toBe(400);
    mockSupabase({ rpcError: { message: 'Only a club owner can record a shortage.', code: '42501' } });
    const refused = await call(shortage);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: 'forbidden' });
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('reports a closed day so the form can say so', async () => {
    mockSupabase({ rpcError: { message: 'The money for 2026-11-11 has been collected', code: '55000', hint: 'day_collected' } });
    const response = await call(shortage);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: 'day_collected' });
  });
});
