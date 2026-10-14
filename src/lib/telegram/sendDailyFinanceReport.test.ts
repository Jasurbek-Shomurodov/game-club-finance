import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildDailyFinanceTelegramReport,
  getClubBusinessDayStartHour,
  getLowStockProductRows,
  sendTelegramMessage,
  sendTelegramPhoto,
  TELEGRAM_MESSAGE_MAX_LENGTH,
  truncateTelegramText,
} from './sendDailyFinanceReport';

vi.mock('./dailyFinanceReportImage', () => ({
  renderDailyFinanceReportPng: vi.fn().mockResolvedValue(null),
}));

type RecordedQuery = { table: string; select?: string; filters: string[] };

function recordingClient(clubRow: Record<string, unknown> | null, clubError: unknown = null) {
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
        order: () => query,
        range: async () => ({ data: [], error: null }),
        single: async () => ({ data: clubRow, error: clubError }),
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, queries };
}

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
    expect(inventory).toEqual([expect.objectContaining({
      filters: ['club_id=club', 'date>=2026-08-01', 'date<=2026-09-03'],
    })]);
    expect(queries).toContainEqual(expect.objectContaining({
      table: 'debt_payments',
      select: 'id,debt_id,date,amount',
      filters: ['club_id=club', 'date>2026-09-03'],
    }));
    expect(queries.every((query) => query.filters.includes('club_id=club') || query.filters.includes('id=club')))
      .toBe(true);
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
      caption: '📊 Ежедневный финансовый отчёт\nРабочий день: 27 августа 2026',
      fetchImpl: fetchMock,
    });

    expect(result.result.message_id).toBe(52);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/sendPhoto$/);
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(form.get('chat_id')).toBe('-1006');
    expect(form.get('caption')).toBe(
      '📊 Ежедневный финансовый отчёт\nРабочий день: 27 августа 2026',
    );
    expect(form.get('disable_notification')).toBe('false');
    const photo = form.get('photo');
    expect(photo).toBeInstanceOf(Blob);
    expect((photo as File).name).toBe('daily-finance.png');
    expect((photo as Blob).type).toBe('image/png');
  });
});
