import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExpenseRow } from '../calculations/dashboardMetrics';
import {
  buildDailyFinanceTelegramReport,
  dailyReportRunDateIso,
  DAILY_REPORT_UTC_HOUR,
  getClubBusinessDayStartHour,
  getEnabledPaymentMethods,
  getLowStockProductRows,
  getPromoGiveawayRows,
  getReportMoneyChecks,
  nextDailyReportBusinessDateIso,
  sendTelegramMessage,
  sendTelegramPhoto,
  sendTelegramPhotoAlbum,
  TELEGRAM_CAPTION_MAX_LENGTH,
  TELEGRAM_MESSAGE_MAX_LENGTH,
  truncateTelegramText,
} from './sendDailyFinanceReport';

vi.mock('./dailyFinanceReportImage', () => ({
  renderDailyFinanceReportPng: vi.fn().mockResolvedValue(null),
  renderMonthlyFinanceReportPng: vi.fn().mockResolvedValue(null),
  renderForecastReportPng: vi.fn().mockResolvedValue(null),
}));

type RecordedQuery = { table: string; select?: string; filters: string[] };

function recordingClient(
  clubRow: Record<string, unknown> | null,
  clubError: unknown = null,
  /** Rows every read of a table returns; none by default. */
  tableRows: Record<string, unknown[]> = {},
  /** What each RPC answers; an empty list by default. */
  rpcResults: Record<string, { data: unknown; error: unknown }> = {},
  /** An error for the reads it matches; none by default. */
  readError: (query: RecordedQuery) => unknown = () => null,
) {
  const queries: RecordedQuery[] = [];
  const client = {
    from: (table: string) => {
      const recorded: RecordedQuery = { table, filters: [] };
      queries.push(recorded);
      const query = {
        select: (columns: string) => { recorded.select = columns; return query; },
        eq: (column: string, value: unknown) => { recorded.filters.push(`${column}=${value}`); return query; },
        gte: (column: string, value: unknown) => { recorded.filters.push(`${column}>=${value}`); return query; },
        lte: (column: string, value: unknown) => { recorded.filters.push(`${column}<=${value}`); return query; },
        gt: (column: string, value: unknown) => { recorded.filters.push(`${column}>${value}`); return query; },
        neq: (column: string, value: unknown) => { recorded.filters.push(`${column}!=${value}`); return query; },
        in: (column: string, values: unknown[]) => { recorded.filters.push(`${column} in ${values.join('|')}`); return query; },
        or: (filter: string) => { recorded.filters.push(`or(${filter})`); return query; },
        order: () => query,
        range: async () => {
          const error = readError(recorded);
          return error ? { data: null, error } : { data: tableRows[table] ?? [], error: null };
        },
        single: async () => ({ data: clubRow, error: clubError }),
      };
      return query;
    },
    // The reserve's moves (156) and collected money (169): none unless a test says so.
    rpc: async (name: string) => rpcResults[name] ?? { data: [], error: null },
  } as unknown as SupabaseClient;
  return { client, queries };
}

describe('dailyReportRunDateIso', () => {
  it.each([
    [6, '2026-11-24'],
    [8, '2026-11-24'],
    [9, '2026-11-25'],
    [10, '2026-11-25'],
  ])('dates the run carrying a business day that starts at %i:00', (startHour, runDate) => {
    expect(dailyReportRunDateIso('2026-11-23', startHour)).toBe(runDate);
  });

  it('crosses month and year ends', () => {
    expect(dailyReportRunDateIso('2026-12-31', 0)).toBe('2027-01-01');
    expect(dailyReportRunDateIso('2026-02-28', 10)).toBe('2026-03-02');
  });

  it('is the inverse of nextDailyReportBusinessDateIso', () => {
    for (const startHour of [0, 6, 8, 9, 10, 23]) {
      const runDate = dailyReportRunDateIso('2026-11-23', startHour);
      const [year, month, day] = runDate.split('-').map(Number);
      // Just before the run and at the run, that day's report carries the business date.
      for (const hour of [0, DAILY_REPORT_UTC_HOUR]) {
        expect(nextDailyReportBusinessDateIso(new Date(Date.UTC(year, month - 1, day, hour)), startHour)).toBe('2026-11-23');
      }
    }
  });
});

describe('getClubBusinessDayStartHour', () => {
  it('reads the club start hour and falls back to midnight before migration 019', async () => {
    await expect(getClubBusinessDayStartHour(recordingClient({ business_day_start_hour: 6 }).client, 'club'))
      .resolves.toBe(6);
    await expect(getClubBusinessDayStartHour(recordingClient(null, {
      code: '42703',
      message: 'column clubs.business_day_start_hour does not exist',
    }).client, 'club')).resolves.toBe(0);
    await expect(getClubBusinessDayStartHour(recordingClient(null, {
      code: '42501',
      message: 'permission denied',
    }).client, 'club')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('getEnabledPaymentMethods', () => {
  it('reads the club methods and shows every method when they cannot be read', async () => {
    const { client, queries } = recordingClient({ enabled_payment_methods: ['card', 'cash'] });
    await expect(getEnabledPaymentMethods(client, 'club')).resolves.toEqual(['cash', 'card']);
    expect(queries).toEqual([{ table: 'clubs', select: 'enabled_payment_methods', filters: ['id=club'] }]);

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(getEnabledPaymentMethods(recordingClient(null, {
      code: '42703',
      message: 'column clubs.enabled_payment_methods does not exist',
    }).client, 'club')).resolves.toEqual(['terminal', 'cash', 'card']);
    errorSpy.mockRestore();
  });
});

describe('buildDailyFinanceTelegramReport', () => {
  it('reads stock-count history and later debt payments for an as-of report', async () => {
    const { client, queries } = recordingClient({ id: 'club', name: 'Pixel' });

    await buildDailyFinanceTelegramReport(client, {
      businessDate: '2026-09-03',
      chatId: '-1001',
      clubId: 'club',
    });

    const inventory = queries.filter((query) =>
      query.table === 'daily_stock_counts' && query.select?.includes('closing_stock'));
    // Eight weeks back for the money checks' usual weekday income (before the comparison window).
    expect(inventory).toEqual([expect.objectContaining({
      filters: ['club_id=club', 'date>=2026-07-09', 'date<=2026-09-03'],
    })]);
    expect(queries).toContainEqual(expect.objectContaining({
      table: 'daily_cash_entries',
      filters: ['club_id=club', 'date>=2026-07-09', 'date<=2026-09-03'],
    }));
    expect(queries).toContainEqual(expect.objectContaining({
      table: 'expenses',
      filters: ['club_id=club', 'date>=2026-08-01', 'date<=2026-09-03'],
    }));
    expect(queries).toContainEqual(expect.objectContaining({
      table: 'debt_payments',
      select: 'id,debt_id,date,amount',
      filters: ['club_id=club', 'date>2026-09-03'],
    }));
    // Each ledger is read once over the comparison window, never per period.
    for (const table of ['daily_cash_entries', 'daily_stock_counts', 'stock_purchases', 'expenses']) {
      // The giveaway and write-off sections read only the report date, separately.
      // The reserve's own reads (all its history) are not ledger reads either.
      const ledgerReads = queries.filter((query) => query.table === table
        && !query.select?.includes('giveaway_quantity') && !query.select?.includes('adjustment_reason')
        && !query.filters.includes('payment_method=usd') && !query.filters.some((filter) => filter.startsWith('or(')));
      expect(ledgerReads, table).toHaveLength(1);
    }
    // The debt ledger is bounded: window debts plus open ones, never all history.
    const debts = queries.filter((query) => query.table === 'new_debts');
    expect(debts.map((query) => query.filters)).toEqual([
      ['club_id=club', 'date<=2026-09-03', 'date>=2026-08-01'],
      ['club_id=club', 'date<=2026-09-03', 'status!=paid'],
    ]);
    // The day's payment section reads the club's own enabled methods.
    expect(queries).toContainEqual({ table: 'clubs', select: 'enabled_payment_methods', filters: ['id=club'] });
    expect(queries.every((query) => query.filters.includes('club_id=club') || query.filters.includes('id=club')))
      .toBe(true);
  });
});

describe('buildDailyFinanceTelegramReport where the money is', () => {
  const collectedMoves = [{
    kind: 'collect', id: 'c1', date: '2026-09-02', method: 'cash', amount: 400_000,
    comment: null, created_by: 'u', created_at: '2026-09-02T10:00:00Z',
  }];
  const tableRows = {
    daily_cash_entries: [{ date: '2026-09-03', cash_income: 1_000_000, terminal_income: 0, card_income: 0, playstation_income: 0 }],
    owner_reserve_entries: [{
      id: 'r1', club_id: 'club', kind: 'deposit', period_month: '2026-09-01', source: 'bar', payment_method: null,
      amount: 500_000, comment: null, collection_date: null, entry_date: '2026-09-02', created_by: 'u', created_at: '2026-09-02T10:00:00Z',
    }],
  };

  it('opens the caption with the till, collected money, the reserve and their total', async () => {
    const { client, queries } = recordingClient({ id: 'club', name: 'Pixel' }, null, tableRows, {
      get_collected_money_moves: { data: collectedMoves, error: null },
    });
    const report = await buildDailyFinanceTelegramReport(client, { businessDate: '2026-09-03', chatId: '-1001', clubId: 'club' });

    expect(report.caption.split('\n')).toEqual([
      '👛 У администратора: 600 000 UZS',
      '💼 Собрано: 400 000 UZS',
      '🏦 В резерве: 500 000 UZS',
      '💰 Всего денег: 1 500 000 UZS',
      '📈 Инвестировано за месяц: 0 UZS',
    ]);
    expect(report.caption).not.toMatch(/Ежедневный финансовый отчёт|Рабочий день|Заканчивается/);
    expect(report.caption.length).toBeLessThanOrEqual(TELEGRAM_CAPTION_MAX_LENGTH);
    // The full text report keeps its own header.
    expect(report.message.split('\n')[0]).toBe('📊 Ежедневный финансовый отчёт');
    // The reserve is read from its ledgers, scoped to the club.
    expect(queries).toContainEqual(expect.objectContaining({ table: 'owner_reserve_entries', filters: ['club_id=club'] }));
  });

  it('still builds the report, without those lines, when collected money cannot be read', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = recordingClient({ id: 'club', name: 'Pixel' }, null, tableRows, {
      get_collected_money_moves: { data: null, error: { code: '42501', message: 'permission denied' } },
    });
    const report = await buildDailyFinanceTelegramReport(client, { businessDate: '2026-09-03', chatId: '-1001', clubId: 'club' });

    expect(report.caption).not.toMatch(/У администратора|Собрано|В резерве|Всего денег/);
    expect(report.message).toContain('📊 Ежедневный финансовый отчёт');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('money whereabouts unavailable'), expect.anything());
    errorSpy.mockRestore();
  });

  // The reserve must be right or absent: a read the Reserve page would shrug off drops the lines here.
  const denied = { code: '42501', message: 'permission denied' };
  it.each([
    ['its purchases cannot be read', (query: RecordedQuery) => (
      query.table === 'expenses' && query.filters.some((filter) => filter.startsWith('or(')) ? denied : null)],
    ['its dollar expenses cannot be read', (query: RecordedQuery) => (
      query.table === 'expenses' && query.filters.includes('payment_method=usd') ? denied : null)],
    ['the database has no reserve yet (136)', (query: RecordedQuery) => (
      query.table === 'owner_reserve_entries'
        ? { code: '42P01', message: 'relation "public.owner_reserve_entries" does not exist' }
        : null)],
  ])('leaves the money lines out when %s', async (_case, readError) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = recordingClient({ id: 'club', name: 'Pixel' }, null, tableRows, {
      get_collected_money_moves: { data: collectedMoves, error: null },
    }, readError);
    const report = await buildDailyFinanceTelegramReport(client, { businessDate: '2026-09-03', chatId: '-1001', clubId: 'club' });

    expect(report.caption).not.toMatch(/У администратора|Собрано|В резерве|Всего денег/);
    expect(report.message).toContain('📊 Ежедневный финансовый отчёт');
    errorSpy.mockRestore();
  });
});

describe('buildDailyFinanceTelegramReport income window', () => {
  it('keeps the comparison window when the report date is late enough in the month', async () => {
    const { client, queries } = recordingClient({ id: 'club', name: 'Pixel' });
    await buildDailyFinanceTelegramReport(client, { businessDate: '2026-09-30', chatId: '-1001', clubId: 'club' });
    const cash = queries.find((query) => query.table === 'daily_cash_entries');
    expect(cash?.filters).toEqual(['club_id=club', 'date>=2026-08-01', 'date<=2026-09-30']);
  });
});

describe('getReportMoneyChecks', () => {
  const cash = (date: string, amount: number) => ({ date, cash_income: amount, terminal_income: 0, card_income: 0 });
  // Five earlier Thursdays at 1 000 000, then a Thursday at 200 000.
  const history = ['2026-08-06', '2026-08-13', '2026-08-20', '2026-08-27', '2026-09-03'].map((date) => cash(date, 1_000_000));
  const expense = (id: string): ExpenseRow => ({
    id, date: '2026-09-10', amount: 50_000, category: 'supplies', payment_source: 'game_club', payment_method: 'cash',
    comment: null, created_at: '2026-09-10T10:00:00Z',
  });
  const base = {
    businessDate: '2026-09-10',
    stockRows: [],
    expenseRows: [expense('a'), expense('b'), { ...expense('c'), date: '2026-09-09' }],
  };

  it('flags the closed report date: a duplicate that day and a low day with an entry', () => {
    const checks = getReportMoneyChecks({
      ...base,
      currentBusinessDate: '2026-09-11',
      cashRows: [...history, cash('2026-09-10', 200_000)],
    });
    expect(checks?.map((check) => [check.kind, check.date])).toEqual([
      ['duplicate_expense', '2026-09-10'],
      ['low_income_day', '2026-09-10'],
    ]);
  });

  it('judges no low day for a day still in progress or without a daily-cash entry', () => {
    const open = getReportMoneyChecks({
      ...base,
      currentBusinessDate: '2026-09-10',
      cashRows: [...history, cash('2026-09-10', 200_000)],
    });
    expect(open?.map((check) => check.kind)).toEqual(['duplicate_expense']);
    const noEntry = getReportMoneyChecks({
      ...base,
      currentBusinessDate: '2026-09-11',
      // The bar had sales, but without the day's cash entry the day is not closed out.
      stockRows: [
        ...['2026-08-13', '2026-08-20', '2026-08-27', '2026-09-03'].map((date) => ({ date, bar_income: 500_000 })),
        { date: '2026-09-10', bar_income: 10_000 },
      ],
      cashRows: history,
    });
    expect(noEntry?.map((check) => check.kind)).toEqual(['duplicate_expense']);
  });

  it('omits the block instead of failing the report when the checks cannot be built', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { some: () => { throw new Error('boom'); } } as never;
    expect(getReportMoneyChecks({ ...base, currentBusinessDate: '2026-09-11', cashRows: broken })).toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('money checks unavailable'), expect.any(Error));
    consoleError.mockRestore();
  });

  it('omits the block when the business day is unknown', () => {
    expect(getReportMoneyChecks({ ...base, currentBusinessDate: null, cashRows: history })).toBeUndefined();
  });
});

describe('truncateTelegramText', () => {
  it('keeps short text and cuts long text at a line break within the limit', () => {
    expect(truncateTelegramText('short')).toBe('short');
    const long = Array.from({ length: 400 }, (_, index) => `line ${index} ${'x'.repeat(10)}`).join('\n');
    const truncated = truncateTelegramText(long);
    expect(truncated.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_MAX_LENGTH);
    expect(truncated.endsWith('\n…')).toBe(true);
    expect(long.startsWith(truncated.slice(0, -2))).toBe(true);
  });

  it('never splits a surrogate pair', () => {
    const truncated = truncateTelegramText('a' + '😀'.repeat(10), 8);
    expect(truncated.length).toBeLessThanOrEqual(8);
    expect(truncated).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

function productsClient(result: { data: unknown[] | null; error: unknown }) {
  const query = {
    select: () => query,
    eq: () => query,
    gt: () => query,
    order: () => query,
    range: async () => result,
  };
  return { from: () => query } as unknown as SupabaseClient;
}

describe('getLowStockProductRows', () => {
  it('returns the club catalog rows', async () => {
    const rows = [{ name: 'Cola', current_stock: 1, low_stock_threshold: 5 }];
    await expect(getLowStockProductRows(productsClient({ data: rows, error: null }), 'club')).resolves.toEqual(rows);
  });

  it('omits the section instead of failing the report when products cannot be read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(getLowStockProductRows(productsClient({ data: null, error: new Error('boom') }), 'club'))
      .resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('sendTelegramMessage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('replies to an earlier message only when asked, and still sends if the original is gone', async () => {
    const sent = { ok: true, json: async () => ({ ok: true, result: { message_id: 8, chat: { id: -1001, type: 'supergroup' }, date: 1 } }) } as Response;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(sent);

    await sendTelegramMessage({ botToken: 'test-token', chatId: '-1001', text: 'removed', replyToMessageId: 42, fetchImpl: fetchMock });
    await sendTelegramMessage({ botToken: 'test-token', chatId: '-1001', text: 'plain', fetchImpl: fetchMock });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      chat_id: '-1001',
      text: 'removed',
      disable_notification: false,
      reply_parameters: { message_id: 42, allow_sending_without_reply: true },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).not.toHaveProperty('reply_parameters');
  });

  it('retries with the new chat id when Telegram upgrades a group', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          ok: false,
          error_code: 400,
          description: 'Bad Request: group chat was upgraded to a supergroup chat',
          parameters: { migrate_to_chat_id: -1001234567890 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: {
            message_id: 42,
            chat: { id: -1001234567890, title: 'Pixel', type: 'supergroup' },
            date: 1_787_799_537,
          },
        }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1234567890',
      text: 'daily report',
    });

    expect(result.result.message_id).toBe(42);
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual([
      'chat_migrated',
      'sent',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      chat_id: '-1001234567890',
      text: 'daily report',
    });
  });

  it('retries server failures with bounded exponential backoff', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({
          ok: false,
          error_code: 503,
          description: 'Service Unavailable',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            message_id: 43,
            chat: { id: -1001, title: 'Main', type: 'supergroup' },
            date: 1_787_799_538,
          },
        }),
      } as Response);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1001',
      text: 'daily report',
      fetchImpl: fetchMock,
      sleep,
      baseDelayMs: 400,
    });

    expect(result.result.message_id).toBe(43);
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(['server_error', 'sent']);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(400);
  });

  it('quarantines a bare gateway 502 instead of retrying it', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => null,
    } as Response);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const promise = sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1001',
      text: 'daily report',
      fetchImpl: fetchMock,
      sleep,
    });

    await expect(promise).rejects.toMatchObject({
      requiresManualReview: true,
      retryable: false,
      attempts: [expect.objectContaining({
        outcome: 'invalid_response',
        httpStatus: 502,
        retryDelayMs: null,
      })],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('honors Telegram retry_after when rate limited', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({
          ok: false,
          error_code: 429,
          description: 'Too Many Requests',
          parameters: { retry_after: 3 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            message_id: 44,
            chat: { id: -1002, type: 'supergroup' },
            date: 1_787_799_539,
          },
        }),
      } as Response);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1002',
      text: 'daily report',
      fetchImpl: fetchMock,
      sleep,
      baseDelayMs: 100,
    });

    expect(sleep).toHaveBeenCalledWith(3_000);
    expect(result.attempts[0]).toMatchObject({
      outcome: 'rate_limited',
      retryAfterSeconds: 3,
      retryDelayMs: 3_000,
    });
  });

  it('fails retryably instead of violating a retry_after beyond the invocation limit', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: 45 },
      }),
    } as Response);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const promise = sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1002',
      text: 'daily report',
      fetchImpl: fetchMock,
      sleep,
      maxInProcessRetryDelayMs: 10_000,
    });

    await expect(promise).rejects.toMatchObject({
      retryable: true,
      retryAfterSeconds: 45,
      attempts: [expect.objectContaining({
        outcome: 'rate_limited',
        retryAfterSeconds: 45,
        retryDelayMs: null,
      })],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('caps an in-process retry_after wait at three seconds by default', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: 5 },
      }),
    } as Response);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1002',
      text: 'daily report',
      fetchImpl: fetchMock,
      sleep,
    })).rejects.toMatchObject({ retryable: true, retryAfterSeconds: 5 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('stops retrying when the next attempt would overrun the invocation deadline', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ ok: false, error_code: 503, description: 'Service Unavailable' }),
    } as Response);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1002',
      text: 'daily report',
      fetchImpl: fetchMock,
      sleep,
      now: () => 1_000,
      timeoutMs: 8_000,
      deadlineAt: 9_200,
    })).rejects.toMatchObject({ retryable: true, requiresManualReview: false });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();

    await expect(sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1002',
      text: 'daily report',
      fetchImpl: fetchMock,
      now: () => 5_000,
      timeoutMs: 8_000,
      deadlineAt: 10_000,
    })).rejects.toMatchObject({ retryable: true, attempts: [] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('truncates text beyond Telegram\'s message limit', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: { message_id: 45, chat: { id: -1002, type: 'supergroup' }, date: 1_787_799_539 },
      }),
    } as Response);

    await sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1002',
      text: 'x'.repeat(5_000),
      fetchImpl: fetchMock,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_MAX_LENGTH);
  });

  it('quarantines a 2xx response with missing Telegram success JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    } as Response);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const promise = sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1002',
      text: 'daily report',
      fetchImpl: fetchMock,
      sleep,
    });

    await expect(promise).rejects.toMatchObject({
      requiresManualReview: true,
      retryable: false,
      attempts: [expect.objectContaining({
        outcome: 'invalid_response',
        retryDelayMs: null,
      })],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry permanent Telegram client errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        ok: false,
        error_code: 400,
        description: 'Bad Request: chat not found',
      }),
    } as Response);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const promise = sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1003',
      text: 'daily report',
      fetchImpl: fetchMock,
      sleep,
    });

    await expect(promise).rejects.toMatchObject({
      name: 'TelegramSendError',
      retryable: false,
      attempts: [expect.objectContaining({ outcome: 'client_error' })],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('aborts a stalled request at the configured timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }));

    const promise = sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1004',
      text: 'daily report',
      fetchImpl: fetchMock,
      maxAttempts: 1,
      timeoutMs: 250,
    });
    const assertion = expect(promise).rejects.toMatchObject({
      requiresManualReview: true,
      retryable: false,
      attempts: [expect.objectContaining({ outcome: 'timeout' })],
    });

    await vi.advanceTimersByTimeAsync(250);
    await assertion;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does not retry an ambiguous network failure', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('socket reset'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const promise = sendTelegramMessage({
      botToken: 'test-token',
      chatId: '-1005',
      text: 'daily report',
      fetchImpl: fetchMock,
      sleep,
    });

    await expect(promise).rejects.toMatchObject({
      requiresManualReview: true,
      retryable: false,
      attempts: [expect.objectContaining({
        outcome: 'network_error',
        retryDelayMs: null,
      })],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('sendTelegramPhoto', () => {
  it('uploads the PNG and caption with Telegram sendPhoto', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          message_id: 52,
          chat: { id: -1006, title: 'Pixel', type: 'supergroup' },
          date: 1_787_799_540,
        },
      }),
    } as Response);

    const result = await sendTelegramPhoto({
      botToken: 'test-token',
      chatId: '-1006',
      imagePng: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      imageFileName: 'daily-finance.png',
      caption: '👛 У администратора: 1 234 000 UZS\n💰 Всего денег: 1 234 000 UZS',
      fetchImpl: fetchMock,
    });

    expect(result.result.message_id).toBe(52);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/sendPhoto$/);
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(form.get('chat_id')).toBe('-1006');
    expect(form.get('caption')).toBe(
      '👛 У администратора: 1 234 000 UZS\n💰 Всего денег: 1 234 000 UZS',
    );
    expect(form.get('disable_notification')).toBe('false');
    const photo = form.get('photo');
    expect(photo).toBeInstanceOf(Blob);
    expect((photo as File).name).toBe('daily-finance.png');
    expect((photo as Blob).type).toBe('image/png');
  });
});

describe('sendTelegramPhotoAlbum', () => {
  it('sends both PNGs as one album with the caption on the first photo', async () => {
    const message = (id: number) => ({ message_id: id, chat: { id: -1006, title: 'Pixel', type: 'supergroup' }, date: 1_787_799_540 });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: [message(60), message(61)] }),
    } as Response);

    const result = await sendTelegramPhotoAlbum({
      botToken: 'test-token',
      chatId: '-1006',
      photos: [
        { png: Buffer.from([0x89, 0x50]), fileName: 'report.png' },
        { png: Buffer.from([0x89, 0x51]), fileName: 'write-offs.png' },
      ],
      caption: 'Отчёт',
      fetchImpl: fetchMock,
    });

    expect(result.result.message_id).toBe(60);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/sendMediaGroup$/);
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(JSON.parse(String(form.get('media')))).toEqual([
      { type: 'photo', media: 'attach://photo0', caption: 'Отчёт' },
      { type: 'photo', media: 'attach://photo1' },
    ]);
    expect((form.get('photo0') as File).name).toBe('report.png');
    expect((form.get('photo1') as File).name).toBe('write-offs.png');
  });

  it('refuses an album of one photo', () => {
    expect(() => sendTelegramPhotoAlbum({
      botToken: 't', chatId: '-1', caption: '', photos: [{ png: Buffer.from([1]), fileName: 'a.png' }],
    })).toThrow('2 to 10 photos');
  });
});

describe('getPromoGiveawayRows', () => {
  it('omits the section instead of failing when giveaway columns are missing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('column daily_stock_counts.giveaway_quantity does not exist'), { code: '42703' });
    await expect(getPromoGiveawayRows(productsClient({ data: null, error }), 'club', '2026-10-15')).resolves.toBeUndefined();
    const rows = [{ product_id: 'a', giveaway_quantity: 2, giveaway_cost: 6000, products: { name: 'Cola' }, promotions: null }];
    await expect(getPromoGiveawayRows(productsClient({ data: rows, error: null }), 'club', '2026-10-15')).resolves.toEqual(rows);
    consoleError.mockRestore();
  });
});
