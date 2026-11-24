import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityAuditRow } from './activityNotification';

const mocks = vi.hoisted(() => ({ sendTelegramMessage: vi.fn() }));
vi.mock('./sendDailyFinanceReport', async () => {
  const actual = await vi.importActual<typeof import('./sendDailyFinanceReport')>('./sendDailyFinanceReport');
  return { TelegramSendError: actual.TelegramSendError, sendTelegramMessage: mocks.sendTelegramMessage };
});

import { deliverActivityNotices, expireActivityNotices, loadActivityLookups } from './activityDelivery';
import { TelegramSendError } from './sendDailyFinanceReport';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const OWNER = 'user-owner';

type Result = { data: unknown; error: { message: string; code?: string } | null };

let nextId = 1;
function log(table: string, action: ActivityAuditRow['action'], oldRow: Record<string, unknown> | null, newRow: Record<string, unknown> | null, rowId = 'row-1'): ActivityAuditRow {
  return {
    id: nextId++, club_id: CLUB, table_name: table, row_id: rowId, action, old_row: oldRow, new_row: newRow,
    changed_by: OWNER, changed_at: '2026-11-24T10:00:00Z', changed_on: '2026-11-24',
  };
}

/** A stand-in client: `rpc` answers the claims in turn, `from` records filters and answers per table. */
function fakeClient(claims: Result[], tables: Record<string, Result> = {}) {
  const calls: Array<{ table: string; filters: Array<[string, ...unknown[]]> }> = [];
  const rpc = vi.fn((name: string, args?: { p_ids?: number[] }) => {
    if (name === 'release_activity_notices') return Promise.resolve({ data: args?.p_ids?.length ?? 0, error: null });
    return Promise.resolve(claims.shift() ?? { data: [], error: null });
  });
  const from = (table: string) => {
    const entry = { table, filters: [] as Array<[string, ...unknown[]]> };
    calls.push(entry);
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in']) {
      builder[method] = (...args: unknown[]) => { entry.filters.push([method, ...args]); return builder; };
    }
    builder.then = (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(tables[table] ?? { data: [], error: null }).then(resolve, reject);
    return builder;
  };
  return { client: { rpc, from } as unknown as SupabaseClient, rpc, calls };
}

const product = { id: 'prod-1', name: 'Cola', category: null, sale_price: 12000, cost_price: 8000, is_active: true, is_deleted: false, current_stock: 0 };

describe('deliverActivityNotices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'token');
    vi.stubEnv('TELEGRAM_PIXEL_CLUB_ID', CLUB);
    vi.stubEnv('TELEGRAM_PIXEL_CHAT_ID', '-1001');
    vi.stubEnv('TELEGRAM_PIXEL_OWNER_CHAT_ID', '-2002');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.sendTelegramMessage.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('claims nothing when the club has no group or there is no bot', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    const first = fakeClient([]);
    expect(await deliverActivityNotices(first.client, CLUB)).toEqual({ claimed: 0, sent: 0, failed: 0, unrouted: 0, released: 0 });
    expect(first.rpc).not.toHaveBeenCalled();

    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'token');
    const second = fakeClient([]);
    await deliverActivityNotices(second.client, '11111111-2222-4333-8444-555555555555');
    expect(second.rpc).not.toHaveBeenCalled();
  });

  it('claims the club’s rows, names them, and sends oldest first to the right group', async () => {
    const rows = [
      log('products', 'insert', null, product, 'prod-1'),
      log('cash_shortages', 'delete', { id: 's1', date: '2026-11-20', payment_source: 'bar', payment_method: 'cash', amount: 5000, comment: null }, null, 's1'),
      log('stock_purchases', 'insert', null, { id: 'pu1', product_id: 'prod-1', quantity: 2, cost_price: 8000, payment_method: 'cash', date: '2026-11-24' }, 'pu1'),
    ];
    const { client, rpc, calls } = fakeClient([{ data: rows, error: null }], {
      profiles: { data: [{ id: OWNER, full_name: ' Jasur ' }], error: null },
      products: { data: [{ id: 'prod-1', name: 'Cola' }], error: null },
    });

    expect(await deliverActivityNotices(client, CLUB)).toEqual({ claimed: 3, sent: 3, failed: 0, unrouted: 0, released: 0 });
    expect(rpc).toHaveBeenCalledWith('claim_activity_notices', { p_club_id: CLUB, p_limit: 50 });
    expect(mocks.sendTelegramMessage.mock.calls.map(([options]) => [options.chatId, options.text.split('\n')[0]])).toEqual([
      ['-1001', '🆕 Новый товар бара: Cola'],
      ['-2002', '🗑 Удалена недостача: 5 000 сум'],
      ['-1001', '📦 Закупка бара: 16 000 сум'],
    ]);
    expect(mocks.sendTelegramMessage.mock.calls[0][0]).toMatchObject({ botToken: 'token', text: expect.stringMatching(/\nJasur$/) });
    expect(calls.find((call) => call.table === 'products')?.filters).toContainEqual(['eq', 'club_id', CLUB]);
  });

  it('counts a shortage notice with no owners’ group, never sending it to the club group', async () => {
    vi.stubEnv('TELEGRAM_PIXEL_OWNER_CHAT_ID', '');
    const { client } = fakeClient([{
      data: [log('cash_shortages', 'delete', { id: 's1', date: '2026-11-20', payment_source: 'bar', payment_method: 'cash', amount: 5000 }, null)],
      error: null,
    }]);
    expect(await deliverActivityNotices(client, CLUB)).toEqual({ claimed: 1, sent: 0, failed: 0, unrouted: 1, released: 0 });
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('stops at a rate limit and gives the unsent rows, the refused one included, back to pending', async () => {
    mocks.sendTelegramMessage
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new TelegramSendError('Too Many Requests', [], true))
      .mockResolvedValue({});
    const rows = [1, 2, 3].map((n) => log('products', 'insert', null, { ...product, id: `prod-${n}`, name: `P${n}` }, `prod-${n}`));
    const { client, rpc } = fakeClient([{ data: rows, error: null }]);
    expect(await deliverActivityNotices(client, CLUB)).toEqual({ claimed: 3, sent: 1, failed: 0, unrouted: 0, released: 2 });
    expect(mocks.sendTelegramMessage).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('release_activity_notices', { p_club_id: CLUB, p_ids: [rows[1].id, rows[2].id] });
    expect(console.error).toHaveBeenCalledWith('[telegram/activity] notice failed', expect.objectContaining({ error: 'Too Many Requests' }));
  });

  it('never sends twice a message Telegram may have taken, but still gives back the rest', async () => {
    mocks.sendTelegramMessage.mockRejectedValueOnce(new TelegramSendError('outcome is unknown', [], false, true));
    const rows = [log('products', 'insert', null, product, 'prod-1'), log('products', 'insert', null, { ...product, id: 'prod-2' }, 'prod-2')];
    const { client, rpc } = fakeClient([{ data: rows, error: null }]);
    expect(await deliverActivityNotices(client, CLUB)).toEqual({ claimed: 2, sent: 0, failed: 1, unrouted: 0, released: 1 });
    expect(rpc).toHaveBeenCalledWith('release_activity_notices', { p_club_id: CLUB, p_ids: [rows[1].id] });
  });

  it('gives a whole round back when its messages cannot be built, and logs a failed release', async () => {
    const count = { product_id: 'prod-1', date: '2026-11-23', closing_stock: 5 };
    const rows = [log('daily_stock_counts', 'update', count, { ...count, closing_stock: 4 })];
    const { client, rpc } = fakeClient([{ data: rows, error: null }]);
    (client as unknown as { from: () => never }).from = () => { throw new Error('boom'); };
    rpc.mockImplementation((name: string) => Promise.resolve(name === 'release_activity_notices'
      ? { data: null, error: { message: 'down' } }
      : { data: rows, error: null }));
    expect(await deliverActivityNotices(client, CLUB)).toMatchObject({ claimed: 1, sent: 0, released: 0 });
    expect(console.error).toHaveBeenCalledWith('[telegram/activity] delivery failed', { clubId: CLUB, error: 'boom' });
    expect(console.error).toHaveBeenCalledWith('[telegram/activity] release failed', expect.objectContaining({ logIds: [rows[0].id] }));
  });

  it('logs a failed claim and sends nothing', async () => {
    const { client } = fakeClient([{ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }]);
    expect(await deliverActivityNotices(client, CLUB)).toEqual({ claimed: 0, sent: 0, failed: 0, unrouted: 0, released: 0 });
    expect(console.error).toHaveBeenCalledWith('[telegram/activity] claim failed', expect.objectContaining({ code: 'PGRST202' }));
  });

  it('claims further rounds while they come back full, up to the round limit', async () => {
    const full = () => ({ data: [log('products', 'insert', null, product), log('products', 'insert', null, product)], error: null });
    const { client, rpc } = fakeClient([full(), full(), full()]);
    expect((await deliverActivityNotices(client, CLUB, { batchSize: 2, maxBatches: 2 })).claimed).toBe(4);
    expect(rpc).toHaveBeenCalledTimes(2);

    const short = fakeClient([full(), { data: [log('products', 'insert', null, product)], error: null }, full()]);
    expect((await deliverActivityNotices(short.client, CLUB, { batchSize: 2 })).claimed).toBe(3);
    expect(short.rpc).toHaveBeenCalledTimes(2);
  });

  it('holds every send to its deadline and claims no new round after it', async () => {
    let clock = 1_000;
    const { client, rpc } = fakeClient([
      { data: [log('products', 'insert', null, product), log('products', 'insert', null, product)], error: null },
    ]);
    mocks.sendTelegramMessage.mockImplementation(async () => { clock += 600; return {}; });
    const result = await deliverActivityNotices(client, CLUB, { batchSize: 2, deadlineAt: 2_000, now: () => clock });
    expect(result).toMatchObject({ claimed: 2, sent: 2 });
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({ deadlineAt: 2_000 }));
    expect(rpc).toHaveBeenCalledTimes(1);

    const late = fakeClient([]);
    await deliverActivityNotices(late.client, CLUB, { deadlineAt: 0, now: () => 1 });
    expect(late.rpc).not.toHaveBeenCalled();
  });
});

describe('expireActivityNotices', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('drops every club’s stale notices, and never throws', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: 4, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'denied' } })
      .mockRejectedValueOnce(new Error('offline'));
    const client = { rpc } as unknown as SupabaseClient;
    expect(await expireActivityNotices(client)).toBe(4);
    expect(rpc).toHaveBeenCalledWith('expire_activity_notices');
    expect(await expireActivityNotices(client)).toBe(0);
    expect(await expireActivityNotices(client)).toBe(0);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe('loadActivityLookups', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('reads only the names the rows mention, scoped to the club', async () => {
    const rows = [
      log('club_memberships', 'insert', null, { user_id: 'user-new', role: 'viewer' }, 'user-new'),
      log('salary_entries', 'insert', null, { employee_id: 'emp-1', cash_shortage_id: 'short-1' }),
      log('debt_payments', 'insert', null, { debt_id: 'debt-1' }),
    ];
    const { client, calls } = fakeClient([], {
      profiles: { data: [{ id: OWNER, full_name: 'Jasur' }, { id: 'user-new', full_name: null }], error: null },
      salary_employees: { data: [{ id: 'emp-1', name: 'Izzat' }], error: null },
      new_debts: { data: [{ id: 'debt-1', person_name: 'Bekzod' }], error: null },
      cash_shortages: { data: [{ id: 'short-1', amount: '50000', date: '2026-11-20', created_at: '2026-11-20T10:00:00Z' }], error: null },
    });
    const lookups = await loadActivityLookups(client, CLUB, rows);
    expect(lookups.people).toEqual(new Map([[OWNER, 'Jasur'], ['user-new', '']]));
    expect(lookups.employees.get('emp-1')).toBe('Izzat');
    expect(lookups.debts.get('debt-1')).toBe('Bekzod');
    expect(lookups.shortages.get('short-1')).toEqual({ amount: 50000, date: '2026-11-20', created_at: '2026-11-20T10:00:00Z' });
    expect(calls.some((call) => call.table === 'products')).toBe(false);
    for (const table of ['salary_employees', 'new_debts', 'cash_shortages']) {
      expect(calls.find((call) => call.table === table)?.filters).toContainEqual(['eq', 'club_id', CLUB]);
    }
  });

  it('leaves names out when a read fails', async () => {
    const { client } = fakeClient([], {
      profiles: { data: null, error: { message: 'down' } },
      products: { data: null, error: { message: 'down' } },
    });
    const lookups = await loadActivityLookups(client, CLUB, [log('daily_stock_counts', 'update', { product_id: 'prod-1' }, { product_id: 'prod-1' })]);
    expect(lookups.people.size).toBe(0);
    expect(lookups.products.size).toBe(0);
    expect(console.error).toHaveBeenCalledWith('[telegram/activity] lookup failed', expect.objectContaining({ table: 'products' }));
    expect(console.error).toHaveBeenCalledWith('[telegram/activity] lookup failed', expect.objectContaining({ table: 'profiles' }));
  });
});
