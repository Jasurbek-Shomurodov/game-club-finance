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

import { DELETE } from './route';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const ENTRY = '40c05af5-5a59-45ae-a891-19a18228a721';
const entry = { date: '2026-10-24', cash_income: 2_134_000, terminal_income: 0, card_income: 0, playstation_income: 0 };

function mockSupabase({ found = entry as typeof entry | null, deleted = [{ id: ENTRY }], user = { id: 'u1', email: 'o@example.test', user_metadata: {} } as object | null } = {}) {
  const deleteSpy = vi.fn();
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    let deleting = false;
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.delete = () => { deleting = true; deleteSpy(); return builder; };
    builder.maybeSingle = () => Promise.resolve({ data: table === 'profiles' ? { full_name: 'Alisher' } : found, error: null });
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: deleting ? deleted : null, error: null }).then(resolve);
    return builder;
  });
  mocks.createClient.mockResolvedValue({ auth: { getUser: () => Promise.resolve({ data: { user } }) }, from });
  return { deleteSpy };
}

async function call(body: unknown) {
  const response = await DELETE(new Request('https://example.test/api/daily-cash', {
    method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  await Promise.all(mocks.afterTasks.splice(0));
  return response;
}

describe('DELETE /api/daily-cash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'token');
    vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB);
    vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-1001');
    mocks.sendTelegramMessage.mockResolvedValue({});
  });

  it('deletes the entry as the user and tells the club group', async () => {
    const { deleteSpy } = mockSupabase();
    expect((await call({ clubId: CLUB, entryId: ENTRY })).status).toBe(200);
    expect(deleteSpy).toHaveBeenCalledOnce();
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '-1001',
      text: expect.stringMatching(/🗑 Удалена выручка клуба[\s\S]*Наличные: 2 134 000 сум[\s\S]*Удалил\(а\): Alisher/),
    }));
  });

  it('sends nothing when RLS refused the delete or the entry is missing', async () => {
    mockSupabase({ deleted: [] });
    expect((await call({ clubId: CLUB, entryId: ENTRY })).status).toBe(404);
    mockSupabase({ found: null });
    expect((await call({ clubId: CLUB, entryId: ENTRY })).status).toBe(404);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('rejects a signed-out user and a malformed request', async () => {
    mockSupabase({ user: null });
    expect((await call({ clubId: CLUB, entryId: ENTRY })).status).toBe(401);
    const { deleteSpy } = mockSupabase();
    expect((await call({ clubId: CLUB, entryId: 'x' })).status).toBe(400);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});
