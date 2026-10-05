import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), sendTelegramMessage: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/telegram/sendDailyFinanceReport', () => ({ sendTelegramMessage: mocks.sendTelegramMessage }));

import { POST } from './route';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const EMPLOYEE = '40c05af5-5a59-45ae-a891-19a18228a721';
const REQUEST = '50c05af5-5a59-45ae-a891-19a18228a722';

function mockSupabase({ user = { id: 'u1', email: 'o@example.test', user_metadata: {} } as unknown, rpcError = null as { message: string; code?: string } | null, existingEntry = false } = {}) {
  const rpc = vi.fn().mockResolvedValue({ error: rpcError });
  const from = vi.fn((table: string) => {
    const result = table === 'profiles' ? { full_name: 'Owner Name' }
      : table === 'salary_employees' ? { id: EMPLOYEE, name: 'Izzat' }
      : table === 'salary_entries' ? (existingEntry ? { id: REQUEST } : null) : null;
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({ data: result, error: null });
    return builder;
  });
  mocks.createClient.mockResolvedValue({ auth: { getUser: () => Promise.resolve({ data: { user } }) }, rpc, from });
  return { rpc };
}

const post = (body: unknown) => POST(new Request('https://example.test/api/salaries', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'token');
  vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB);
  vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-100123');
  mocks.sendTelegramMessage.mockResolvedValue({ result: { chat: { id: -100123 }, message_id: 7 } });
});

describe('POST /api/salaries', () => {
  it('rejects anonymous callers and malformed bodies', async () => {
    mockSupabase({ user: null });
    expect((await post({ action: 'set_active', clubId: CLUB, employeeId: EMPLOYEE, active: false })).status).toBe(401);
    mockSupabase();
    expect((await post({ action: 'change_term', clubId: CLUB, employeeId: EMPLOYEE, kind: 'kpi', amount: 'x' })).status).toBe(400);
    expect((await post({ action: 'nope', clubId: CLUB, employeeId: EMPLOYEE })).status).toBe(400);
  });

  it('changes KPI and notifies the club group', async () => {
    const { rpc } = mockSupabase();
    const response = await post({ action: 'change_term', clubId: CLUB, employeeId: EMPLOYEE, kind: 'kpi', amount: 5 });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('change_salary_term', expect.objectContaining({ p_kind: 'kpi', p_amount: 5, p_salary_type: null }));
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({ chatId: '-100123', text: expect.stringContaining('KPI: 5%') }));
    expect((await response.json()).notificationSent).toBe(true);
  });

  it('uses the activate and deactivate functions', async () => {
    const { rpc } = mockSupabase();
    await post({ action: 'set_active', clubId: CLUB, employeeId: EMPLOYEE, active: true });
    await post({ action: 'set_active', clubId: CLUB, employeeId: EMPLOYEE, active: false });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['activate_salary_employee', 'deactivate_salary_employee']);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(2);
  });

  it('sends a payment notification once, and not for a retried request id', async () => {
    const entry = { action: 'record_entry', clubId: CLUB, employeeId: EMPLOYEE, requestId: REQUEST, date: '2026-10-01', kind: 'payment', amount: 100000, comment: '', paymentMethod: 'cash', paymentSource: 'bar' };
    mockSupabase();
    await post(entry);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    mockSupabase({ existingEntry: true });
    await post(entry);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['bonus', '🎁 Премия'],
    ['fine', '⚠️ Штраф'],
  ])('records a %s and notifies the club group without payment details', async (kind, title) => {
    const { rpc } = mockSupabase();
    const response = await post({ action: 'record_entry', clubId: CLUB, employeeId: EMPLOYEE, requestId: REQUEST, date: '2026-10-01', kind, amount: 50000, comment: 'Late shift', paymentMethod: 'cash', paymentSource: 'bar' });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('record_salary_entry', expect.objectContaining({ p_kind: kind, p_amount: 50000, p_payment_method: null, p_payment_source: null }));
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    const { chatId, text } = mocks.sendTelegramMessage.mock.calls[0][0];
    expect(chatId).toBe('-100123');
    expect(text).toContain(title);
    expect(text).toContain('Сотрудник: Izzat');
    expect(text).toContain('Комментарий: Late shift');
    expect(text).toContain('Добавил(а): Owner Name');
    expect(text).not.toContain('Источник');
    expect(text).not.toContain('Способ оплаты');
    expect((await response.json()).notificationSent).toBe(true);
  });

  it('returns the database error and skips Telegram when the write fails', async () => {
    mockSupabase({ rpcError: { message: 'Only a club owner can change payroll terms.', code: '42501' } });
    const response = await post({ action: 'change_term', clubId: CLUB, employeeId: EMPLOYEE, kind: 'kpi', amount: 5 });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain('club owner');
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('keeps the committed change when Telegram fails', async () => {
    mockSupabase();
    mocks.sendTelegramMessage.mockRejectedValue(new Error('telegram down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await post({ action: 'set_active', clubId: CLUB, employeeId: EMPLOYEE, active: false });
    expect(response.status).toBe(200);
    expect((await response.json()).notificationSent).toBe(false);
  });
});
