import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), sendTelegramMessage: vi.fn(), afterTasks: [] as Promise<unknown>[] }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
// after() needs a live request scope; run the task immediately and let tests await it.
vi.mock('next/server', () => ({ after: (task: () => unknown) => { mocks.afterTasks.push(Promise.resolve().then(task)); } }));
vi.mock('@/lib/telegram/sendDailyFinanceReport', () => ({ sendTelegramMessage: mocks.sendTelegramMessage }));

import { POST } from './route';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const EMPLOYEE = '40c05af5-5a59-45ae-a891-19a18228a721';
const REQUEST = '50c05af5-5a59-45ae-a891-19a18228a722';

function mockSupabase({ user = { id: 'u1', email: 'o@example.test', user_metadata: {} } as unknown, rpcError = null as { message: string; code?: string } | null, existingEntry = false, withStatus = true } = {}) {
  const rpc = vi.fn((name: string) => {
    if (name !== 'record_salary_entry_with_status') return Promise.resolve({ error: rpcError });
    if (!withStatus) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.record_salary_entry_with_status' } });
    return Promise.resolve(rpcError ? { data: null, error: rpcError } : { data: [{ entry_id: REQUEST, created: !existingEntry }], error: null });
  });
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

const post = async (body: unknown) => {
  const response = await POST(new Request('https://example.test/api/salaries', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  await Promise.all(mocks.afterTasks.splice(0));
  return response;
};

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
    expect((await response.json()).notificationQueued).toBe(true);
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
    const { rpc } = mockSupabase({ existingEntry: true });
    await post(entry);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('record_salary_entry_with_status', expect.objectContaining({ p_request_id: REQUEST }));
  });

  it('falls back to a lookup and the original RPC before migration 077', async () => {
    const entry = { action: 'record_entry', clubId: CLUB, employeeId: EMPLOYEE, requestId: REQUEST, date: '2026-10-01', kind: 'bonus', amount: 100, comment: '' };
    const { rpc } = mockSupabase({ withStatus: false });
    expect((await post(entry)).status).toBe(200);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['record_salary_entry_with_status', 'record_salary_entry']);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    mockSupabase({ withStatus: false, existingEntry: true });
    await post(entry);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it('deletes records through the audited RPC', async () => {
    const { rpc } = mockSupabase();
    const response = await post({ action: 'delete_record', clubId: CLUB, employeeId: EMPLOYEE, recordId: REQUEST, kind: 'entry' });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('delete_salary_record', { p_club_id: CLUB, p_id: REQUEST, p_kind: 'entry' });
    expect((await post({ action: 'delete_record', clubId: CLUB, employeeId: EMPLOYEE, recordId: REQUEST, kind: 'employee' })).status).toBe(400);
  });

  it.each([
    [{ message: 'Payment method is not enabled for this club.', code: 'P0001' }, 400, 'PAYMENT_METHOD_DISABLED'],
    [{ message: 'The last salary rate cannot be deleted. Change salary settings or deactivate the employee instead.', code: 'P0001' }, 409, 'LAST_RATE'],
    [{ message: 'connection reset', code: '08006' }, 500, 'SERVER_ERROR'],
  ])('returns a stable code instead of database text (%o)', async (rpcError, status, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSupabase({ rpcError });
    const response = await post({ action: 'delete_record', clubId: CLUB, employeeId: EMPLOYEE, recordId: REQUEST, kind: 'rate' });
    expect(response.status).toBe(status);
    const payload = await response.json();
    expect(payload.code).toBe(code);
    expect(payload.error).not.toBe(rpcError.message);
  });

  it.each([
    ['bonus', '🎁 Премия'],
    ['fine', '⚠️ Штраф'],
  ])('records a %s and notifies the club group without payment details', async (kind, title) => {
    const { rpc } = mockSupabase();
    const response = await post({ action: 'record_entry', clubId: CLUB, employeeId: EMPLOYEE, requestId: REQUEST, date: '2026-10-01', kind, amount: 50000, comment: 'Late shift', paymentMethod: 'cash', paymentSource: 'bar' });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('record_salary_entry_with_status', expect.objectContaining({ p_kind: kind, p_amount: 50000, p_payment_method: null, p_payment_source: null }));
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    const { chatId, text } = mocks.sendTelegramMessage.mock.calls[0][0];
    expect(chatId).toBe('-100123');
    expect(text).toContain(title);
    expect(text).toContain('Сотрудник: Izzat');
    expect(text).toContain('Комментарий: Late shift');
    expect(text).toContain('Добавил(а): Owner Name');
    expect(text).not.toContain('Источник');
    expect(text).not.toContain('Способ оплаты');
    expect((await response.json()).notificationQueued).toBe(true);
  });

  it('returns an owner-only code and skips Telegram when the write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSupabase({ rpcError: { message: 'Only a club owner can change payroll terms.', code: '42501' } });
    const response = await post({ action: 'change_term', clubId: CLUB, employeeId: EMPLOYEE, kind: 'kpi', amount: 5 });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('OWNER_ONLY');
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('keeps the committed change when Telegram fails', async () => {
    mockSupabase();
    mocks.sendTelegramMessage.mockRejectedValue(new Error('telegram down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await post({ action: 'set_active', clubId: CLUB, employeeId: EMPLOYEE, active: false });
    expect(response.status).toBe(200);
    expect(console.error).toHaveBeenCalledWith('[telegram/salary] notification failed', expect.anything());
  });
});
