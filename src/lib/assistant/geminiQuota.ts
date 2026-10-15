/**
 * Free-tier Gemini models, strongest first, with their requests-per-day
 * limits from the project's AI Studio rate-limit page. Each model has its own
 * quota, so the assistant walks down this list as models run out.
 */
export const GEMINI_FREE_MODELS = [
  { model: 'gemini-3.8-flash', dailyLimit: 20 },
  { model: 'gemini-3.7-flash', dailyLimit: 20 },
  { model: 'gemini-3.6-flash', dailyLimit: 20 },
  { model: 'gemini-3.5-flash-lite', dailyLimit: 500 },
  { model: 'gemini-3.1-flash-lite', dailyLimit: 500 },
  { model: 'gemini-2.5-flash', dailyLimit: 20 },
  { model: 'gemini-2.5-flash-lite', dailyLimit: 20 },
] as const;

export const GEMINI_MODEL_CHAIN = GEMINI_FREE_MODELS.map((entry) => entry.model);

/** A typical question takes a data fetch or two plus the answer. */
export const REQUESTS_PER_QUESTION = 3;

const QUOTA_TIME_ZONE = 'America/Los_Angeles';

export interface ModelUsageRow {
  model: string;
  requests: number;
  exhausted: boolean;
}

export interface ModelQuota {
  model: string;
  limit: number;
  used: number;
  remaining: number;
}

export interface GeminiQuotaSummary {
  requestsLeft: number;
  requestsLimit: number;
  questionsLeft: number;
  /** The strongest model that still has quota; null when everything is used up. */
  currentModel: ModelQuota | null;
  /** True once the top model is used up and lighter models are answering. */
  usingFallback: boolean;
  resetsAt: string;
  models: ModelQuota[];
}

function zonedParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: QUOTA_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'), second: part('second') };
}

/** The quota day (YYYY-MM-DD in Pacific time) that `now` falls in. */
export function quotaDate(now = new Date()): string {
  const { year, month, day } = zonedParts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The next Pacific midnight, when Gemini daily quotas reset. */
export function nextQuotaReset(now = new Date()): Date {
  const { hour, minute, second } = zonedParts(now);
  const elapsed = ((hour * 60 + minute) * 60 + second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - elapsed + 24 * 60 * 60 * 1000);
}

export function summarizeGeminiQuota(rows: ModelUsageRow[], now = new Date()): GeminiQuotaSummary {
  const byModel = new Map(rows.map((row) => [row.model, row]));
  const models = GEMINI_FREE_MODELS.map(({ model, dailyLimit }) => {
    const row = byModel.get(model);
    const used = row?.exhausted ? dailyLimit : Math.min(dailyLimit, Math.max(0, Number(row?.requests ?? 0)));
    return { model, limit: dailyLimit, used, remaining: dailyLimit - used };
  });
  const requestsLeft = models.reduce((total, model) => total + model.remaining, 0);
  const currentIndex = models.findIndex((model) => model.remaining > 0);
  return {
    requestsLeft,
    requestsLimit: models.reduce((total, model) => total + model.limit, 0),
    questionsLeft: Math.floor(requestsLeft / REQUESTS_PER_QUESTION),
    currentModel: currentIndex === -1 ? null : models[currentIndex],
    usingFallback: currentIndex !== 0,
    resetsAt: nextQuotaReset(now).toISOString(),
    models,
  };
}

/** Models whose daily quota is known to be used up. */
export function exhaustedModels(rows: ModelUsageRow[]): string[] {
  return summarizeGeminiQuota(rows).models.filter((model) => model.remaining <= 0).map((model) => model.model);
}

/** Gemini reports which quota a 429 hit; only a per-day limit lasts until reset. */
export function isDailyQuotaError(message: string | undefined): boolean {
  return /per[\s_-]?day|PerDay|daily/i.test(message ?? '');
}
