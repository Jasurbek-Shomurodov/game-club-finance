import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { serverTodayIso } from '@/lib/utils';
import {
  isTelegramReportTargetKey,
  TELEGRAM_REPORT_TARGET_ENV,
  type TelegramReportTargetKey,
} from '@/lib/telegram/clubChat';
import {
  buildDailyFinanceTelegramReport,
  getClubBusinessDayStartHour,
  isIsoDate,
  previousClubBusinessDateIso,
  sendTelegramMessage,
  sendTelegramPhoto,
  TelegramSendError,
} from '@/lib/telegram/sendDailyFinanceReport';
import {
  beginReportDispatch,
  claimReportDelivery,
  completeReportDelivery,
  describeUnknownError,
  resolveDeliveryKey,
  retryReportBuild,
  type ReportDeliveryClaim,
} from '@/lib/telegram/reportDelivery';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Stop starting new build/Telegram attempts once less than this much of
// maxDuration remains, leaving time to record the outcome in the ledger.
const FINALIZE_RESERVE_MS = 15_000;
const MIN_CRON_SECRET_LENGTH = 16;
const CRON_SECRET_PATTERN = /^[A-Za-z0-9._~-]+$/;

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set('cache-control', 'no-store, no-cache, max-age=0, must-revalidate');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');

  return Response.json(body, {
    ...init,
    headers,
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

interface TelegramReportTarget {
  key: TelegramReportTargetKey;
  chatId: string;
  clubId: string;
}

function getTelegramReportTargets(): TelegramReportTarget[] {
  const targets = TELEGRAM_REPORT_TARGET_ENV.flatMap(({ key, chatEnvName, clubEnvName }) => {
    const chatId = process.env[chatEnvName];
    const clubId = process.env[clubEnvName];

    if (!chatId && !clubId) return [];
    if (!chatId || !clubId) {
      throw new Error(`Missing ${chatEnvName} or ${clubEnvName}`);
    }
    return [{ key, chatId, clubId }];
  });

  if (targets.length === 0) {
    throw new Error('No Telegram report targets configured');
  }

  return targets;
}

function filterTargets(
  targets: TelegramReportTarget[],
  targetKey: string | null,
): TelegramReportTarget[] {
  if (!targetKey) return targets;

  if (!isTelegramReportTargetKey(targetKey)) {
    throw new Error('target must be pixel, main, or bunker');
  }

  const selectedTarget = targets.find((target) => target.key === targetKey);
  if (!selectedTarget) {
    throw new Error(`Target ${targetKey} is not configured`);
  }

  return [selectedTarget];
}

function bearerMatches(authorization: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization ?? '');
  // timingSafeEqual requires equal lengths; compare against itself on a
  // mismatch so the rejection costs the same as a full comparison.
  if (actual.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(actual, expected);
}

function cronAuthorizationStatus(
  request: NextRequest,
): 'authorized' | 'unauthorized' | 'invalid_configuration' {
  const cronSecret = process.env.CRON_SECRET;

  if (
    !cronSecret
    || cronSecret.length < MIN_CRON_SECRET_LENGTH
    || !CRON_SECRET_PATTERN.test(cronSecret)
  ) {
    return 'invalid_configuration';
  }

  return bearerMatches(request.headers.get('authorization'), cronSecret)
    ? 'authorized'
    : 'unauthorized';
}

function logDeliveryEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, unknown>,
) {
  const entry = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  });

  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.info(entry);
}

function failurePayload(stage: string, error: unknown) {
  return {
    stage,
    message: describeUnknownError(error).slice(0, 1_000),
  };
}

async function finalizeClaim(
  supabase: ReturnType<typeof createServiceClient>,
  claim: Extract<ReportDeliveryClaim, { outcome: 'claimed' }>,
  input: {
    outcome: 'sent' | 'failed' | 'manual_review';
    telegramAttemptCount: number;
    attemptHistory: Array<Record<string, unknown>>;
    telegramResult?: Record<string, unknown> | null;
    error?: Record<string, unknown> | null;
    retryNotBefore?: string | null;
  },
) {
  await retryReportBuild(
    () => completeReportDelivery(supabase, {
      deliveryId: claim.deliveryId,
      claimToken: claim.claimToken,
      ...input,
    }),
    { attempts: 3, delayMs: 200 },
  );
}

export async function GET(request: NextRequest) {
  const authorizationStatus = cronAuthorizationStatus(request);

  if (authorizationStatus === 'invalid_configuration') {
    logDeliveryEvent('error', 'telegram_report_cron_auth_misconfigured', {
      cronSecretPresent: Boolean(process.env.CRON_SECRET),
      cronSecretLength: process.env.CRON_SECRET?.length ?? 0,
    });
    return jsonNoStore(
      { ok: false, error: 'CRON_SECRET must be a header-safe random string of at least 16 characters' },
      { status: 500 },
    );
  }

  if (authorizationStatus === 'unauthorized') {
    const authorization = request.headers.get('authorization');
    logDeliveryEvent('error', 'telegram_report_cron_auth_failed', {
      authorizationPresent: Boolean(authorization),
      bearerTokenLength: authorization?.startsWith('Bearer ')
        ? authorization.length - 'Bearer '.length
        : null,
      userAgent: request.headers.get('user-agent'),
    });
    return new Response('Unauthorized', {
      status: 401,
      headers: {
        'cache-control': 'no-store, no-cache, max-age=0, must-revalidate',
      },
    });
  }

  try {
    const requestStartedAt = Date.now();
    const deadlineAt = requestStartedAt + maxDuration * 1_000 - FINALIZE_RESERVE_MS;
    const requestedDate = request.nextUrl.searchParams.get('date');
    const dryRun = request.nextUrl.searchParams.get('dryRun') === '1';
    const targetKey = request.nextUrl.searchParams.get('target');
    const force = request.nextUrl.searchParams.get('force');
    const requestId = request.nextUrl.searchParams.get('requestId');

    if (requestedDate !== null && !isIsoDate(requestedDate)) {
      return jsonNoStore({ ok: false, error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }

    let deliveryKey: string;
    try {
      deliveryKey = resolveDeliveryKey({
        force,
        requestId,
        requestedDate,
        targetKey,
        dryRun,
      });
    } catch (error) {
      return jsonNoStore({ ok: false, error: describeUnknownError(error) }, { status: 400 });
    }

    const targets = filterTargets(getTelegramReportTargets(), targetKey);
    const supabase = createServiceClient();

    // Each club has its own business day. Without a date, report that club's
    // last closed business day. A scheduled (non-forced) send for an explicit
    // date must also be for a closed day: a still-open day would burn the
    // one-per-day `scheduled` ledger slot on a partial report.
    const now = new Date(requestStartedAt);
    const scheduledDelivery = !dryRun && force !== '1';
    const resolvedTargets = await Promise.all(targets.map(async (target) => {
      if (requestedDate !== null && !scheduledDelivery) {
        return { target, businessDate: requestedDate, currentBusinessDate: null };
      }
      try {
        const startHour = await retryReportBuild(
          () => getClubBusinessDayStartHour(supabase, target.clubId),
          { attempts: 3, delayMs: 200, deadlineAt },
        );
        return {
          target,
          businessDate: requestedDate ?? previousClubBusinessDateIso(now, startHour),
          currentBusinessDate: serverTodayIso(now, startHour),
        };
      } catch (error) {
        return { target, businessDate: requestedDate, error };
      }
    }));

    const openDay = requestedDate === null ? undefined : resolvedTargets.find((resolved) =>
      typeof resolved.currentBusinessDate === 'string'
      && requestedDate >= resolved.currentBusinessDate);
    if (openDay) {
      return jsonNoStore({
        ok: false,
        error: `date must be before ${openDay.target.key}'s current business date `
          + `${openDay.currentBusinessDate}; use dryRun=1 to preview an open day`,
      }, { status: 400 });
    }

    const resolvedDates = new Set(resolvedTargets.map((resolved) => resolved.businessDate));
    const responseBusinessDate = requestedDate
      ?? (resolvedDates.size === 1 ? [...resolvedDates][0] : null);

    const businessDateFailure = (resolved: (typeof resolvedTargets)[number]) => {
      const failure = failurePayload('business_date', 'error' in resolved ? resolved.error : null);
      logDeliveryEvent('error', 'telegram_report_business_date_failed', {
        target: resolved.target.key,
        error: failure.message,
      });
      return {
        ok: false,
        target: resolved.target.key,
        businessDate: resolved.businessDate,
        ...failure,
      };
    };

    const buildReport = (target: TelegramReportTarget, businessDate: string) => retryReportBuild(
      () => buildDailyFinanceTelegramReport(supabase, {
        businessDate,
        chatId: target.chatId,
        clubId: target.clubId,
      }),
      { deadlineAt },
    );

    if (dryRun) {
      const reports = await Promise.all(resolvedTargets.map(async (resolved) => {
        if ('error' in resolved || resolved.businessDate === null) {
          return businessDateFailure(resolved);
        }
        const { target, businessDate } = resolved;

        try {
          const report = await buildReport(target, businessDate);
          return {
            ok: true,
            target: target.key,
            businessDate: report.businessDate,
            message: report.message,
            caption: report.caption,
            image: {
              format: report.imagePng ? 'png' : 'text-fallback',
              fileName: report.imagePng ? report.imageFileName : null,
              bytes: report.imagePng?.byteLength ?? 0,
            },
          };
        } catch (error) {
          return {
            ok: false,
            target: target.key,
            businessDate,
            error: describeUnknownError(error),
          };
        }
      }));
      const hasFailure = reports.some((report) => !report.ok);

      return jsonNoStore({
        ok: !hasFailure,
        dryRun: true,
        businessDate: responseBusinessDate,
        reports,
      }, { status: hasFailure ? 500 : 200 });
    }

    const botToken = requireEnv('TELEGRAM_BOT_TOKEN');
    const results = await Promise.all(resolvedTargets.map(async (resolved) => {
      if ('error' in resolved || resolved.businessDate === null) {
        return businessDateFailure(resolved);
      }
      const { target, businessDate } = resolved;
      let claim: ReportDeliveryClaim;
      let claimAttempts = 0;

      try {
        claim = await retryReportBuild(
          () => {
            claimAttempts += 1;
            return claimReportDelivery(supabase, {
              businessDate,
              targetKey: target.key,
              clubId: target.clubId,
              chatId: target.chatId,
              deliveryKey,
            });
          },
          { attempts: 3, delayMs: 250, deadlineAt },
        );
      } catch (error) {
        const failure = failurePayload('claim', error);
        logDeliveryEvent('error', 'telegram_report_delivery_claim_failed', {
          businessDate,
          target: target.key,
          deliveryKey,
          error: failure.message,
        });
        return { ok: false, target: target.key, businessDate, ...failure };
      }

      if (claim.outcome === 'already_sent') {
        logDeliveryEvent('info', 'telegram_report_delivery_skipped', {
          businessDate,
          target: target.key,
          deliveryId: claim.deliveryId,
          reason: 'already_sent',
        });
        return {
          ok: true,
          target: target.key,
          businessDate,
          deliveryId: claim.deliveryId,
          status: 'already_sent',
          format: claim.telegramResult.deliveryType === 'photo'
            || claim.telegramResult.deliveryType === 'text'
            ? claim.telegramResult.deliveryType
            : null,
          skipped: true,
          sentAt: claim.sentAt,
          telegram: claim.telegramResult,
        };
      }

      if (claim.outcome === 'in_progress' && claimAttempts > 1) {
        // An earlier claim attempt errored, so it may have committed with its
        // response lost: this invocation could own the lease it now sees as
        // in progress. Nothing was sent; report a failure so the run is not
        // mistaken for a success, and let the lease expire for recovery.
        logDeliveryEvent('warn', 'telegram_report_delivery_claim_ambiguous', {
          businessDate,
          target: target.key,
          deliveryId: claim.deliveryId,
          claimAttempts,
          claimExpiresAt: claim.claimExpiresAt,
        });
        return {
          ok: false,
          target: target.key,
          businessDate,
          deliveryId: claim.deliveryId,
          status: 'in_progress',
          stage: 'claim',
          message: 'Delivery claim was retried and is now in progress; its owner is unknown',
          claimExpiresAt: claim.claimExpiresAt,
        };
      }

      if (claim.outcome === 'in_progress') {
        logDeliveryEvent('info', 'telegram_report_delivery_skipped', {
          businessDate,
          target: target.key,
          deliveryId: claim.deliveryId,
          reason: 'in_progress',
          claimExpiresAt: claim.claimExpiresAt,
        });
        return {
          ok: true,
          target: target.key,
          businessDate,
          deliveryId: claim.deliveryId,
          status: 'in_progress',
          skipped: true,
          claimExpiresAt: claim.claimExpiresAt,
        };
      }

      if (claim.outcome === 'retry_deferred') {
        logDeliveryEvent('info', 'telegram_report_delivery_skipped', {
          businessDate,
          target: target.key,
          deliveryId: claim.deliveryId,
          reason: 'retry_deferred',
          retryNotBefore: claim.retryNotBefore,
        });
        return {
          ok: true,
          target: target.key,
          businessDate,
          deliveryId: claim.deliveryId,
          status: 'retry_deferred',
          skipped: true,
          retryNotBefore: claim.retryNotBefore,
        };
      }

      if (claim.outcome === 'manual_review') {
        logDeliveryEvent('error', 'telegram_report_delivery_manual_review', {
          businessDate,
          target: target.key,
          deliveryId: claim.deliveryId,
          dispatchStartedAt: claim.dispatchStartedAt,
          error: claim.lastError,
        });
        return {
          ok: false,
          target: target.key,
          businessDate,
          deliveryId: claim.deliveryId,
          status: 'manual_review',
          stage: 'manual_review',
          dispatchStartedAt: claim.dispatchStartedAt,
          error: claim.lastError,
        };
      }

      logDeliveryEvent('info', 'telegram_report_delivery_claimed', {
        businessDate,
        target: target.key,
        deliveryId: claim.deliveryId,
        claimCount: claim.claimCount,
      });

      let report;
      try {
        report = await buildReport(target, businessDate);
      } catch (error) {
        const failure = failurePayload('build', error);
        const attemptHistory = [{
          stage: 'build',
          outcome: 'failed',
          timestamp: new Date().toISOString(),
          error: failure.message,
        }];
        let ledgerFinalized = true;

        try {
          await finalizeClaim(supabase, claim, {
            outcome: 'failed',
            telegramAttemptCount: 0,
            attemptHistory,
            error: failure,
          });
        } catch (finalizeError) {
          ledgerFinalized = false;
          logDeliveryEvent('error', 'telegram_report_delivery_finalize_failed', {
            businessDate,
            target: target.key,
            deliveryId: claim.deliveryId,
            error: describeUnknownError(finalizeError),
          });
        }

        logDeliveryEvent('error', 'telegram_report_delivery_failed', {
          businessDate,
          target: target.key,
          deliveryId: claim.deliveryId,
          stage: 'build',
          error: failure.message,
          ledgerFinalized,
        });
        return {
          ok: false,
          target: target.key,
          businessDate,
          deliveryId: claim.deliveryId,
          ledgerFinalized,
          ...failure,
        };
      }

      try {
        await retryReportBuild(
          () => beginReportDispatch(supabase, {
            deliveryId: claim.deliveryId,
            claimToken: claim.claimToken,
          }),
          { attempts: 3, delayMs: 200 },
        );
        logDeliveryEvent('info', 'telegram_report_dispatch_started', {
          businessDate,
          target: target.key,
          deliveryId: claim.deliveryId,
        });
      } catch (error) {
        const failure = failurePayload('begin_dispatch', error);
        logDeliveryEvent('error', 'telegram_report_dispatch_start_failed', {
          businessDate,
          target: target.key,
          deliveryId: claim.deliveryId,
          error: failure.message,
        });
        return {
          ok: false,
          target: target.key,
          businessDate,
          deliveryId: claim.deliveryId,
          ledgerStateUnknown: true,
          ...failure,
        };
      }

      try {
        const deliveryType = report.imagePng ? 'photo' : 'text';
        const telegram = report.imagePng
          ? await sendTelegramPhoto({
              botToken,
              chatId: report.chatId,
              imagePng: report.imagePng,
              imageFileName: report.imageFileName,
              caption: report.caption,
              deadlineAt,
            })
          : await sendTelegramMessage({
              botToken,
              chatId: report.chatId,
              text: report.message,
              deadlineAt,
            });
        const telegramResult = {
          deliveryType,
          messageId: telegram.result.message_id,
          chatId: telegram.result.chat.id,
          chatTitle: telegram.result.chat.title ?? null,
          chatType: telegram.result.chat.type,
          telegramDate: telegram.result.date,
        };

        try {
          await finalizeClaim(supabase, claim, {
            outcome: 'sent',
            telegramAttemptCount: telegram.attempts.length,
            attemptHistory: telegram.attempts,
            telegramResult,
          });
        } catch (error) {
          const failure = failurePayload('finalize', error);
          logDeliveryEvent('error', 'telegram_report_delivery_finalize_failed', {
            businessDate,
            target: target.key,
            deliveryId: claim.deliveryId,
            error: failure.message,
          });
          return {
            ok: false,
            target: target.key,
            businessDate,
            deliveryId: claim.deliveryId,
            telegramDelivered: true,
            ...failure,
          };
        }

        logDeliveryEvent('info', 'telegram_report_delivery_sent', {
          businessDate,
          target: target.key,
          deliveryId: claim.deliveryId,
          messageId: telegram.result.message_id,
          attempts: telegram.attempts.length,
        });
        return {
          ok: true,
          target: target.key,
          businessDate: report.businessDate,
          deliveryId: claim.deliveryId,
          status: 'sent',
          format: deliveryType,
          messageId: telegram.result.message_id,
          telegramChatId: telegram.result.chat.id,
          telegramChatTitle: telegram.result.chat.title ?? null,
          telegramChatType: telegram.result.chat.type,
          telegramDate: telegram.result.date,
          attempts: telegram.attempts.length,
        };
      } catch (error) {
        const telegramAttempts = error instanceof TelegramSendError ? error.attempts : [];
        const requiresManualReview = !(error instanceof TelegramSendError)
          || error.requiresManualReview;
        const retryNotBefore = !requiresManualReview
          && error instanceof TelegramSendError
          && error.retryAfterSeconds !== null
          ? new Date(Date.now() + error.retryAfterSeconds * 1_000).toISOString()
          : null;
        const failure = {
          ...failurePayload('telegram', error),
          retryable: error instanceof TelegramSendError ? error.retryable : true,
          requiresManualReview,
        };
        let ledgerFinalized = true;

        try {
          await finalizeClaim(supabase, claim, {
            outcome: requiresManualReview ? 'manual_review' : 'failed',
            telegramAttemptCount: telegramAttempts.length,
            attemptHistory: telegramAttempts,
            error: failure,
            retryNotBefore,
          });
        } catch (finalizeError) {
          ledgerFinalized = false;
          logDeliveryEvent('error', 'telegram_report_delivery_finalize_failed', {
            businessDate,
            target: target.key,
            deliveryId: claim.deliveryId,
            error: describeUnknownError(finalizeError),
          });
        }

        logDeliveryEvent('error', 'telegram_report_delivery_failed', {
          businessDate,
          target: target.key,
          deliveryId: claim.deliveryId,
          stage: 'telegram',
          attempts: telegramAttempts.length,
          error: failure.message,
          ledgerFinalized,
        });
        return {
          ok: false,
          target: target.key,
          businessDate,
          deliveryId: claim.deliveryId,
          attempts: telegramAttempts.length,
          ledgerFinalized,
          status: requiresManualReview ? 'manual_review' : 'failed',
          retryNotBefore,
          ...failure,
        };
      }
    }));
    const hasFailure = results.some((result) => !result.ok);
    const singleResult = results.length === 1 ? results[0] : null;
    const singleStatus = singleResult && 'status' in singleResult
      ? singleResult.status
      : hasFailure ? 'failed' : null;
    const singleFormat = singleResult && 'format' in singleResult
      && (singleResult.format === 'photo' || singleResult.format === 'text')
      ? singleResult.format
      : null;

    logDeliveryEvent(hasFailure ? 'error' : 'info', 'telegram_report_delivery_batch_completed', {
      businessDate: responseBusinessDate,
      force: force === '1',
      targets: results.map((result) => ({
        target: result.target,
        ok: result.ok,
        status: 'status' in result ? result.status : 'failed',
      })),
    });

    return jsonNoStore({
      ok: !hasFailure,
      businessDate: responseBusinessDate,
      forced: force === '1',
      status: singleStatus,
      format: singleFormat,
      sent: results,
    }, { status: hasFailure ? 500 : 200 });
  } catch (error) {
    logDeliveryEvent('error', 'telegram_report_delivery_request_failed', {
      error: describeUnknownError(error).slice(0, 1_000),
    });
    return jsonNoStore(
      {
        ok: false,
        error: describeUnknownError(error),
      },
      { status: 500 },
    );
  }
}
