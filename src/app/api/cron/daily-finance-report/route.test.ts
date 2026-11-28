import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  buildReport: vi.fn(),
  getStartHour: vi.fn(),
  sendTelegramPhoto: vi.fn(),
  sendTelegramPhotoAlbum: vi.fn(),
  sendTelegramMessage: vi.fn(),
  claimDelivery: vi.fn(),
  beginDispatch: vi.fn(),
  completeDelivery: vi.fn(),
  loadReviewDigest: vi.fn(),
  loadReviewDigestForReport: vi.fn(),
  completeReviewDigest: vi.fn(),
  recordReviewDigestResend: vi.fn(),
  deliverActivity: vi.fn(),
  expireActivity: vi.fn(),
  ownerMorning: vi.fn(),
}));

vi.mock('@/lib/telegram/ownerBot/morning', () => ({
  sendOwnerBotMorningMessages: mocks.ownerMorning,
}));

vi.mock('@/lib/telegram/activityDelivery', () => ({
  deliverActivityNotices: mocks.deliverActivity,
  expireActivityNotices: mocks.expireActivity,
}));

vi.mock('@/lib/googleBusiness/reviewDigestPhoto', () => ({
  loadAwaitingReviewDigestPhoto: mocks.loadReviewDigest,
  loadReviewDigestPhotoForReport: mocks.loadReviewDigestForReport,
}));

vi.mock('@/lib/googleBusiness/reviewDigestRows', () => ({
  completeReviewDigest: mocks.completeReviewDigest,
  recordReviewDigestResend: mocks.recordReviewDigestResend,
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
    sendTelegramPhotoAlbum: mocks.sendTelegramPhotoAlbum,
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
    mocks.loadReviewDigest.mockResolvedValue(null);
    mocks.loadReviewDigestForReport.mockResolvedValue(null);
    mocks.completeReviewDigest.mockResolvedValue(undefined);
    mocks.recordReviewDigestResend.mockResolvedValue(undefined);
    mocks.deliverActivity.mockResolvedValue({ claimed: 0, sent: 0, failed: 0, unrouted: 0, released: 0 });
    mocks.expireActivity.mockResolvedValue(0);
    mocks.ownerMorning.mockResolvedValue({ skipped: false, sent: 1, alreadySent: 0, failed: 0 });
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
    mocks.sendTelegramPhotoAlbum.mockResolvedValue(telegramSuccess);
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

  it('sends the activity notices a page left pending after the report, one small round per club', async () => {
    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));

    expect(response.status).toBe(200);
    expect(mocks.expireActivity).toHaveBeenCalledTimes(1);
    expect(mocks.deliverActivity).toHaveBeenCalledTimes(1);
    expect(mocks.deliverActivity).toHaveBeenCalledWith(
      expect.anything(),
      CLUB_ID,
      expect.objectContaining({ batchSize: 10, maxBatches: 1, deadlineAt: expect.any(Number) }),
    );
    const { deadlineAt } = mocks.deliverActivity.mock.calls[0][2] as { deadlineAt: number };
    expect(deadlineAt - Date.now()).toBeLessThanOrEqual(45_000);
    expect(mocks.sendTelegramPhoto.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.expireActivity.mock.invocationCallOrder[0]);
    expect(mocks.expireActivity.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.deliverActivity.mock.invocationCallOrder[0]);
  });

  it('still reports the delivery when the notices cannot be sent', async () => {
    mocks.deliverActivity.mockResolvedValue({ claimed: 3, sent: 0, failed: 0, unrouted: 0, released: 3 });
    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'sent' });
  });

  it('sends no activity notice from a dry run', async () => {
    await GET(cronRequest('?date=2026-08-26&target=pixel&dryRun=1'));
    expect(mocks.deliverActivity).not.toHaveBeenCalled();
    expect(mocks.expireActivity).not.toHaveBeenCalled();
  });

  it('sends the report and the day\'s write-offs together as one album', async () => {
    mocks.buildReport.mockResolvedValue({
      clubId: CLUB_ID,
      chatId: '-1001',
      businessDate: '2026-08-26',
      message: 'report',
      caption: 'caption',
      imagePng: Buffer.from('png'),
      imageFileName: 'report.png',
      adjustmentsImage: { png: Buffer.from('write-offs'), fileName: 'write-offs.png', caption: 'write-offs caption' },
    });

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.sent[0]).toMatchObject({ status: 'sent', messageId: 51, writeOffsImageSent: true });
    expect(mocks.sendTelegramPhoto).not.toHaveBeenCalled();
    expect(mocks.sendTelegramPhotoAlbum).toHaveBeenCalledOnce();
    expect(mocks.sendTelegramPhotoAlbum).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '-1001',
      caption: 'caption',
      photos: [
        { png: Buffer.from('png'), fileName: 'report.png' },
        { png: Buffer.from('write-offs'), fileName: 'write-offs.png' },
      ],
    }));
    expect(mocks.completeDelivery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      outcome: 'sent',
      telegramResult: expect.objectContaining({ deliveryType: 'photo', photoCount: 2 }),
    }));
  });

  it('adds the waiting AI bot image to the album and records it as sent', async () => {
    mocks.loadReviewDigest.mockResolvedValue({
      digestDate: '2026-08-27',
      png: Buffer.from('reviews'),
      fileName: 'google-reviews-2026-08-27.png',
      caption: 'reviews caption',
      reportLine: '🤖 ИИ-бот: ответов на отзывы Google Maps: 1',
    });
    mocks.buildReport.mockResolvedValue({
      clubId: CLUB_ID,
      chatId: '-1001',
      businessDate: '2026-08-26',
      message: 'report',
      caption: 'caption',
      imagePng: Buffer.from('png'),
      imageFileName: 'report.png',
      adjustmentsImage: { png: Buffer.from('write-offs'), fileName: 'write-offs.png', caption: 'write-offs caption' },
    });

    const payload = await (await GET(cronRequest('?date=2026-08-26&target=pixel'))).json();

    expect(payload.sent[0]).toMatchObject({ status: 'sent', writeOffsImageSent: true, reviewDigestSent: true });
    expect(mocks.sendTelegramPhoto).not.toHaveBeenCalled();
    expect(mocks.sendTelegramPhotoAlbum).toHaveBeenCalledWith(expect.objectContaining({
      caption: 'caption\n🤖 ИИ-бот: ответов на отзывы Google Maps: 1',
      photos: [
        { png: Buffer.from('png'), fileName: 'report.png' },
        { png: Buffer.from('write-offs'), fileName: 'write-offs.png' },
        { png: Buffer.from('reviews'), fileName: 'google-reviews-2026-08-27.png' },
      ],
    }));
    expect(mocks.completeDelivery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      telegramResult: expect.objectContaining({ photoCount: 3 }),
    }));
    expect(mocks.completeReviewDigest).toHaveBeenCalledWith(expect.anything(), CLUB_ID, '2026-08-27', { messageId: 51 });
  });

  it('makes a two-photo album of the report and the AI bot image', async () => {
    mocks.loadReviewDigest.mockResolvedValue({
      digestDate: '2026-08-27', png: Buffer.from('reviews'), fileName: 'reviews.png', caption: 'reviews caption', reportLine: 'line',
    });
    await GET(cronRequest('?date=2026-08-26&target=pixel'));
    expect(mocks.sendTelegramPhotoAlbum).toHaveBeenCalledWith(expect.objectContaining({
      photos: [{ png: Buffer.from('png'), fileName: 'report.png' }, { png: Buffer.from('reviews'), fileName: 'reviews.png' }],
    }));
  });

  it('still sends the report when the AI bot image cannot be loaded', async () => {
    mocks.loadReviewDigest.mockRejectedValue(new Error('render failed'));
    const payload = await (await GET(cronRequest('?date=2026-08-26&target=pixel'))).json();
    expect(payload.sent[0]).toMatchObject({ status: 'sent', reviewDigestSent: false });
    expect(mocks.sendTelegramPhoto).toHaveBeenCalledOnce();
    expect(mocks.completeReviewDigest).not.toHaveBeenCalled();
  });

  it('sends the AI bot image after a text fallback report', async () => {
    mocks.loadReviewDigest.mockResolvedValue({
      digestDate: '2026-08-27', png: Buffer.from('reviews'), fileName: 'reviews.png', caption: 'reviews caption', reportLine: 'line',
    });
    mocks.buildReport.mockResolvedValue({
      clubId: CLUB_ID, chatId: '-1001', businessDate: '2026-08-26', message: 'text report', caption: 'caption',
      imagePng: null, imageFileName: 'report.png',
    });
    const payload = await (await GET(cronRequest('?date=2026-08-26&target=pixel'))).json();
    expect(payload.sent[0]).toMatchObject({ format: 'text', reviewDigestSent: true });
    expect(mocks.sendTelegramPhoto).toHaveBeenCalledWith(expect.objectContaining({ imageFileName: 'reviews.png', caption: 'reviews caption' }));
    expect(mocks.completeReviewDigest).toHaveBeenCalledWith(expect.anything(), CLUB_ID, '2026-08-27', { messageId: 51 });
  });

  describe('AI bot image on a forced resend', () => {
    const FORCED = '?date=2026-08-26&target=pixel&force=1&requestId=40c05af5-5a59-45ae-a891-19a18228a721';
    const DATED = {
      digestDate: '2026-08-27',
      png: Buffer.from('reviews'),
      fileName: 'google-reviews-2026-08-27.png',
      caption: 'reviews caption',
      reportLine: '🤖 ИИ-бот: ответов на отзывы Google Maps: 2',
      awaitingReport: false,
    };

    it('carries the already-sent digest of the business date + 1 and moves it to the new album', async () => {
      mocks.loadReviewDigestForReport.mockResolvedValue(DATED);
      const payload = await (await GET(cronRequest(FORCED))).json();

      expect(payload.sent[0]).toMatchObject({ status: 'sent', reviewDigestSent: true });
      expect(mocks.loadReviewDigestForReport).toHaveBeenCalledWith(expect.anything(), CLUB_ID, '2026-08-26', 0);
      expect(mocks.sendTelegramPhotoAlbum).toHaveBeenCalledWith(expect.objectContaining({
        caption: 'caption\n🤖 ИИ-бот: ответов на отзывы Google Maps: 2',
        photos: [
          { png: Buffer.from('png'), fileName: 'report.png' },
          { png: Buffer.from('reviews'), fileName: 'google-reviews-2026-08-27.png' },
        ],
      }));
      expect(mocks.recordReviewDigestResend).toHaveBeenCalledWith(expect.anything(), CLUB_ID, '2026-08-27', 51);
      expect(mocks.completeReviewDigest).not.toHaveBeenCalled();
      expect(mocks.loadReviewDigest).not.toHaveBeenCalled();
    });

    it('completes its own dated digest when it is still waiting, as a scheduled send would', async () => {
      mocks.loadReviewDigestForReport.mockResolvedValue({ ...DATED, awaitingReport: true });
      const payload = await (await GET(cronRequest(FORCED))).json();

      expect(payload.sent[0]).toMatchObject({ status: 'sent', reviewDigestSent: true });
      expect(mocks.sendTelegramPhotoAlbum).toHaveBeenCalledOnce();
      expect(mocks.completeReviewDigest).toHaveBeenCalledWith(expect.anything(), CLUB_ID, '2026-08-27', { messageId: 51 });
      expect(mocks.recordReviewDigestResend).not.toHaveBeenCalled();
    });

    it('leaves a newer waiting digest alone when resending an older date', async () => {
      mocks.loadReviewDigest.mockResolvedValue({
        ...DATED, digestDate: '2026-08-30', fileName: 'google-reviews-2026-08-30.png', reportLine: 'newer line',
      });
      mocks.loadReviewDigestForReport.mockResolvedValue(DATED);
      await GET(cronRequest(FORCED));

      expect(mocks.loadReviewDigest).not.toHaveBeenCalled();
      expect(mocks.sendTelegramPhotoAlbum).toHaveBeenCalledWith(expect.objectContaining({
        caption: 'caption\n🤖 ИИ-бот: ответов на отзывы Google Maps: 2',
        photos: [
          { png: Buffer.from('png'), fileName: 'report.png' },
          { png: Buffer.from('reviews'), fileName: 'google-reviews-2026-08-27.png' },
        ],
      }));
      expect(mocks.recordReviewDigestResend).toHaveBeenCalledWith(expect.anything(), CLUB_ID, '2026-08-27', 51);
      expect(mocks.completeReviewDigest).not.toHaveBeenCalled();
    });

    it('sends no AI bot image when its own date has no digest', async () => {
      mocks.loadReviewDigest.mockResolvedValue({ ...DATED, digestDate: '2026-08-30' });
      const payload = await (await GET(cronRequest(FORCED))).json();

      expect(payload.sent[0]).toMatchObject({ status: 'sent', reviewDigestSent: false });
      expect(mocks.sendTelegramPhotoAlbum).not.toHaveBeenCalled();
      expect(mocks.completeReviewDigest).not.toHaveBeenCalled();
      expect(mocks.recordReviewDigestResend).not.toHaveBeenCalled();
    });

    it('logs a failed separate send of a resent digest without recording over the earlier send', async () => {
      mocks.loadReviewDigestForReport.mockResolvedValue(DATED);
      mocks.buildReport.mockResolvedValue({
        clubId: CLUB_ID, chatId: '-1001', businessDate: '2026-08-26', message: 'text report', caption: 'caption',
        imagePng: null, imageFileName: 'report.png',
      });
      mocks.sendTelegramPhoto.mockRejectedValueOnce(new Error('network down'));
      const payload = await (await GET(cronRequest(FORCED))).json();

      expect(payload.sent[0]).toMatchObject({ status: 'sent', format: 'text', reviewDigestSent: false });
      expect(mocks.recordReviewDigestResend).not.toHaveBeenCalled();
      expect(mocks.completeReviewDigest).not.toHaveBeenCalled();
    });

    it("passes the club's business-day start hour to the dated lookup", async () => {
      mocks.getStartHour.mockResolvedValue(10);
      await GET(cronRequest(FORCED));
      expect(mocks.loadReviewDigestForReport).toHaveBeenCalledWith(expect.anything(), CLUB_ID, '2026-08-26', 10);
    });

    it("still sends the report when the club's start hour cannot be read", async () => {
      mocks.getStartHour.mockRejectedValue(new Error('clubs down'));
      const payload = await (await GET(cronRequest(FORCED))).json();

      expect(payload.sent[0]).toMatchObject({ status: 'sent', reviewDigestSent: false });
      expect(mocks.loadReviewDigestForReport).not.toHaveBeenCalled();
      expect(mocks.sendTelegramPhoto).toHaveBeenCalledOnce();
    });

    it('still sends the report when the dated digest cannot be loaded', async () => {
      mocks.loadReviewDigestForReport.mockRejectedValue(new Error('down'));
      const payload = await (await GET(cronRequest(FORCED))).json();

      expect(payload.sent[0]).toMatchObject({ status: 'sent', reviewDigestSent: false });
      expect(mocks.sendTelegramPhoto).toHaveBeenCalledOnce();
      expect(mocks.recordReviewDigestResend).not.toHaveBeenCalled();
    });

    it('never looks up a sent digest for a scheduled send', async () => {
      mocks.loadReviewDigestForReport.mockResolvedValue(DATED);
      const payload = await (await GET(cronRequest('?date=2026-08-26&target=pixel'))).json();

      expect(payload.sent[0]).toMatchObject({ status: 'sent', reviewDigestSent: false });
      expect(mocks.loadReviewDigestForReport).not.toHaveBeenCalled();
      expect(mocks.sendTelegramPhotoAlbum).not.toHaveBeenCalled();
    });
  });

  it('sends a single photo when the day had no write-offs or corrections', async () => {
    await GET(cronRequest('?date=2026-08-26&target=pixel'));
    expect(mocks.sendTelegramPhotoAlbum).not.toHaveBeenCalled();
    expect(mocks.sendTelegramPhoto).toHaveBeenCalledOnce();
  });

  it('follows a text fallback report with the write-offs image and keeps it sent when that fails', async () => {
    mocks.buildReport.mockResolvedValue({
      clubId: CLUB_ID,
      chatId: '-1001',
      businessDate: '2026-08-26',
      message: 'text report',
      caption: 'caption',
      imagePng: null,
      imageFileName: 'report.png',
      adjustmentsImage: { png: Buffer.from('write-offs'), fileName: 'write-offs.png', caption: 'write-offs caption' },
    });
    mocks.sendTelegramPhoto.mockRejectedValueOnce(new Error('network down'));

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledOnce();
    expect(payload.sent[0]).toMatchObject({ status: 'sent', writeOffsImageSent: false });
  });

  it('tries the photo again when Telegram fails to process the image once', async () => {
    const rejected = [{
      ...sentAttempt(),
      outcome: 'client_error' as const,
      httpStatus: 400,
      telegramErrorCode: 400,
      description: 'Bad Request: IMAGE_PROCESS_FAILED',
    }];
    mocks.sendTelegramPhoto.mockRejectedValueOnce(new TelegramSendError('rejected', rejected, false));

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));

    expect(response.status).toBe(200);
    expect(mocks.sendTelegramPhoto).toHaveBeenCalledTimes(2);
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(mocks.completeDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        outcome: 'sent',
        telegramAttemptCount: 2,
        telegramResult: expect.objectContaining({ deliveryType: 'photo' }),
      }),
    );
  });

  it('sends the report as text when Telegram keeps failing to process the image', async () => {
    const rejected = [{
      ...sentAttempt(),
      outcome: 'client_error' as const,
      httpStatus: 400,
      telegramErrorCode: 400,
      description: 'Bad Request: IMAGE_PROCESS_FAILED',
    }];
    mocks.sendTelegramPhoto.mockRejectedValue(new TelegramSendError('rejected', rejected, false));

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));

    expect(response.status).toBe(200);
    expect(mocks.sendTelegramPhoto).toHaveBeenCalledTimes(2);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'report' }));
    expect(mocks.completeDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        outcome: 'sent',
        telegramAttemptCount: 3,
        telegramResult: expect.objectContaining({ deliveryType: 'text' }),
      }),
    );
  });

  it('does not switch to text for other Telegram client errors', async () => {
    const rejected = [{
      ...sentAttempt(),
      outcome: 'client_error' as const,
      httpStatus: 403,
      telegramErrorCode: 403,
      description: 'Forbidden: bot was kicked from the group chat',
    }];
    mocks.sendTelegramPhoto.mockRejectedValue(new TelegramSendError('kicked', rejected, false));

    const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));

    expect(response.status).toBe(500);
    expect(mocks.sendTelegramPhoto).toHaveBeenCalledOnce();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
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

  describe('the owner bot\'s morning message', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      // 08:00 in Tashkent on 27 August: 26 August is the club's last closed business day.
      vi.setSystemTime(new Date('2026-08-27T03:00:00.000Z'));
    });

    it('goes out after a scheduled report is delivered and recorded, for that club and day', async () => {
      const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(mocks.ownerMorning).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ clubId: CLUB_ID, businessDate: '2026-08-26', deadlineAt: expect.any(Number), now: expect.any(Date) }),
      );
      expect(mocks.completeDelivery.mock.invocationCallOrder[0]).toBeLessThan(mocks.ownerMorning.mock.invocationCallOrder[0]);
      expect(payload.sent[0]).toMatchObject({ status: 'sent', ownerBotMessages: { sent: 1, alreadySent: 0, failed: 0 } });
    });

    it('is completed by a retry run that finds the report already sent; the record keeps it to once', async () => {
      mocks.claimDelivery.mockResolvedValue({
        outcome: 'already_sent',
        deliveryId: '40c05af5-5a59-45ae-a891-19a18228a721',
        status: 'sent',
        claimCount: 1,
        sentAt: '2026-08-27T06:00:00.000Z',
        telegramResult: { messageId: 50 },
      });
      mocks.ownerMorning.mockResolvedValue({ skipped: false, sent: 0, alreadySent: 1, failed: 0 });

      const payload = await (await GET(cronRequest('?date=2026-08-26&target=pixel'))).json();
      expect(mocks.ownerMorning).toHaveBeenCalledTimes(1);
      expect(payload.sent[0]).toMatchObject({ status: 'already_sent', ownerBotMessages: { alreadySent: 1 } });
    });

    it('is not sent by a forced resend or after a failed report', async () => {
      await GET(cronRequest('?date=2026-08-26&target=pixel&force=1'));
      expect(mocks.ownerMorning).not.toHaveBeenCalled();

      mocks.sendTelegramPhoto.mockRejectedValue(new TelegramSendError('Telegram send failed', [], true));
      mocks.sendTelegramPhotoAlbum.mockRejectedValue(new TelegramSendError('Telegram send failed', [], true));
      await GET(cronRequest('?date=2026-08-26&target=pixel'));
      expect(mocks.ownerMorning).not.toHaveBeenCalled();
    });

    it('goes out for the scheduled run without a date too', async () => {
      await GET(cronRequest());
      expect(mocks.ownerMorning).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ businessDate: '2026-08-26' }));
    });

    it('is not sent by a scheduled run for an older day, so owners never get live buttons for it', async () => {
      const response = await GET(cronRequest('?date=2026-08-20&target=pixel'));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.sent[0]).toMatchObject({ status: 'sent', ownerBotMessages: null });
      expect(mocks.ownerMorning).not.toHaveBeenCalled();

      mocks.claimDelivery.mockResolvedValue({
        outcome: 'already_sent',
        deliveryId: '40c05af5-5a59-45ae-a891-19a18228a721',
        status: 'sent',
        claimCount: 1,
        sentAt: '2026-08-21T06:00:00.000Z',
        telegramResult: { messageId: 50 },
      });
      await GET(cronRequest('?date=2026-08-20&target=pixel'));
      expect(mocks.ownerMorning).not.toHaveBeenCalled();
    });

    it('never fails the report', async () => {
      mocks.ownerMorning.mockRejectedValue(new Error('owner bot down'));
      const response = await GET(cronRequest('?date=2026-08-26&target=pixel'));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.sent[0]).toMatchObject({ ok: true, status: 'sent', ownerBotMessages: null });
      expect(mocks.completeDelivery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: 'sent' }));
      expect(mocks.completeDelivery).toHaveBeenCalledTimes(1);
    });
  });
});
