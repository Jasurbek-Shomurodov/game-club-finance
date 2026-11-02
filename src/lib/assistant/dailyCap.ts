import type { AssistantProvider } from 'hoggish-assistant/server';
import { APP_TIME_ZONE } from '@/lib/utils';

/** About 100 questions a day across the deployment; a question takes about three requests. */
export const DEFAULT_DAILY_REQUEST_LIMIT = 300;

/** Requests per model per day; ASSISTANT_DAILY_REQUEST_LIMIT overrides it and 0 removes the cap. */
export function assistantDailyRequestLimit(env: Record<string, string | undefined>): number {
  const value = env.ASSISTANT_DAILY_REQUEST_LIMIT?.trim();
  if (!value) return DEFAULT_DAILY_REQUEST_LIMIT;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_DAILY_REQUEST_LIMIT;
}

/**
 * Caps paid models with the library's daily limits, so a loop or a heavy day
 * cannot run up the bill. Models that already carry a free-tier limit keep it.
 */
export function withDailyRequestCap(provider: AssistantProvider, limit: number): AssistantProvider {
  // The free Gemini chain keeps Google's own daily reset.
  if (limit === 0 || provider.models.every((entry) => entry.dailyLimit !== undefined)) return provider;
  return {
    ...provider,
    quotaTimeZone: APP_TIME_ZONE,
    models: provider.models.map((entry) => (entry.dailyLimit === undefined ? { ...entry, dailyLimit: limit } : entry)),
  };
}
