import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  beginReportDispatch,
  claimReportDelivery,
  completeReportDelivery,
  describeUnknownError,
  resolveDeliveryKey,
  retryReportBuild,
} from './reportDelivery';

describe('describeUnknownError', () => {
  it('keeps Supabase error details instead of returning object Object', () => {
    expect(describeUnknownError({
      code: 'PGRST001',
      message: 'Database request failed',
      details: 'Connection was interrupted',
    })).toBe(
      'message: Database request failed; details: Connection was interrupted; code: PGRST001',
    );
  });
});

describe('retryReportBuild', () => {
  it('retries transient build failures before returning the report', async () => {
    const build = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ message: 'temporary database error' })
      .mockResolvedValue('report');
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(retryReportBuild(build, { sleep })).resolves.toBe('report');
    expect(build).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('returns a useful error after the final failed attempt', async () => {
    const build = vi.fn<() => Promise<string>>().mockRejectedValue({
      code: '57014',
      message: 'statement timeout',
    });

    await expect(retryReportBuild(build, {
      attempts: 2,
      sleep: async () => undefined,
    })).rejects.toThrow(
      'Report build failed after 2 attempts: message: statement timeout; code: 57014',
    );
  });

  it('does not start another attempt past the deadline', async () => {
    const build = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('slow query'));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(retryReportBuild(build, {
      sleep,
      now: () => 9_900,
      deadlineAt: 10_000,
    })).rejects.toThrow('Report build failed after 1 attempt: slow query');
    expect(build).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('resolveDeliveryKey', () => {
  it('uses one stable key for ordinary scheduled invocations', () => {
    expect(resolveDeliveryKey({
      force: null,
      requestId: null,
      requestedDate: null,
      targetKey: null,
      dryRun: false,
    })).toBe('scheduled');
  });

  it('requires a fully explicit and idempotent forced resend', () => {
    expect(() => resolveDeliveryKey({
      force: '1',
      requestId: null,
      requestedDate: '2026-08-26',
      targetKey: 'pixel',
      dryRun: false,
    })).toThrow('requestId to be a UUID');

    expect(() => resolveDeliveryKey({
      force: '1',
      requestId: '40c05af5-5a59-45ae-a891-19a18228a721',
      requestedDate: null,
      targetKey: 'pixel',
      dryRun: false,
    })).toThrow('requires explicit date and target');

    expect(() => resolveDeliveryKey({
      force: '1',
      requestId: '40c05af5-5a59-45ae-a891-19a18228a721',
      requestedDate: '2026-08-26',
      targetKey: 'pixel',
      dryRun: true,
    })).toThrow('cannot be combined with dryRun');
  });

  it('derives a reusable force key from the caller request id', () => {
    expect(resolveDeliveryKey({
      force: '1',
      requestId: '40C05AF5-5A59-45AE-A891-19A18228A721',
      requestedDate: '2026-08-26',
      targetKey: 'pixel',
      dryRun: false,
    })).toBe('force:40c05af5-5a59-45ae-a891-19a18228a721');
  });
});

describe('delivery ledger RPC helpers', () => {
  it('claims a delivery and validates its lease metadata', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        outcome: 'claimed',
        deliveryId: '40c05af5-5a59-45ae-a891-19a18228a721',
        status: 'claimed',
        claimToken: 'ce4801cd-cd1c-4d88-a860-b1dc41c03a26',
        claimCount: 1,
        claimExpiresAt: '2026-08-27T06:10:00.000Z',
      },
      error: null,
    });
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(claimReportDelivery(supabase, {
      businessDate: '2026-08-26',
      targetKey: 'pixel',
      clubId: '290c5c33-9dfa-464a-a072-ef5a231f5308',
      chatId: '-1001',
      deliveryKey: 'scheduled',
    })).resolves.toMatchObject({ outcome: 'claimed', claimCount: 1 });
    expect(rpc).toHaveBeenCalledWith('claim_telegram_report_delivery', expect.objectContaining({
      p_business_date: '2026-08-26',
      p_target_key: 'pixel',
      p_delivery_key: 'scheduled',
      p_lease_seconds: 300,
    }));
  });

  it('rejects a finalization that no longer owns the database lease', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(completeReportDelivery(supabase, {
      deliveryId: '40c05af5-5a59-45ae-a891-19a18228a721',
      claimToken: 'ce4801cd-cd1c-4d88-a860-b1dc41c03a26',
      outcome: 'failed',
      telegramAttemptCount: 1,
      attemptHistory: [{ outcome: 'network_error' }],
      error: { stage: 'telegram', message: 'fetch failed' },
    })).rejects.toThrow('claim expired');
  });

  it('durably starts dispatch through the token-checked RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = { rpc } as unknown as SupabaseClient;

    await expect(beginReportDispatch(supabase, {
      deliveryId: '40c05af5-5a59-45ae-a891-19a18228a721',
      claimToken: 'ce4801cd-cd1c-4d88-a860-b1dc41c03a26',
    })).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('begin_telegram_report_dispatch', {
      p_delivery_id: '40c05af5-5a59-45ae-a891-19a18228a721',
      p_claim_token: 'ce4801cd-cd1c-4d88-a860-b1dc41c03a26',
      p_lease_seconds: 300,
    });
  });
});
