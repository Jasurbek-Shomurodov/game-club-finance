import { describe, expect, it } from 'vitest';
import type { AssistantProvider } from 'hoggish-assistant/server';
import { APP_TIME_ZONE } from '@/lib/utils';
import { DEFAULT_DAILY_REQUEST_LIMIT, assistantDailyRequestLimit, withDailyRequestCap } from './dailyCap';

const provider = (models: { dailyLimit?: number }[]) => ({
  name: 'anthropic', configured: true, quotaTimeZone: 'America/Los_Angeles', maxRetries: 2, models,
}) as unknown as AssistantProvider;

describe('assistantDailyRequestLimit', () => {
  it('caps paid models by default', () => {
    expect(assistantDailyRequestLimit({})).toBe(DEFAULT_DAILY_REQUEST_LIMIT);
    expect(assistantDailyRequestLimit({ ASSISTANT_DAILY_REQUEST_LIMIT: ' ' })).toBe(DEFAULT_DAILY_REQUEST_LIMIT);
  });

  it('reads the deployment setting, where 0 removes the cap', () => {
    expect(assistantDailyRequestLimit({ ASSISTANT_DAILY_REQUEST_LIMIT: '50' })).toBe(50);
    expect(assistantDailyRequestLimit({ ASSISTANT_DAILY_REQUEST_LIMIT: '0' })).toBe(0);
  });

  it('keeps the cap when the setting is unusable', () => {
    for (const value of ['many', '-1', '1.5']) {
      expect(assistantDailyRequestLimit({ ASSISTANT_DAILY_REQUEST_LIMIT: value })).toBe(DEFAULT_DAILY_REQUEST_LIMIT);
    }
  });
});

describe('withDailyRequestCap', () => {
  it('limits every untracked model and resets on the club day', () => {
    const capped = withDailyRequestCap(provider([{}, {}]), 300);
    expect(capped.models.map((entry) => entry.dailyLimit)).toEqual([300, 300]);
    expect(capped.quotaTimeZone).toBe(APP_TIME_ZONE);
  });

  it('never raises a limit a model already has', () => {
    const mixed = withDailyRequestCap(provider([{ dailyLimit: 20 }, {}]), 300);
    expect(mixed.models.map((entry) => entry.dailyLimit)).toEqual([20, 300]);
  });

  it('leaves the free chain on its own daily reset', () => {
    const free = provider([{ dailyLimit: 20 }]);
    expect(withDailyRequestCap(free, 300)).toBe(free);
  });

  it('leaves the provider alone when the cap is off', () => {
    const untouched = provider([{}]);
    expect(withDailyRequestCap(untouched, 0)).toBe(untouched);
  });
});
