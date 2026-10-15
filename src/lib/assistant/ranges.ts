import { monthRange } from '@/lib/utils';

export const MAX_RANGE_DAYS = 366;
export const MAX_TREND_MONTHS = 24;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type RangeResult = { from: string; to: string } | { error: string };

/**
 * Resolves a requested period against the club's business date. Missing
 * bounds default to the current business month; the end never passes today.
 */
export function resolveRange(from: string | undefined, to: string | undefined, businessToday: string): RangeResult {
  const defaults = monthRange(businessToday.slice(0, 7));
  const start = from ?? defaults.from;
  let end = to ?? businessToday;
  if (!isRealIsoDate(start) || !isRealIsoDate(end)) return { error: 'Dates must be real YYYY-MM-DD dates.' };
  if (end > businessToday) end = businessToday;
  if (start > end) return { error: `The period starts after its end (business today is ${businessToday}).` };
  if (dayDiff(start, end) + 1 > MAX_RANGE_DAYS) {
    return { error: `The period is longer than ${MAX_RANGE_DAYS} days. Use the monthly dataset or a shorter period.` };
  }
  return { from: start, to: end };
}

/** First day of the month `count - 1` months before the business month, through today. */
export function trendWindow(businessToday: string, count: number): { from: string; to: string } {
  const [year, month] = businessToday.split('-').map(Number);
  const absolute = year * 12 + month - 1 - (count - 1);
  const first = `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, '0')}-01`;
  return { from: first, to: businessToday };
}

export function clampMonths(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 12;
  return Math.min(MAX_TREND_MONTHS, Math.max(1, Math.round(value)));
}
