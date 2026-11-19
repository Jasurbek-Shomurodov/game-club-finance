import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  sendTelegramMessage: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
// after() needs a live request scope; run the task immediately and let tests await it.
vi.mock('next/server', () => ({ after: (task: () => unknown) => { mocks.afterTasks.push(Promise.resolve().then(task)); } }));
vi.mock('@/lib/telegram/sendDailyFinanceReport', async (importOriginal) => ({ ...await importOriginal<object>(), sendTelegramMessage: mocks.sendTelegramMessage }));

import { DELETE, PATCH } from './route';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const ENTRY = '40c05af5-5a59-45ae-a891-19a18228a721';
const entry = { date: '2026-10-24', cash_income: 2_134_000, terminal_income: 0, card_income: 0, playstation_income: 0 };

function mockSupabase({ found = entry as typeof entry | null, deleted = [{ id: ENTRY }], deleteError = null as { message: string; hint?: string } | null, user = { id: 'u1', email: 'o@example.test', user_metadata: {} } as object | null } = {}) {
  const deleteSpy = vi.fn();
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    let deleting = false;
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.delete = () => { deleting = true; deleteSpy(); return builder; };
    builder.maybeSingle = () => Promise.resolve({ data: table === 'profiles' ? { full_name: 'Alisher' } : found, error: null });
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: deleting && !deleteError ? deleted : null, error: deleting ? deleteError : null }).then(resolve);
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
      text: expect.stringMatching(/🗑 Удалена выручка: [\s\S]*Наличные 2 134 000[\s\S]*Удалил\(а\) Alisher/),
    }));
  });

  it('sends nothing when RLS refused the delete or the entry is missing', async () => {
    mockSupabase({ deleted: [] });
    expect((await call({ clubId: CLUB, entryId: ENTRY })).status).toBe(404);
    mockSupabase({ found: null });
    expect((await call({ clubId: CLUB, entryId: ENTRY })).status).toBe(404);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('tells a closed day from a server fault and sends nothing for either', async () => {
    mockSupabase({ deleteError: { message: 'this day is closed.', hint: 'day_collected' } });
    expect((await call({ clubId: CLUB, entryId: ENTRY })).status).toBe(409);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSupabase({ deleteError: { message: 'connection lost' } });
    expect((await call({ clubId: CLUB, entryId: ENTRY })).status).toBe(500);
    consoleError.mockRestore();
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

describe('PATCH /api/daily-cash', () => {
  const stored = { ...entry, comment: null as string | null };
  const edit = { clubId: CLUB, entryId: ENTRY, date: entry.date, cashIncome: 2_234_000, terminalIncome: 0, cardIncome: 0, playstationIncome: 0, comment: null };

  function mockUpdate({ updated = [{ id: ENTRY }], updateError = null as { message: string; code?: string; hint?: string } | null, found = stored as typeof stored | null } = {}) {
    const updateSpy = vi.fn();
    const from = vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      let updating = false;
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.update = (values: unknown) => { updating = true; updateSpy(values); return builder; };
      builder.maybeSingle = () => Promise.resolve({
        data: table === 'profiles' ? { full_name: 'Alisher' } : table === 'clubs' ? { business_day_start_hour: 0 } : found,
        error: null,
      });
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: updating && !updateError ? updated : null, error: updating ? updateError : null }).then(resolve);
      return builder;
    });
    mocks.createClient.mockResolvedValue({ auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1', email: 'o@example.test', user_metadata: {} } } }) }, from });
    return { updateSpy };
  }

  async function patch(body: unknown) {
    const response = await PATCH(new Request('https://example.test/api/daily-cash', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }));
    await Promise.all(mocks.afterTasks.splice(0));
    return response;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'token');
    vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', CLUB);
    vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '-1001');
    mocks.sendTelegramMessage.mockResolvedValue({});
  });

  it('saves the correction as the user and tells the club group what changed', async () => {
    const { updateSpy } = mockUpdate();
    expect((await patch(edit)).status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ cash_income: 2_234_000, date: entry.date }));
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '-1001',
      text: expect.stringMatching(/✏️ Изменена выручка: 2 234 000 сум[\s\S]*Наличные: 2 134 000 → 2 234 000[\s\S]*Изменил\(а\) Alisher/),
    }));
  });

  it('posts nothing when the save changed nothing', async () => {
    mockUpdate();
    expect((await patch({ ...edit, cashIncome: entry.cash_income })).status).toBe(200);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('sends nothing when RLS refused the edit or the database rejected it', async () => {
    mockUpdate({ updated: [] });
    expect((await patch(edit)).status).toBe(404);
    mockUpdate({ updateError: { message: 'this day is closed.', hint: 'day_collected' } });
    expect(await (await patch(edit)).json()).toEqual({ code: 'DAY_COLLECTED' });
    mockUpdate({ updateError: { message: 'duplicate key', code: '23505' } });
    expect(await (await patch(edit)).json()).toEqual({ code: 'DUPLICATE_DATE' });
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('rejects malformed amounts, dates and future days before writing', async () => {
    const { updateSpy } = mockUpdate();
    expect((await patch({ ...edit, cashIncome: -1 })).status).toBe(400);
    expect((await patch({ ...edit, date: '24.10.2026' })).status).toBe(400);
    expect((await patch({ ...edit, date: '2999-01-01' })).status).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
