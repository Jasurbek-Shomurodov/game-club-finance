import type { SupabaseClient } from '@supabase/supabase-js';

const FORCE_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  if (error && typeof error === 'object') {
    const details = error as Record<string, unknown>;
    const preferredFields = ['message', 'details', 'hint', 'code']
      .filter((field) => details[field] !== undefined)
      .map((field) => `${field}: ${String(details[field])}`);

    if (preferredFields.length > 0) return preferredFields.join('; ');

    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown object error';
    }
  }

  return String(error);
}

export type ReportDeliveryClaim =
  | {
      outcome: 'claimed';
      deliveryId: string;
      status: 'claimed';
      claimToken: string;
      claimCount: number;
      claimExpiresAt: string;
    }
  | {
      outcome: 'already_sent';
      deliveryId: string;
      status: 'sent';
      claimCount: number;
      sentAt: string;
      telegramResult: Record<string, unknown>;
    }
  | {
      outcome: 'in_progress';
      deliveryId: string;
      status: 'claimed' | 'dispatching';
      claimCount: number;
      claimExpiresAt: string;
    }
  | {
      outcome: 'retry_deferred';
      deliveryId: string;
      status: 'failed';
      claimCount: number;
      retryNotBefore: string;
    }
  | {
      outcome: 'manual_review';
      deliveryId: string;
      status: 'manual_review';
      claimCount: number;
      dispatchStartedAt: string;
      lastError: Record<string, unknown> | null;
    };

export interface CompleteReportDeliveryInput {
  deliveryId: string;
  claimToken: string;
  outcome: 'sent' | 'failed' | 'manual_review';
  telegramAttemptCount: number;
  attemptHistory: Array<Record<string, unknown>>;
  telegramResult?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
  retryNotBefore?: string | null;
}

export function resolveDeliveryKey({
  force,
  requestId,
  requestedDate,
  targetKey,
  dryRun,
}: {
  force: string | null;
  requestId: string | null;
  requestedDate: string | null;
  targetKey: string | null;
  dryRun: boolean;
}): string {
  if (force !== null && force !== '1') {
    throw new Error('force must be 1 when provided');
  }

  if (force !== '1') {
    if (requestId !== null) {
      throw new Error('requestId is only valid with force=1');
    }
    return 'scheduled';
  }

  if (dryRun) throw new Error('force=1 cannot be combined with dryRun=1');
  if (!requestedDate || !targetKey) {
    throw new Error('force=1 requires explicit date and target parameters');
  }
  if (!requestId || !FORCE_REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error('force=1 requires requestId to be a UUID');
  }

  return `force:${requestId.toLowerCase()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseDeliveryClaim(value: unknown): ReportDeliveryClaim {
  if (!isRecord(value)) {
    throw new Error('Delivery claim returned an invalid payload');
  }

  const outcome = value.outcome;
  if (
    outcome !== 'claimed'
    && outcome !== 'already_sent'
    && outcome !== 'in_progress'
    && outcome !== 'retry_deferred'
    && outcome !== 'manual_review'
  ) {
    throw new Error('Delivery claim returned an unknown outcome');
  }

  if (typeof value.deliveryId !== 'string' || typeof value.claimCount !== 'number') {
    throw new Error('Delivery claim is missing required metadata');
  }

  if (outcome === 'claimed') {
    if (typeof value.claimToken !== 'string' || typeof value.claimExpiresAt !== 'string') {
      throw new Error('Claimed delivery is missing its lease metadata');
    }

    return {
      outcome,
      deliveryId: value.deliveryId,
      status: 'claimed',
      claimToken: value.claimToken,
      claimCount: value.claimCount,
      claimExpiresAt: value.claimExpiresAt,
    };
  }

  if (outcome === 'already_sent') {
    if (typeof value.sentAt !== 'string' || !isRecord(value.telegramResult)) {
      throw new Error('Completed delivery is missing its Telegram result');
    }

    return {
      outcome,
      deliveryId: value.deliveryId,
      status: 'sent',
      claimCount: value.claimCount,
      sentAt: value.sentAt,
      telegramResult: value.telegramResult,
    };
  }

  if (outcome === 'retry_deferred') {
    if (typeof value.retryNotBefore !== 'string') {
      throw new Error('Deferred delivery is missing its retry time');
    }

    return {
      outcome,
      deliveryId: value.deliveryId,
      status: 'failed',
      claimCount: value.claimCount,
      retryNotBefore: value.retryNotBefore,
    };
  }

  if (outcome === 'manual_review') {
    if (typeof value.dispatchStartedAt !== 'string') {
      throw new Error('Manual-review delivery is missing its dispatch time');
    }

    return {
      outcome,
      deliveryId: value.deliveryId,
      status: 'manual_review',
      claimCount: value.claimCount,
      dispatchStartedAt: value.dispatchStartedAt,
      lastError: isRecord(value.lastError) ? value.lastError : null,
    };
  }

  if (
    typeof value.claimExpiresAt !== 'string'
    || (value.status !== 'claimed' && value.status !== 'dispatching')
  ) {
    throw new Error('In-progress delivery is missing its lease expiration');
  }

  return {
    outcome,
    deliveryId: value.deliveryId,
    status: value.status,
    claimCount: value.claimCount,
    claimExpiresAt: value.claimExpiresAt,
  };
}

export async function beginReportDispatch(
  supabase: SupabaseClient,
  {
    deliveryId,
    claimToken,
    leaseSeconds = 300,
  }: {
    deliveryId: string;
    claimToken: string;
    leaseSeconds?: number;
  },
): Promise<void> {
  const { data, error } = await supabase.rpc('begin_telegram_report_dispatch', {
    p_delivery_id: deliveryId,
    p_claim_token: claimToken,
    p_lease_seconds: leaseSeconds,
  });

  if (error) throw error;
  if (data !== true) {
    throw new Error('Delivery claim expired before dispatch could begin');
  }
}

export async function claimReportDelivery(
  supabase: SupabaseClient,
  {
    businessDate,
    targetKey,
    clubId,
    chatId,
    deliveryKey,
    leaseSeconds = 300,
  }: {
    businessDate: string;
    targetKey: string;
    clubId: string;
    chatId: string;
    deliveryKey: string;
    leaseSeconds?: number;
  },
): Promise<ReportDeliveryClaim> {
  const { data, error } = await supabase.rpc('claim_telegram_report_delivery', {
    p_business_date: businessDate,
    p_target_key: targetKey,
    p_club_id: clubId,
    p_chat_id: chatId,
    p_delivery_key: deliveryKey,
    p_lease_seconds: leaseSeconds,
  });

  if (error) throw error;
  return parseDeliveryClaim(data);
}

export async function completeReportDelivery(
  supabase: SupabaseClient,
  input: CompleteReportDeliveryInput,
): Promise<void> {
  const { data, error } = await supabase.rpc('complete_telegram_report_delivery', {
    p_delivery_id: input.deliveryId,
    p_claim_token: input.claimToken,
    p_outcome: input.outcome,
    p_telegram_attempt_count: input.telegramAttemptCount,
    p_attempt_history: input.attemptHistory,
    p_telegram_result: input.telegramResult ?? null,
    p_error: input.error ?? null,
    p_retry_not_before: input.retryNotBefore ?? null,
  });

  if (error) throw error;
  if (data !== true) {
    throw new Error('Delivery claim expired before it could be finalized');
  }
}

export async function retryReportBuild<T>(
  build: () => Promise<T>,
  {
    attempts = 3,
    delayMs = 250,
    deadlineAt,
    now = Date.now,
    sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }: {
    attempts?: number;
    delayMs?: number;
    /** Epoch milliseconds after which no further retry is started. */
    deadlineAt?: number;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<T> {
  let lastError: unknown;
  let attempted = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    attempted = attempt;
    try {
      return await build();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const wait = delayMs * attempt;
      if (deadlineAt !== undefined && now() + wait >= deadlineAt) break;
      await sleep(wait);
    }
  }

  throw new Error(
    `Report build failed after ${attempted} attempt${attempted === 1 ? '' : 's'}: ${describeUnknownError(lastError)}`,
  );
}
