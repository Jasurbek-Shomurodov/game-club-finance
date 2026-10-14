import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  buildReport: vi.fn(),
  getStartHour: vi.fn(),
  sendTelegramPhoto: vi.fn(),
  sendTelegramMessage: vi.fn(),
  claimDelivery: vi.fn(),
  beginDispatch: vi.fn(),
  completeDelivery: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));

vi.mock('@/lib/telegram/sendDailyFinanceReport', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../lib/telegram/sendDailyFinanceReport')
  >(
    '../../../../lib/telegram/sendDailyFinanceReport',
  );
  return {
    ...actual,
    buildDailyFinanceTelegramReport: mocks.buildReport,
    getClubBusinessDayStartHour: mocks.getStartHour,
    sendTelegramPhoto: mocks.sendTelegramPhoto,
    sendTelegramMessage: mocks.sendTelegramMessage,
  };
});

vi.mock('@/lib/telegram/reportDelivery', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../lib/telegram/reportDelivery')
  >(
    '../../../../lib/telegram/reportDelivery',
  );
  return {
    ...actual,
    claimReportDelivery: mocks.claimDelivery,
    beginReportDispatch: mocks.beginDispatch,
    completeReportDelivery: mocks.completeDelivery,
  };
});

import { GET } from './route';
import { TelegramSendError } from '../../../../lib/telegram/sendDailyFinanceReport';

const CLUB_ID = '290c5c33-9dfa-464a-a072-ef5a231f5308';

function cronRequest(query = '', authorization = 'Bearer test-cron-secret'): NextRequest {
  return {
    headers: new Headers({ authorization, 'user-agent': 'vercel-cron/1.0' }),
    nextUrl: new URL(`https://example.test/api/cron/daily-finance-report${query}`),
  } as NextRequest;
}

function sentAttempt() {
  return {
    attempt: 1,
    startedAt: '2026-08-27T06:00:00.000Z',
    finishedAt: '2026-08-27T06:00:00.100Z',
    outcome: 'sent' as const,
    httpStatus: 200,
    telegramErrorCode: null,
    description: null,
    retryAfterSeconds: null,
    retryDelayMs: null,
  };
}

describe('daily finance report cron route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-bot-token');
    vi.stubEnv('TELEGRAM_PIXEL_CHAT_ID', '-1001');
    vi.stubEnv('TELEGRAM_PIXEL_CLUB_ID', CLUB_ID);
    vi.stubEnv('TELEGRAM_MAIN_CHAT_ID', '');
    vi.stubEnv('TELEGRAM_MAIN_CLUB_ID', '');
    vi.stubEnv('TELEGRAM_BUNKER_CHAT_ID', '');
    vi.stubEnv('TELEGRAM_BUNKER_CLUB_ID', '');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mocks.createServiceClient.mockReturnValue({ rpc: vi.fn() });
    mocks.getStartHour.mockResolvedValue(0);
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'claimed',
      deliveryId: '40c05af5-5a59-45ae-a891-19a18228a721',
      status: 'claimed',
      claimToken: 'ce4801cd-cd1c-4d88-a860-b1dc41c03a26',
      claimCount: 1,
      claimExpiresAt: '2026-08-27T06:05:00.000Z',
    });
    mocks.beginDispatch.mockResolvedValue(undefined);
    mocks.completeDelivery.mockResolvedValue(undefined);
    mocks.buildReport.mockResolvedValue({
      clubId: CLUB_ID,
      chatId: '-1001',
      businessDate: '2026-08-26',
      message: 'report',
      caption: 'caption',
      imagePng: Buffer.from('png'),
      imageFileName: 'report.png',
    });
    const telegramSuccess = {
      ok: true,
      result: {
        message_id: 51,
        chat: { id: -1001, title: 'Pixel', type: 'supergroup' },
        date: 1_787_799_541,
      },
      attempts: [sentAttempt()],
    };
    mocks.sendTelegramPhoto.mockResolvedValue(telegramSuccess);
    mocks.sendTelegramMessage.mockResolvedValue(telegramSuccess);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('rejects a bearer token of a different length without throwing', async () => {
    const response = await GET(cronRequest('', 'Bearer test-cron-secret-but-longer'));

    expect(response.status).toBe(401);
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
  });

  it('rejects an impossible calendar date', async () => {
    const response = await GET(cronRequest('?date=2026-02-31&target=pixel'));

    expect(response.status).toBe(400);
    expect(mocks.claimDelivery).not.toHaveBeenCalled();
  });

  it('refuses a scheduled send for a business day that has not closed yet', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 08:00 in Tashkent on 27 August.
    vi.setSystemTime(new Date('2026-08-27T03:00:00.000Z'));

    for (const date of ['2026-08-27', '2026-08-28']) {
      const response = await GET(cronRequest(`?date=${date}&target=pixel`));
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload.error).toContain('current business date 2026-08-27');
    }
    // A club whose day starts at 10:00 is still in its 26 August business day.
    mocks.getStartHour.mockResolvedValue(10);
    expect((await GET(cronRequest('?date=2026-08-26&target=pixel'))).status).toBe(400);
    expect(mocks.claimDelivery).not.toHaveBeenCalled();
    expect(mocks.sendTelegramPhoto).not.toHaveBeenCalled();

    const preview = await GET(cronRequest('?date=2026-08-27&target=pixel&dryRun=1'));
    expect(preview.status).toBe(200);
    expect(mocks.buildReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ businessDate: '2026-08-27' }),
    );
  });

  it('reports the previous business day of each club by default', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-27T03:00:00.000Z'));

    await GET(cronRequest());
    expect(mocks.claimDelivery).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ businessDate: '2026-08-26', deliveryKey: 'scheduled' }),
    );

    // At 08:00 a club opening at 10:00 has not closed 26 August yet.
    mocks.getStartHour.mockResolvedValue(10);
    await GET(cronRequest());
    expect(mocks.claimDelivery).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ businessDate: '2026-08-25' }),
    );
  });

  it('fails a target closed when its business day cannot be read', async () => {
    mocks.getStartHour.mockRejectedValue(new Error('clubs unavailable'));

    const response = await GET(cronRequest());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.sent[0]).toMatchObject({ ok: false, stage: 'business_date' });
    expect(mocks.claimDelivery).not.toHaveBeenCalled();
  });

  it('treats an in-progress claim after a retried claim as a failure', async () => {
    mocks.claimDelivery
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce({
        outcome: 'in_progress',
        deliveryId: '40c05af5-5a59-45ae-a891-19a18228a721',
        status: 'claimed',
        claimCount: 1,
        claimExpiresAt: '2026-08-27T06:05:00.000Z',
      });

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.sent[0]).toMatchObject({ ok: false, status: 'in_progress', stage: 'claim' });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(
      'telegram_report_delivery_claim_ambiguous',
    ));
    expect(mocks.buildReport).not.toHaveBeenCalled();
    expect(mocks.sendTelegramPhoto).not.toHaveBeenCalled();
  });

  it('passes the invocation deadline to Telegram dispatch', async () => {
    await GET(cronRequest('?date=2026-08-26&target=pixel'));

    expect(mocks.sendTelegramPhoto).toHaveBeenCalledWith(expect.objectContaining({
      deadlineAt: expect.any(Number),
    }));
  });

  it('fails loudly before report work when CRON_SECRET is too short', async () => {
    vi.stubEnv('CRON_SECRET', 'short-value');

    const response = await GET(cronRequest());
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toContain('at least 16 characters');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(
      'telegram_report_cron_auth_misconfigured',
    ));
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.claimDelivery).not.toHaveBeenCalled();
    expect(mocks.sendTelegramPhoto).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('logs safe diagnostics when Vercel sends a mismatched cron credential', async () => {
    const response = await GET(cronRequest('', 'Bearer stale-cron-secret'));

    expect(response.status).toBe(401);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(
      'telegram_report_cron_auth_failed',
    ));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(
      '"bearerTokenLength":17',
    ));
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('stale-cron-secret'));
    expect(mocks.createServiceClient).not.toHaveBeenCalled();
    expect(mocks.claimDelivery).not.toHaveBeenCalled();
    expect(mocks.sendTelegramPhoto).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('retries a transient delivery-claim failure before sending', async () => {
    mocks.claimDelivery
      .mockRejectedValueOnce({ code: 'PGRST303', message: 'JWT issued at future' })
      .mockResolvedValueOnce({
        outcome: 'claimed',
        deliveryId: '40c05af5-5a59-45ae-a891-19a18228a721',
        status: 'claimed',
        claimToken: 'ce4801cd-cd1c-4d88-a860-b1dc41c03a26',
        claimCount: 1,
        claimExpiresAt: '2026-08-27T06:05:00.000Z',
      });

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));

    expect(response.status).toBe(200);
    expect(mocks.claimDelivery).toHaveBeenCalledTimes(2);
    expect(mocks.sendTelegramPhoto).toHaveBeenCalledOnce();
  });

  it('returns 500 with per-target diagnostics when Telegram exhausts retries', async () => {
    const attempts = [{
      ...sentAttempt(),
      outcome: 'server_error' as const,
      httpStatus: 503,
      telegramErrorCode: 503,
      description: 'Service Unavailable',
    }];
    mocks.sendTelegramPhoto.mockRejectedValue(
      new TelegramSendError('Telegram send failed after 3 attempts', attempts, true),
    );

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toMatchObject({
      ok: false,
      businessDate: '2026-08-26',
      sent: [{
        ok: false,
        target: 'pixel',
        stage: 'telegram',
        retryable: true,
        attempts: 1,
        ledgerFinalized: true,
      }],
    });
    expect(mocks.completeDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        outcome: 'failed',
        telegramAttemptCount: 1,
        attemptHistory: attempts,
      }),
    );
  });

  it('skips a delivery already completed by another invocation', async () => {
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'already_sent',
      deliveryId: '40c05af5-5a59-45ae-a891-19a18228a721',
      status: 'sent',
      format: 'photo',
      claimCount: 1,
      sentAt: '2026-08-27T06:00:00.000Z',
      telegramResult: { messageId: 50 },
    });

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ status: 'already_sent', format: null });
    expect(payload.sent[0]).toMatchObject({
      ok: true,
      target: 'pixel',
      status: 'already_sent',
      skipped: true,
    });
    expect(mocks.buildReport).not.toHaveBeenCalled();
    expect(mocks.sendTelegramPhoto).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(mocks.beginDispatch).not.toHaveBeenCalled();
    expect(mocks.completeDelivery).not.toHaveBeenCalled();
  });

  it('does not reclaim a rate-limited delivery before retry_after', async () => {
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'retry_deferred',
      deliveryId: '40c05af5-5a59-45ae-a891-19a18228a721',
      status: 'failed',
      claimCount: 1,
      retryNotBefore: '2026-08-27T06:45:00.000Z',
    });

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sent[0]).toMatchObject({
      ok: true,
      status: 'retry_deferred',
      skipped: true,
      retryNotBefore: '2026-08-27T06:45:00.000Z',
    });
    expect(mocks.buildReport).not.toHaveBeenCalled();
    expect(mocks.sendTelegramPhoto).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('finalizes a successful delivery before reporting success', async () => {
    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ status: 'sent', format: 'photo' });
    expect(payload.sent[0]).toMatchObject({
      ok: true,
      status: 'sent',
      deliveryId: '40c05af5-5a59-45ae-a891-19a18228a721',
      messageId: 51,
      attempts: 1,
    });
    expect(mocks.completeDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        outcome: 'sent',
        telegramAttemptCount: 1,
        telegramResult: expect.objectContaining({
          deliveryType: 'photo',
          messageId: 51,
        }),
      }),
    );
    expect(mocks.sendTelegramPhoto).toHaveBeenCalledWith(expect.objectContaining({
      imagePng: Buffer.from('png'),
      imageFileName: 'report.png',
      caption: 'caption',
    }));
  });

  it('sends the text report when PNG rendering is unavailable', async () => {
    mocks.buildReport.mockResolvedValue({
      clubId: CLUB_ID,
      chatId: '-1001',
      businessDate: '2026-08-26',
      message: 'text fallback report',
      caption: 'caption',
      imagePng: null,
      imageFileName: 'report.png',
    });

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));

    expect(response.status).toBe(200);
    expect(mocks.sendTelegramPhoto).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: 'text fallback report',
    }));
    expect(mocks.completeDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        outcome: 'sent',
        telegramResult: expect.objectContaining({ deliveryType: 'text' }),
      }),
    );
  });

  it('leaves a started dispatch quarantinable when Telegram succeeds but finalization fails', async () => {
    mocks.completeDelivery.mockRejectedValue({ message: 'database unavailable' });

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.sent[0]).toMatchObject({
      ok: false,
      stage: 'finalize',
      telegramDelivered: true,
    });
    expect(mocks.beginDispatch).toHaveBeenCalledOnce();
    expect(mocks.sendTelegramPhoto).toHaveBeenCalledOnce();
    expect(mocks.completeDelivery).toHaveBeenCalledTimes(3);
    expect(mocks.completeDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outcome: 'sent' }),
    );
  });

  it('rejects an unsafe forced resend before claiming or sending', async () => {
    const response = await GET(cronRequest(
      '?date=2026-08-26&target=pixel&force=1',
    ));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('requestId to be a UUID');
    expect(mocks.claimDelivery).not.toHaveBeenCalled();
    expect(mocks.sendTelegramPhoto).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('persists an ambiguous Telegram outcome for manual review without retrying', async () => {
    const attempts = [{
      ...sentAttempt(),
      outcome: 'network_error' as const,
      httpStatus: null,
      telegramErrorCode: null,
      description: 'socket reset',
    }];
    mocks.sendTelegramPhoto.mockRejectedValue(
      new TelegramSendError('Telegram outcome is unknown', attempts, false, true),
    );

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.sent[0]).toMatchObject({
      ok: false,
      status: 'manual_review',
      requiresManualReview: true,
      attempts: 1,
    });
    expect(mocks.beginDispatch).toHaveBeenCalledOnce();
    expect(mocks.completeDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        outcome: 'manual_review',
        telegramAttemptCount: 1,
      }),
    );
  });

  it('returns 500 and never sends a ledger row already in manual review', async () => {
    mocks.claimDelivery.mockResolvedValue({
      outcome: 'manual_review',
      deliveryId: '40c05af5-5a59-45ae-a891-19a18228a721',
      status: 'manual_review',
      claimCount: 1,
      dispatchStartedAt: '2026-08-27T06:00:00.000Z',
      lastError: { message: 'unknown outcome' },
    });

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.sent[0]).toMatchObject({
      ok: false,
      status: 'manual_review',
      stage: 'manual_review',
    });
    expect(mocks.buildReport).not.toHaveBeenCalled();
    expect(mocks.beginDispatch).not.toHaveBeenCalled();
    expect(mocks.sendTelegramPhoto).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });
});
