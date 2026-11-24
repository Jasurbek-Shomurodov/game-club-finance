import type { ReserveActivity } from './ownerReserve';

/**
 * The reserve overview's period control and its over-time chart: what the
 * reserve held and what moved, bucketed by day, week or month over a chosen
 * window that ends on the club's business today.
 *
 * Kept apart from `ownerReserve.ts`; it reads only `reserveActivity` rows.
 */

export type ReservePeriod = '30d' | '90d' | '1y' | 'all';
export const RESERVE_PERIODS: readonly ReservePeriod[] = ['30d', '90d', '1y', 'all'];

export type ReserveBucketUnit = 'day' | 'week' | 'month';

export interface ReserveBucket {
  /** Same as `from`. */
  key: string;
  /** First day of the bucket inside the window (YYYY-MM-DD). */
  from: string;
  /** Last day of the bucket, never after the window's end. */
  to: string;
  /** What the reserve holds at the end of `to`, as one pot, never below zero. */
  held: number;
  /** Money put in during the bucket. */
  deposited: number;
  /** Money that left: returns to profit plus purchases. */
  withdrawn: number;
  /** History rows in the bucket, exchanges included: what "Show N entries" lists. */
  count: number;
}

export interface ReserveExplorerSeries {
  unit: ReserveBucketUnit;
  buckets: ReserveBucket[];
  /** What the reserve held before the window (0 when the window starts at the first activity). */
  openingHeld: number;
  /** The window's first and last day; null when there is no activity. */
  from: string | null;
  to: string;
}

/** ISO day arithmetic in UTC, so the result never depends on the device's time zone. */
const toUtc = (iso: string) => {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
const fromUtc = (time: number) => new Date(time).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

export function addIsoDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY_MS);
}

/** Days from `from` to `to` (0 when they are the same day). */
const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);

/**
 * The first day of a period that ends on `throughDate` (inclusive: 30 days is
 * `throughDate` and the 29 before it; a year starts the day after the same date
 * a year earlier). Null for all time.
 */
export function reservePeriodStart(period: ReservePeriod, throughDate: string): string | null {
  if (period === '30d') return addIsoDays(throughDate, -29);
  if (period === '90d') return addIsoDays(throughDate, -89);
  if (period === '1y') {
    const [year, month, day] = throughDate.split('-').map(Number);
    // The same date a year earlier (29 February falls back to the 28th), then the day after it.
    const lastDayThen = new Date(Date.UTC(year - 1, month, 0)).getUTCDate();
    return addIsoDays(fromUtc(Date.UTC(year - 1, month - 1, Math.min(day, lastDayThen))), 1);
  }
  return null;
}

/** Days for a window of up to 92 days, Monday weeks up to 370 days, months beyond. */
export function reserveBucketUnit(firstDay: string, lastDay: string): ReserveBucketUnit {
  const span = daysBetween(firstDay, lastDay) + 1;
  if (span <= 92) return 'day';
  if (span <= 370) return 'week';
  return 'month';
}

/** The first day of the calendar bucket that holds `day`. */
function bucketStart(day: string, unit: ReserveBucketUnit): string {
  if (unit === 'day') return day;
  if (unit === 'month') return `${day.slice(0, 7)}-01`;
  const weekday = new Date(toUtc(day)).getUTCDay();
  return addIsoDays(day, -((weekday + 6) % 7));
}

/** The last day of the calendar bucket that starts on `start`. */
function bucketEnd(start: string, unit: ReserveBucketUnit): string {
  if (unit === 'day') return start;
  if (unit === 'week') return addIsoDays(start, 6);
  const [year, month] = start.split('-').map(Number);
  return fromUtc(Date.UTC(year, month, 0));
}

/** The day a row counts on: its own date, or today when it is dated later. */
const effectiveDay = (row: Pick<ReserveActivity, 'date'>, throughDate: string) => (row.date > throughDate ? throughDate : row.date);

/** What a row does to the balance: deposits add, returns and purchases take away, exchanges change nothing. */
const balanceChange = (row: ReserveActivity) => (row.kind === 'deposit' ? row.amount : row.kind === 'exchange' ? 0 : -row.amount);

/**
 * The reserve over a period, bucket by bucket, from the later of the period's
 * start and the first activity through `throughDate` (the club's business
 * today). The balance follows `reserveDailySeries`: one pot, exchanges move
 * nothing, activity dated after today counts on today, and a running total
 * that dips below zero shows as empty. Empty buckets are filled in.
 */
export function reserveExplorerSeries(
  activity: readonly ReserveActivity[],
  throughDate: string,
  period: ReservePeriod,
): ReserveExplorerSeries {
  if (activity.length === 0) return { unit: 'day', buckets: [], openingHeld: 0, from: null, to: throughDate };

  let firstDay = throughDate;
  for (const row of activity) {
    const day = effectiveDay(row, throughDate);
    if (day < firstDay) firstDay = day;
  }
  const periodStart = reservePeriodStart(period, throughDate);
  const windowStart = periodStart && periodStart > firstDay ? periodStart : firstDay;
  const unit = reserveBucketUnit(windowStart, throughDate);

  let running = 0;
  const byBucket = new Map<string, { change: number; deposited: number; withdrawn: number; count: number }>();
  for (const row of activity) {
    const day = effectiveDay(row, throughDate);
    if (day < windowStart) {
      running += balanceChange(row);
      continue;
    }
    const start = bucketStart(day, unit);
    const key = start < windowStart ? windowStart : start;
    const bucket = byBucket.get(key) ?? { change: 0, deposited: 0, withdrawn: 0, count: 0 };
    bucket.change += balanceChange(row);
    if (row.kind === 'deposit') bucket.deposited += row.amount;
    else if (row.kind !== 'exchange') bucket.withdrawn += row.amount;
    bucket.count += 1;
    byBucket.set(key, bucket);
  }

  const openingHeld = Math.max(0, running);
  const buckets: ReserveBucket[] = [];
  for (let start = bucketStart(windowStart, unit); start <= throughDate; start = addIsoDays(bucketEnd(start, unit), 1)) {
    const from = start < windowStart ? windowStart : start;
    const end = bucketEnd(start, unit);
    const to = end > throughDate ? throughDate : end;
    const moved = byBucket.get(from);
    running += moved?.change ?? 0;
    buckets.push({
      key: from,
      from,
      to,
      held: Math.max(0, running),
      deposited: moved?.deposited ?? 0,
      withdrawn: moved?.withdrawn ?? 0,
      count: moved?.count ?? 0,
    });
  }
  return { unit, buckets, openingHeld, from: windowStart, to: throughDate };
}

export interface ReserveWindowSummary {
  /** What the reserve holds at the window's end. */
  held: number;
  /** `held` minus what it held before the window. */
  change: number;
  deposited: number;
  withdrawn: number;
  count: number;
}

/** The whole window at a glance: the balance at its end, how it changed and everything that moved. */
export function reserveWindowSummary(series: ReserveExplorerSeries): ReserveWindowSummary {
  const held = series.buckets.length ? series.buckets[series.buckets.length - 1].held : series.openingHeld;
  const summary = { held, change: held - series.openingHeld, deposited: 0, withdrawn: 0, count: 0 };
  for (const bucket of series.buckets) {
    summary.deposited += bucket.deposited;
    summary.withdrawn += bucket.withdrawn;
    summary.count += bucket.count;
  }
  return summary;
}

/**
 * The history rows dated `from` to `to` (inclusive), counting a row dated
 * after `throughDate` on `throughDate`, as the buckets do, so a bucket's
 * `count` is exactly what the history then lists. Keeps the incoming order.
 */
export function reserveActivityInRange<T extends ReserveActivity>(
  activity: readonly T[],
  from: string,
  to: string,
  throughDate: string,
): T[] {
  return activity.filter((row) => {
    const day = effectiveDay(row, throughDate);
    return day >= from && day <= to;
  });
}

/** The rows of a period ending on `throughDate`; all of them for all time. */
export function reserveActivityInPeriod<T extends ReserveActivity>(
  activity: readonly T[],
  period: ReservePeriod,
  throughDate: string,
): T[] {
  const start = reservePeriodStart(period, throughDate);
  return start ? reserveActivityInRange(activity, start, throughDate, throughDate) : [...activity];
}

export interface ReserveHistoryFilter {
  kind: 'all' | ReserveActivity['kind'];
  /** Both or neither: the dates the history is narrowed to. */
  from?: string;
  to?: string;
  /** Only purchases of this expense category. */
  category?: string;
}

/** The history list under a filter: dates first, then the category (purchases only), then the kind. */
export function filterReserveHistory<T extends ReserveActivity>(
  activity: readonly T[],
  filter: ReserveHistoryFilter,
  throughDate: string,
): T[] {
  let rows: T[] = filter.from && filter.to ? reserveActivityInRange(activity, filter.from, filter.to, throughDate) : [...activity];
  if (filter.category !== undefined) rows = rows.filter((row) => row.kind === 'purchase' && row.category === filter.category);
  if (filter.kind !== 'all') rows = rows.filter((row) => row.kind === filter.kind);
  return rows;
}
