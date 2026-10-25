import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  deleteTelegramMessage: vi.fn(),
  editTelegramMessage: vi.fn(),
  sendTelegramMessage: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
// after() needs a live request scope; run the task immediately and let tests await it.
vi.mock('next/server', () => ({ after: (task: () => unknown) => { mocks.afterTasks.push(Promise.resolve().then(task)); } }));
vi.mock('@/lib/telegram/deleteTelegramMessage', () => ({
  deleteTelegramMessage: mocks.deleteTelegramMessage,
}));
vi.mock('@/lib/telegram/editTelegramMessage', () => ({
  editTelegramMessage: mocks.editTelegramMessage,
}));
vi.mock('@/lib/telegram/expenseNotification', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telegram/expenseNotification')>()),
  buildExpenseNotification: vi.fn(() => 'expense'),
}));
vi.mock('@/lib/telegram/sendDailyFinanceReport', async (importOriginal) => ({
  isIsoDate: (await importOriginal<typeof import('@/lib/telegram/sendDailyFinanceReport')>()).isIsoDate,
  sendTelegramMessage: mocks.sendTelegramMessage,
}));
vi.mock('@/types', () => ({ PAYMENT_METHODS: ['cash', 'terminal', 'card'] }));

import { DELETE, PATCH, POST } from './route';

const CLUB_ID = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const EXPENSE_ID = '40c05af5-5a59-45ae-a891-19a18228a721';

async function DELETE_AND_FLUSH(request: Request) {
  const response = await DELETE(request);
  await Promise.all(mocks.afterTasks.splice(0));
  return response;
}

function deleteRequest() {
  return new Request('https://example.test/api/expenses', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clubId: CLUB_ID, expenseId: EXPENSE_ID }),
  });
}

function queryResult<T>(data: T, error: { message: string } | null = null) {
  const builder = {
    data,
    error,
    select: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    single: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: { data: T; error: { message: string } | null }) => unknown) => (
      Promise.resolve({ data, error }).then(resolve)
    ),
  };
  builder.select.mockReturnValue(builder);
  builder.delete.mockReturnValue(builder);
  builder.insert.mockReturnValue(builder);
  builder.upsert.mockReturnValue(builder);
  builder.update.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue({ data, error });
  builder.maybeSingle.mockResolvedValue({ data, error });
  return builder;
}

function mockSupabase(expense: Record<string, unknown> & {
  id: string;
  salary_entry_id?: string;
  telegram_chat_id: string | null;
  telegram_message_id: number | null;
}, deletedRows: { id: string }[] = [{ id: EXPENSE_ID }]) {
  const membershipQuery = queryResult({ role: 'owner' });
  const expenseQuery = queryResult(expense);
  const deleteQuery = queryResult(deletedRows);
  const rpc = vi.fn().mockResolvedValue({ error: null });
  let expenseCall = 0;
  const from = vi.fn((table: string) => {
    if (table === 'club_memberships') return membershipQuery;
    expenseCall += 1;
    return expenseCall === 1 ? expenseQuery : deleteQuery;
  });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from,
    rpc,
  });
  return { deleteQuery, rpc };
}

describe('expense deletion route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
    vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB_ID);
    vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-1001');
    mocks.deleteTelegramMessage.mockResolvedValue(undefined);
  });

  it('never deletes a Telegram message outside the club\'s configured group', async () => {
    const { deleteQuery } = mockSupabase({
      id: EXPENSE_ID,
      telegram_chat_id: '-1009',
      telegram_message_id: 42,
    });

    const response = await DELETE_AND_FLUSH(deleteRequest());

    expect(response.status).toBe(200);
    expect(deleteQuery.delete).toHaveBeenCalledOnce();
    expect(mocks.deleteTelegramMessage).not.toHaveBeenCalled();
  });

  it('deletes the expense before its Telegram notification', async () => {
    const { deleteQuery } = mockSupabase({
      id: EXPENSE_ID,
      telegram_chat_id: '-1001',
      telegram_message_id: 42,
    });

    const response = await DELETE_AND_FLUSH(deleteRequest());

    expect(response.status).toBe(200);
    expect(mocks.deleteTelegramMessage).toHaveBeenCalledWith({
      botToken: 'bot-token',
      chatId: '-1001',
      messageId: 42,
    });
    expect(deleteQuery.delete).toHaveBeenCalledOnce();
    expect(deleteQuery.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteTelegramMessage.mock.invocationCallOrder[0],
    );
  });

  it('returns 404 and keeps the Telegram message when no row was deleted', async () => {
    mockSupabase({ id: EXPENSE_ID, telegram_chat_id: '-1001', telegram_message_id: 42 }, []);
    const response = await DELETE_AND_FLUSH(deleteRequest());
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('NOT_FOUND');
    expect(mocks.deleteTelegramMessage).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('posts a deletion notice to the club group, even without a stored message', async () => {
    mockSupabase({
      id: EXPENSE_ID, telegram_chat_id: null, telegram_message_id: null,
      amount: 50000, category: 'electricity', payment_method: 'cash', payment_source: 'game_club', date: '2026-10-20', comment: null,
    });
    expect((await DELETE_AND_FLUSH(deleteRequest())).status).toBe(200);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '-1001',
      text: expect.stringContaining('🗑 Удалён расход'),
    }));
  });

  it('still deletes the expense when Telegram refuses deletion', async () => {
    const { deleteQuery } = mockSupabase({
      id: EXPENSE_ID,
      telegram_chat_id: '-1001',
      telegram_message_id: 42,
    });
    mocks.deleteTelegramMessage.mockRejectedValue(new Error("message can't be deleted"));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await DELETE_AND_FLUSH(deleteRequest());

    expect(response.status).toBe(200);
    expect(deleteQuery.delete).toHaveBeenCalledOnce();
  });

  it('sends payroll payments to Salaries, where a deletion reason is required', async () => {
    const { deleteQuery, rpc } = mockSupabase({ id: EXPENSE_ID, salary_entry_id: 'salary-entry', telegram_chat_id: '-1001', telegram_message_id: 42 });
    const response = await DELETE_AND_FLUSH(deleteRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'SALARY_PAYMENT_IMMUTABLE' });
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteQuery.delete).not.toHaveBeenCalled();
  });

  it('deletes legacy expenses that have no stored Telegram coordinates', async () => {
    const { deleteQuery } = mockSupabase({
      id: EXPENSE_ID,
      telegram_chat_id: null,
      telegram_message_id: null,
    });

    const response = await DELETE_AND_FLUSH(deleteRequest());

    expect(response.status).toBe(200);
    expect(mocks.deleteTelegramMessage).not.toHaveBeenCalled();
    expect(deleteQuery.delete).toHaveBeenCalledOnce();
  });
});

describe('expense creation route', () => {
  const body = { clubId: CLUB_ID, date: '2026-10-01', amount: 50000, category: 'repair', paymentMethod: 'cash', paymentSource: 'game_club', comment: ' Door ' };
  const saved = { id: EXPENSE_ID, club_id: CLUB_ID, date: '2026-10-01', amount: 50000, category: 'repair', payment_method: 'cash', payment_source: 'game_club', comment: 'Door' };

  function mockCreate({ methods = ['cash', 'terminal'], upserted = saved as unknown, existing = null as unknown, insertError = null as { message: string; code?: string } | null } = {}) {
    const clubQuery = queryResult({ enabled_payment_methods: methods, business_day_start_hour: 6 });
    const writeQuery = queryResult(upserted, insertError);
    const existingQuery = queryResult(existing);
    const updateQuery = queryResult(null);
    const expenseQueries = [writeQuery, existingQuery];
    const from = vi.fn((table: string) => {
      if (table === 'clubs') return clubQuery;
      if (table === 'profiles') return queryResult({ full_name: 'Owner' });
      return expenseQueries.shift() ?? updateQuery;
    });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', user_metadata: {} } } }) },
      from,
    });
    return { writeQuery };
  }

  async function create(payload: Record<string, unknown>) {
    const response = await POST(new Request('https://example.test/api/expenses', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }));
    await Promise.all(mocks.afterTasks.splice(0));
    return response;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
    vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB_ID);
    vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-1001');
    mocks.sendTelegramMessage.mockResolvedValue({ result: { chat: { id: -1001 }, message_id: 7 } });
    // 2026-10-15 10:00 in Tashkent (UTC+5); business today is 2026-10-15.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T05:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a date after the club business today', async () => {
    const { writeQuery } = mockCreate();
    const response = await create({ ...body, date: '2026-10-16' });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_REQUEST');
    expect(writeQuery.insert).not.toHaveBeenCalled();
  });

  it('accepts the business today before the day-start hour rolls over', async () => {
    // 2026-10-16 05:00 in Tashkent is still the 2026-10-15 business day (start hour 6).
    vi.setSystemTime(new Date('2026-10-16T00:00:00Z'));
    mockCreate();
    expect((await create({ ...body, date: '2026-10-15' })).status).toBe(201);
    expect((await create({ ...body, date: '2026-10-16' })).status).toBe(400);
  });

  it('rejects an impossible calendar date', async () => {
    const { writeQuery } = mockCreate();
    const response = await create({ ...body, date: '2026-02-30' });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_REQUEST');
    expect(writeQuery.insert).not.toHaveBeenCalled();
  });

  it.each(['22007', '22008'])('maps database date error %s to 400', async (code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCreate({ upserted: null, insertError: { message: 'Expenses cannot use a future business date', code } });
    const response = await create(body);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_REQUEST');
  });

  it('rejects a payment method the club has not enabled', async () => {
    mockCreate({ methods: ['terminal'] });
    const response = await create(body);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('PAYMENT_METHOD_DISABLED');
  });

  it('inserts once for a client id and notifies after the response', async () => {
    const { writeQuery } = mockCreate();
    const response = await create({ ...body, id: EXPENSE_ID });
    expect(response.status).toBe(201);
    expect(writeQuery.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: EXPENSE_ID, comment: 'Door' }), { onConflict: 'id', ignoreDuplicates: true });
    expect(mocks.sendTelegramMessage).toHaveBeenCalledOnce();
  });

  it('returns the saved row for a retried id without notifying again', async () => {
    mockCreate({ upserted: null, existing: saved });
    const response = await create({ ...body, id: EXPENSE_ID });
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(false);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('rejects a reused id with different values', async () => {
    mockCreate({ upserted: null, existing: { ...saved, amount: 1 } });
    expect((await create({ ...body, id: EXPENSE_ID })).status).toBe(409);
  });

  it('links a chosen planned expense and leaves the column out otherwise', async () => {
    const presetId = '9b2f4c1e-3d5a-4e6f-8a7b-1c2d3e4f5a6b';
    const linked = mockCreate();
    expect((await create({ ...body, presetId })).status).toBe(201);
    expect(linked.writeQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ preset_id: presetId }));

    const plain = mockCreate();
    expect((await create({ ...body, presetId: null })).status).toBe(201);
    expect(plain.writeQuery.insert).toHaveBeenCalledWith(expect.not.objectContaining({ preset_id: expect.anything() }));

    const malformed = mockCreate();
    expect((await create({ ...body, presetId: 'electricity' })).status).toBe(400);
    expect(malformed.writeQuery.insert).not.toHaveBeenCalled();
  });

  it('still inserts without a client id', async () => {
    const { writeQuery } = mockCreate();
    expect((await create(body)).status).toBe(201);
    expect(writeQuery.insert).toHaveBeenCalledOnce();
  });

  it('hides database text behind a stable code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCreate({ upserted: null, insertError: { message: 'relation "x" is broken', code: 'XX000' } });
    const response = await create(body);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Expense change failed', code: 'SERVER_ERROR' });
  });

  it('reports an archived or mismatched planned expense with its own code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const presetId = '9b2f4c1e-3d5a-4e6f-8a7b-1c2d3e4f5a6b';
    for (const message of ['Expense preset is not available.', 'Expense does not match its preset.']) {
      mockCreate({ upserted: null, insertError: { message, code: '23514' } });
      const response = await create({ ...body, presetId });
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('PRESET_UNAVAILABLE');
    }
  });
});

describe('expense payment method route', () => {
  const baseExpense = {
    id: EXPENSE_ID, club_id: CLUB_ID, date: '2026-10-24', amount: 8000, category: 'food_drinks',
    payment_method: 'cash', payment_source: 'bar', comment: 'non', created_by: 'user-1',
    salary_entry_id: null as string | null, telegram_chat_id: '-1001' as string | null, telegram_message_id: 42 as number | null,
  };

  function mockPatchSupabase(expense: typeof baseExpense | null, rpcError: { message: string; code?: string } | null = null) {
    const rpc = vi.fn().mockResolvedValue({ error: rpcError });
    const from = vi.fn((table: string) => (
      table === 'clubs' ? queryResult({ enabled_payment_methods: ['cash', 'terminal'] })
        : table === 'profiles' ? queryResult({ full_name: 'Alisher' })
          : queryResult(expense)
    ));
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from,
      rpc,
    });
    return { rpc };
  }

  async function patch(paymentMethod: unknown) {
    const response = await PATCH(new Request('https://example.test/api/expenses', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clubId: CLUB_ID, expenseId: EXPENSE_ID, paymentMethod }),
    }));
    await Promise.all(mocks.afterTasks.splice(0));
    return response;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
    vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB_ID);
    vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-1001');
    mocks.editTelegramMessage.mockResolvedValue(undefined);
  });

  it('changes the method through the RPC and edits the group message', async () => {
    const { rpc } = mockPatchSupabase(baseExpense);
    const response = await patch('terminal');
    expect(response.status).toBe(200);
    expect((await response.json()).expense.payment_method).toBe('terminal');
    expect(rpc).toHaveBeenCalledWith('update_expense_payment_method', {
      p_club_id: CLUB_ID, p_expense_id: EXPENSE_ID, p_payment_method: 'terminal',
    });
    expect(mocks.editTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({ chatId: '-1001', messageId: 42 }));
    // The edit is silent, so the change is also announced.
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '-1001',
      text: expect.stringContaining('Способ оплаты: Наличные → Терминал'),
    }));
  });

  it('rejects unknown and disabled methods', async () => {
    const { rpc } = mockPatchSupabase(baseExpense);
    expect((await patch('dollars')).status).toBe(400);
    const disabled = await patch('card');
    expect((await disabled.json()).code).toBe('PAYMENT_METHOD_DISABLED');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('leaves payroll payments to Salaries', async () => {
    const { rpc } = mockPatchSupabase({ ...baseExpense, salary_entry_id: 'salary-entry' });
    expect((await (await patch('terminal')).json()).code).toBe('SALARY_PAYMENT_IMMUTABLE');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never edits a message outside the club group, nor after a refused write', async () => {
    mockPatchSupabase({ ...baseExpense, telegram_chat_id: '-1009' });
    expect((await patch('terminal')).status).toBe(200);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockPatchSupabase(baseExpense, { message: 'Only a club owner can change an expense.', code: '42501' });
    expect((await patch('terminal')).status).toBe(403);
    expect(mocks.editTelegramMessage).not.toHaveBeenCalled();
  });
  describe('date', () => {
    async function patchBody(body: Record<string, unknown>) {
      const response = await PATCH(new Request('https://example.test/api/expenses', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clubId: CLUB_ID, expenseId: EXPENSE_ID, ...body }),
      }));
      await Promise.all(mocks.afterTasks.splice(0));
      return response;
    }

    beforeEach(() => {
      // 2026-10-25 10:00 in Tashkent: business today is 2026-10-25.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-25T05:00:00Z'));
    });
    afterEach(() => { vi.useRealTimers(); });

    it('moves the expense through the date RPC and edits the group message', async () => {
      const { rpc } = mockPatchSupabase(baseExpense);
      const response = await patchBody({ date: '2026-10-20' });
      expect(response.status).toBe(200);
      expect((await response.json()).expense).toMatchObject({ date: '2026-10-20', payment_method: 'cash' });
      expect(rpc).toHaveBeenCalledOnce();
      expect(rpc).toHaveBeenCalledWith('update_expense_date', { p_club_id: CLUB_ID, p_expense_id: EXPENSE_ID, p_date: '2026-10-20' });
      expect(mocks.editTelegramMessage).toHaveBeenCalledOnce();
      expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({
        text: expect.stringMatching(/✏️ Изменён расход[\s\S]*Дата: 24 октября → 20 октября/),
      }));
    });

    it('changes the method and the date together, and skips unchanged values', async () => {
      const both = mockPatchSupabase(baseExpense);
      expect((await patchBody({ date: '2026-10-20', paymentMethod: 'terminal' })).status).toBe(200);
      expect(both.rpc.mock.calls.map(([name]) => name)).toEqual(['update_expense_payment_method', 'update_expense_date']);
      const same = mockPatchSupabase(baseExpense);
      mocks.sendTelegramMessage.mockClear();
      expect((await patchBody({ date: baseExpense.date })).status).toBe(200);
      expect(same.rpc).not.toHaveBeenCalled();
      expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    });

    it('rejects a future, impossible or missing change', async () => {
      const { rpc } = mockPatchSupabase(baseExpense);
      for (const body of [{ date: '2026-10-26' }, { date: '2026-02-30' }, { date: 20261020 }, {}]) {
        expect((await patchBody(body)).status).toBe(400);
      }
      expect(rpc).not.toHaveBeenCalled();
    });

    it('leaves payroll payments to Salaries', async () => {
      const { rpc } = mockPatchSupabase({ ...baseExpense, salary_entry_id: 'salary-entry' });
      expect((await (await patchBody({ date: '2026-10-20' })).json()).code).toBe('SALARY_PAYMENT_IMMUTABLE');
      expect(rpc).not.toHaveBeenCalled();
    });
  });
});
