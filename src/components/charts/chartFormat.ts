import { intlLocaleFor } from '@/lib/formatters';

const percentFormatters = new Map<string, Intl.NumberFormat>();

/** A 0-1 share as a whole percent in the app language ("42%", "42 %"). */
export function formatPercentShare(share: number, locale: string, digits = 0): string {
  const key = `${locale}:${digits}`;
  let formatter = percentFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(intlLocaleFor(locale), { style: 'percent', maximumFractionDigits: digits });
    } catch {
      formatter = new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: digits });
    }
    percentFormatters.set(key, formatter);
  }
  return formatter.format(Number.isFinite(share) ? share : 0);
}

/** Short Monday-first weekday names ("Mon", "Пн", "Du") in the app language. */
export function weekdayShortNames(locale: string): string[] {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(intlLocaleFor(locale), { weekday: 'short', timeZone: 'UTC' });
  } catch {
    formatter = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
  }
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, index) => formatter.format(new Date(Date.UTC(2024, 0, 1 + index))));
}
