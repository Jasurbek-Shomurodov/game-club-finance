import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  deleteTelegramMessage: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/telegram/deleteTelegramMessage', () => ({
  deleteTelegramMessage: mocks.deleteTelegramMessage,
}));
vi.mock('@/lib/telegram/expenseNotification', () => ({
  buildExpenseNotification: vi.fn(),
}));
vi.mock('@/lib/telegram/sendDailyFinanceReport', () => ({
  sendTelegramMessage: vi.fn(),
}));
vi.mock('@/types', () => ({ PAYMENT_METHODS: ['cash', 'terminal', 'card'] }));

import { DELETE } from './route';

const CLUB_ID = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const EXPENSE_ID = '40c05af5-5a59-45ae-a891-19a18228a721';

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
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    then: (resolve: (value: { data: T; error: { message: string } | null }) => unknown) => (
      Promise.resolve({ data, error }).then(resolve)
    ),
  };
  builder.select.mockReturnValue(builder);
  builder.delete.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({ data, error });
  return builder;
}

function mockSupabase(expense: {
  id: string;
  salary_entry_id?: string;
  telegram_chat_id: string | null;
  telegram_message_id: number | null;
}) {
  const membershipQuery = queryResult({ role: 'owner' });
  const expenseQuery = queryResult(expense);
  const deleteQuery = queryResult(null);
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
    mocks.deleteTelegramMessage.mockResolvedValue(undefined);
  });

  it('deletes the Telegram notification before deleting the expense', async () => {
    const { deleteQuery } = mockSupabase({
      id: EXPENSE_ID,
      telegram_chat_id: '-1001',
      telegram_message_id: 42,
    });

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(mocks.deleteTelegramMessage).toHaveBeenCalledWith({
      botToken: 'bot-token',
      chatId: '-1001',
      messageId: 42,
    });
    expect(deleteQuery.delete).toHaveBeenCalledOnce();
    expect(mocks.deleteTelegramMessage.mock.invocationCallOrder[0]).toBeLessThan(
      deleteQuery.delete.mock.invocationCallOrder[0],
    );
  });

  it('still deletes the expense when Telegram refuses deletion', async () => {
    const { deleteQuery } = mockSupabase({
      id: EXPENSE_ID,
      telegram_chat_id: '-1001',
      telegram_message_id: 42,
    });
    mocks.deleteTelegramMessage.mockRejectedValue(new Error("message can't be deleted"));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(deleteQuery.delete).toHaveBeenCalledOnce();
  });

  it('deletes payroll payments through the audited salary RPC', async () => {
    const { deleteQuery, rpc } = mockSupabase({ id: EXPENSE_ID, salary_entry_id: 'salary-entry', telegram_chat_id: '-1001', telegram_message_id: 42 });
    const response = await DELETE(deleteRequest());
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('delete_salary_record', { p_club_id: CLUB_ID, p_id: 'salary-entry', p_kind: 'entry' });
    expect(deleteQuery.delete).not.toHaveBeenCalled();
  });

  it('deletes legacy expenses that have no stored Telegram coordinates', async () => {
    const { deleteQuery } = mockSupabase({
      id: EXPENSE_ID,
      telegram_chat_id: null,
      telegram_message_id: null,
    });

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(mocks.deleteTelegramMessage).not.toHaveBeenCalled();
    expect(deleteQuery.delete).toHaveBeenCalledOnce();
  });
});
