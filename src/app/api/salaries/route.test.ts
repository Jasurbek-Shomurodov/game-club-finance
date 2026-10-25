import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), sendTelegramMessage: vi.fn(), deleteTelegramMessage: vi.fn(), afterTasks: [] as Promise<unknown>[] }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
// after() needs a live request scope; run the task immediately and let tests await it.
vi.mock('next/server', () => ({ after: (task: () => unknown) => { mocks.afterTasks.push(Promise.resolve().then(task)); } }));
vi.mock('@/lib/telegram/sendDailyFinanceReport', () => ({ sendTelegramMessage: mocks.sendTelegramMessage }));
vi.mock('@/lib/telegram/deleteTelegramMessage', () => ({ deleteTelegramMessage: mocks.deleteTelegramMessage }));

import { POST } from './route';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const EMPLOYEE = '40c05af5-5a59-45ae-a891-19a18228a721';
const REQUEST = '50c05af5-5a59-45ae-a891-19a18228a722';

function mockSupabase({ user = { id: 'u1', email: 'o@example.test', user_metadata: {} } as unknown, rpcError = null as { message: string; code?: string } | null, existingEntry = false, withStatus = true, coordinates = null as Record<string, unknown> | null, rateVersions = [{ id: 'rate-0', created_at: 't0' }, { id: 'rate-1', created_at: 't1' }] } = {}) {
  let rateRead = 0;
  const rpc = vi.fn((name: string) => {
    if (name !== 'record_salary_entry_with_status') return Promise.resolve({ error: rpcError });
    if (!withStatus) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.record_salary_entry_with_status' } });
    return Promise.resolve(rpcError ? { data: null, error: rpcError } : { data: [{ entry_id: REQUEST, created: !existingEntry }], error: null });
  });
  const from = vi.fn((table: string) => {
    const result = table === 'profiles' ? { full_name: 'Owner Name' }
      : table === 'salary_employees' ? { id: EMPLOYEE, name: 'Izzat' }
      : table === 'salary_rates' ? rateVersions[Math.min(rateRead++, rateVersions.length - 1)] : null;
    const builder: Record<string, unknown> = {};
    let columns = '';
    builder.select = (selected: string) => { columns = selected; return builder; };
    builder.is = () => builder;
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.eq = () => builder;
    builder.maybeSingle = () => Promise.resolve({
      data: columns.startsWith('telegram_') ? coordinates
        : table === 'salary_entries' ? (existingEntry ? { id: REQUEST, kind: 'bonus', amount: 100, date: '2026-10-01' } : null) : result,
      error: null,
    });
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
    expect(rpc.mock.calls.map(([name]) => name).filter((name) => name !== 'set_salary_record_telegram_message'))
      .toEqual(['activate_salary_employee', 'deactivate_salary_employee']);
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
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['record_salary_entry_with_status', 'record_salary_entry', 'set_salary_record_telegram_message']);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    mockSupabase({ withStatus: false, existingEntry: true });
    await post(entry);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it('deletes records through the audited RPC', async () => {
    const { rpc } = mockSupabase();
    const response = await post({ action: 'delete_record', clubId: CLUB, employeeId: EMPLOYEE, recordId: REQUEST, kind: 'entry', reason: '  Paid twice  ' });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('delete_salary_record', { p_club_id: CLUB, p_id: REQUEST, p_kind: 'entry', p_reason: 'Paid twice' });
    expect((await post({ action: 'delete_record', clubId: CLUB, employeeId: EMPLOYEE, recordId: REQUEST, kind: 'employee', reason: 'x' })).status).toBe(400);
  });

  it('falls back to the reasonless RPC before migration 089', async () => {
    const { rpc } = mockSupabase();
    rpc.mockImplementationOnce(() => Promise.resolve({ error: { code: 'PGRST202', message: 'Could not find the function public.delete_salary_record' } }));
    const response = await post({ action: 'delete_record', clubId: CLUB, employeeId: EMPLOYEE, recordId: REQUEST, kind: 'entry', reason: 'Paid twice' });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith('delete_salary_record', { p_club_id: CLUB, p_id: REQUEST, p_kind: 'entry' });
  });

  it('requires a deletion reason', async () => {
    const { rpc } = mockSupabase();
    for (const reason of [undefined, '', '   ', 'x'.repeat(501)]) {
      const response = await post({ action: 'delete_record', clubId: CLUB, employeeId: EMPLOYEE, recordId: REQUEST, kind: 'entry', reason });
      expect(response.status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ message: 'Payment method is not enabled for this club.', code: 'P0001' }, 400, 'PAYMENT_METHOD_DISABLED'],
    [{ message: 'The last salary rate cannot be deleted. Change salary settings or deactivate the employee instead.', code: 'P0001' }, 409, 'LAST_RATE'],
    [{ message: 'connection reset', code: '08006' }, 500, 'SERVER_ERROR'],
  ])('returns a stable code instead of database text (%o)', async (rpcError, status, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSupabase({ rpcError });
    const response = await post({ action: 'delete_record', clubId: CLUB, employeeId: EMPLOYEE, recordId: REQUEST, kind: 'rate', reason: 'Wrong date' });
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

  it('remembers where an entry and a rate change were announced', async () => {
    const { rpc } = mockSupabase();
    await post({ action: 'record_entry', clubId: CLUB, employeeId: EMPLOYEE, requestId: REQUEST, date: '2026-10-01', kind: 'bonus', amount: 100, comment: '' });
    expect(rpc).toHaveBeenCalledWith('set_salary_record_telegram_message', { p_club_id: CLUB, p_kind: 'entry', p_id: REQUEST, p_chat_id: '-100123', p_message_id: 7 });
    await post({ action: 'change_term', clubId: CLUB, employeeId: EMPLOYEE, kind: 'kpi', amount: 5 });
    expect(rpc).toHaveBeenCalledWith('set_salary_record_telegram_message', { p_club_id: CLUB, p_kind: 'rate', p_id: 'rate-1', p_chat_id: '-100123', p_message_id: 7 });
  });

  it('links nothing when the rate change wrote no rate', async () => {
    // Deactivating an already inactive employee leaves the newest rate as it was.
    const same = { id: 'rate-0', created_at: 't0' };
    const { rpc } = mockSupabase({ rateVersions: [same, same] });
    await post({ action: 'set_active', clubId: CLUB, employeeId: EMPLOYEE, active: false });
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalledWith('set_salary_record_telegram_message', expect.anything());
  });

  it('links an activation to the rate it wrote', async () => {
    const { rpc } = mockSupabase();
    await post({ action: 'set_active', clubId: CLUB, employeeId: EMPLOYEE, active: true });
    expect(rpc).toHaveBeenCalledWith('set_salary_record_telegram_message', expect.objectContaining({ p_kind: 'rate', p_id: 'rate-1' }));
  });

  it('deletes a deleted record\'s announcement, only from the club group', async () => {
    const body = { action: 'delete_record', clubId: CLUB, employeeId: EMPLOYEE, recordId: REQUEST, kind: 'entry', reason: 'Paid twice' };
    mockSupabase({ existingEntry: true, coordinates: { telegram_chat_id: '-100123', telegram_message_id: 42 } });
    expect((await post(body)).status).toBe(200);
    expect(mocks.deleteTelegramMessage).toHaveBeenCalledWith({ botToken: 'token', chatId: '-100123', messageId: 42 });

    mocks.deleteTelegramMessage.mockClear();
    mockSupabase({ existingEntry: true, coordinates: { telegram_chat_id: '-100999', telegram_message_id: 42 } });
    await post(body);
    expect(mocks.deleteTelegramMessage).not.toHaveBeenCalled();
  });

  it('keeps the message when the record could not be deleted', async () => {
    mockSupabase({ existingEntry: true, rpcError: { message: 'denied', code: '42501' }, coordinates: { telegram_chat_id: '-100123', telegram_message_id: 42 } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await post({ action: 'delete_record', clubId: CLUB, employeeId: EMPLOYEE, recordId: REQUEST, kind: 'entry', reason: 'x' })).status).toBe(403);
    expect(mocks.deleteTelegramMessage).not.toHaveBeenCalled();
  });
});
