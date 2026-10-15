import { describe, expect, it } from 'vitest';
import {
  exhaustedModels,
  GEMINI_MODEL_CHAIN,
  isDailyQuotaError,
  nextQuotaReset,
  quotaDate,
  summarizeGeminiQuota,
} from './geminiQuota';

describe('quota day', () => {
  it('uses the Pacific calendar day', () => {
    // 05:00 UTC on Oct 16 is still Oct 15 in California (UTC-7 in October).
    expect(quotaDate(new Date('2026-10-16T05:00:00Z'))).toBe('2026-10-15');
    expect(quotaDate(new Date('2026-10-16T08:00:00Z'))).toBe('2026-10-16');
  });

  it('resets at the next Pacific midnight', () => {
    expect(nextQuotaReset(new Date('2026-10-16T05:00:00Z')).toISOString()).toBe('2026-10-16T07:00:00.000Z');
  });
});

describe('summarizeGeminiQuota', () => {
  it('starts the day with every free request available', () => {
    const summary = summarizeGeminiQuota([]);
    expect(summary.requestsLeft).toBe(1100);
    expect(summary.questionsLeft).toBe(366);
    expect(summary.currentModel).toMatchObject({ model: 'gemini-3.8-flash', remaining: 20 });
    expect(summary.usingFallback).toBe(false);
  });

  it('moves to the next model once one is used up or rejected', () => {
    const summary = summarizeGeminiQuota([
      { model: 'gemini-3.8-flash', requests: 25, exhausted: false },
      { model: 'gemini-3.7-flash', requests: 3, exhausted: true },
      { model: 'gemini-3.6-flash', requests: 8, exhausted: false },
    ]);
    expect(summary.currentModel).toMatchObject({ model: 'gemini-3.6-flash', remaining: 12, limit: 20 });
    expect(summary.usingFallback).toBe(true);
    expect(summary.requestsLeft).toBe(1100 - 20 - 20 - 8);
  });

  it('reports nothing left when every model is exhausted', () => {
    const rows = GEMINI_MODEL_CHAIN.map((model) => ({ model, requests: 0, exhausted: true }));
    const summary = summarizeGeminiQuota(rows);
    expect(summary).toMatchObject({ requestsLeft: 0, questionsLeft: 0, currentModel: null });
    expect(exhaustedModels(rows)).toEqual(GEMINI_MODEL_CHAIN);
  });
});

describe('isDailyQuotaError', () => {
  it('distinguishes daily limits from per-minute limits', () => {
    expect(isDailyQuotaError('Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier')).toBe(true);
    expect(isDailyQuotaError('quotaId: GenerateRequestsPerMinutePerProjectPerModel-FreeTier')).toBe(false);
  });
});
