import { describe, expect, it } from 'vitest';
import { reserveActivity, reserveDailySeries, type ReservePaidExpense, type ReserveLedgerEntry } from './ownerReserve';
import {
  addIsoDays,
  filterReserveHistory,
  reserveActivityInPeriod,
  reserveActivityInRange,
  reserveBucketUnit,
  reserveExplorerSeries,
  reservePeriodStart,
  reserveWindowSummary,
  type ReserveExplorerSeries,
} from './reserveExplorer';

const entry = (id: string, date: string, amount: number, kind: 'deposit' | 'return' = 'deposit', overrides: Partial<ReserveLedgerEntry> = {}): ReserveLedgerEntry => ({
  id, club_id: 'club', kind, period_month: `${date.slice(0, 7)}-01`, source: 'game_club', payment_method: 'cash',
  amount, comment: null, collection_date: null, entry_date: date, created_by: 'owner', created_at: `${date}T10:00:00Z`, ...overrides,
});
const purchase = (id: string, date: string, amount: number, category = 'rent'): ReservePaidExpense => ({
  id, date, amount, payment_source: 'game_club', payment_method: 'cash', category, comment: null, created_at: `${date}T12:00:00Z`,
});

/** Opening balance plus everything that moved in the window equals the balance at its end. */
const reconciles = (series: ReserveExplorerSeries) => {
  const moved = series.buckets.reduce((sum, bucket) => sum + bucket.deposited - bucket.withdrawn, 0);
  return series.openingHeld + moved === series.buckets[series.buckets.length - 1].held;
};

describe('reservePeriodStart', () => {
  it('counts the period back from today, today included', () => {
    expect(reservePeriodStart('30d', '2026-11-24')).toBe('2026-10-26');
    expect(reservePeriodStart('90d', '2026-11-24')).toBe('2026-08-27');
    expect(reservePeriodStart('1y', '2026-11-24')).toBe('2025-11-25');
    expect(reservePeriodStart('all', '2026-11-24')).toBeNull();
  });

  it('handles a leap day and a year end', () => {
    expect(reservePeriodStart('1y', '2028-02-29')).toBe('2027-03-01');
    expect(reservePeriodStart('30d', '2026-01-10')).toBe('2025-12-12');
    expect(addIsoDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('reserveBucketUnit', () => {
  it('uses days up to 92 days, weeks up to 370 and months beyond', () => {
    expect(reserveBucketUnit('2026-01-01', '2026-01-01')).toBe('day');
    expect(reserveBucketUnit('2026-01-01', addIsoDays('2026-01-01', 91))).toBe('day');
    expect(reserveBucketUnit('2026-01-01', addIsoDays('2026-01-01', 92))).toBe('week');
    expect(reserveBucketUnit('2026-01-01', addIsoDays('2026-01-01', 369))).toBe('week');
    expect(reserveBucketUnit('2026-01-01', addIsoDays('2026-01-01', 370))).toBe('month');
  });
});

describe('reserveExplorerSeries', () => {
  it('has no buckets without activity', () => {
    expect(reserveExplorerSeries([], '2026-11-24', '90d')).toEqual({ unit: 'day', buckets: [], openingHeld: 0, from: null, to: '2026-11-24' });
  });

  it('fills every day from the first activity, with the balance and what moved', () => {
    const activity = reserveActivity(
      [entry('a', '2026-11-20', 500_000), entry('b', '2026-11-22', 100_000, 'return')],
      [purchase('p', '2026-11-22', 50_000)],
    );
    const series = reserveExplorerSeries(activity, '2026-11-24', '30d');
    expect(series.unit).toBe('day');
    expect(series.openingHeld).toBe(0);
    expect(series.from).toBe('2026-11-20');
    expect(series.buckets.map((bucket) => [bucket.key, bucket.held, bucket.deposited, bucket.withdrawn, bucket.count])).toEqual([
      ['2026-11-20', 500_000, 500_000, 0, 1],
      ['2026-11-21', 500_000, 0, 0, 0],
      ['2026-11-22', 350_000, 0, 150_000, 2],
      ['2026-11-23', 350_000, 0, 0, 0],
      ['2026-11-24', 350_000, 0, 0, 0],
    ]);
    expect(series.buckets.every((bucket) => bucket.from === bucket.to)).toBe(true);
    expect(reconciles(series)).toBe(true);
    // The same line as the all-time daily balance.
    const daily = reserveDailySeries([entry('a', '2026-11-20', 500_000), entry('b', '2026-11-22', 100_000, 'return')], [purchase('p', '2026-11-22', 50_000)], '2026-11-24');
    expect(series.buckets.map((bucket) => bucket.held)).toEqual(daily.map((day) => day.held));
  });

  it('carries the balance from before the window in as the opening balance', () => {
    const activity = reserveActivity(
      [entry('old', '2026-01-05', 1_000_000), entry('new', '2026-11-23', 200_000)],
      [purchase('rent', '2026-03-01', 300_000), purchase('late', '2026-11-24', 100_000)],
    );
    const series = reserveExplorerSeries(activity, '2026-11-24', '30d');
    expect(series.from).toBe('2026-10-26');
    expect(series.buckets).toHaveLength(30);
    expect(series.openingHeld).toBe(700_000);
    expect(series.buckets[0]).toMatchObject({ key: '2026-10-26', held: 700_000, count: 0 });
    expect(series.buckets[series.buckets.length - 1]).toMatchObject({ key: '2026-11-24', held: 800_000, withdrawn: 100_000, count: 1 });
    expect(reconciles(series)).toBe(true);
    expect(reserveWindowSummary(series)).toEqual({ held: 800_000, change: 100_000, deposited: 200_000, withdrawn: 100_000, count: 2 });
  });

  it('counts an exchange as an entry that moves nothing', () => {
    const activity = reserveActivity([
      entry('saved', '2026-11-02', 10_000_000),
      entry('buy-half', '2026-11-10', 2_500_000, 'return', { paired_exchange_id: 'x1' }),
      entry('exchange:x1', '2026-11-10', 2_500_000, 'deposit', { exchange_id: 'x1', payment_method: 'usd', usd_amount: 200 }),
    ], []);
    expect(activity.map((row) => row.kind)).toEqual(['exchange', 'deposit']);
    const series = reserveExplorerSeries(activity, '2026-11-12', '30d');
    const exchangeDay = series.buckets.find((bucket) => bucket.key === '2026-11-10');
    expect(exchangeDay).toMatchObject({ held: 10_000_000, deposited: 0, withdrawn: 0, count: 1 });
    expect(reserveActivityInRange(activity, '2026-11-10', '2026-11-10', '2026-11-12')).toHaveLength(1);
  });

  it('counts activity dated after today on today', () => {
    const activity = reserveActivity([entry('a', '2026-11-20', 500_000), entry('ahead', '2026-11-30', 100_000)], []);
    const series = reserveExplorerSeries(activity, '2026-11-24', '30d');
    expect(series.buckets[series.buckets.length - 1]).toMatchObject({ key: '2026-11-24', to: '2026-11-24', held: 600_000, deposited: 100_000, count: 1 });
    expect(reserveActivityInRange(activity, '2026-11-24', '2026-11-24', '2026-11-24').map((row) => row.id)).toEqual(['ahead']);
  });

  it('never shows less than nothing, and catches up when the money is recorded', () => {
    // October rent paid on the 31st from money put in on 2 November.
    const activity = reserveActivity([entry('a', '2026-11-02', 500_000)], [purchase('rent', '2026-10-31', 300_000)]);
    const series = reserveExplorerSeries(activity, '2026-11-03', 'all');
    expect(series.buckets.map((bucket) => bucket.held)).toEqual([0, 0, 200_000, 200_000]);
    // Before the window the running total was below zero: the window opens at nothing.
    const later = reserveExplorerSeries(
      reserveActivity([entry('a', '2026-09-01', 500_000)], [purchase('rent', '2026-08-01', 300_000)]),
      '2026-11-24',
      '30d',
    );
    expect(later.openingHeld).toBe(200_000);
    const negative = reserveExplorerSeries(
      reserveActivity([entry('a', '2026-11-20', 500_000)], [purchase('rent', '2026-08-01', 300_000)]),
      '2026-11-24',
      '30d',
    );
    expect(negative.openingHeld).toBe(0);
    expect(negative.buckets[negative.buckets.length - 1].held).toBe(200_000);
  });

  it('buckets a year by Monday weeks across the year end, clamping the first and last week to the window', () => {
    const activity = reserveActivity(
      [entry('first', '2025-03-01', 1_000_000), entry('nye', '2025-12-31', 100_000), entry('ny', '2026-01-02', 200_000), entry('now', '2026-02-18', 50_000)],
      [purchase('mid', '2025-12-29', 40_000)],
    );
    const series = reserveExplorerSeries(activity, '2026-02-18', '1y');
    expect(series.unit).toBe('week');
    expect(series.from).toBe('2025-03-01');
    // 1 March 2025 is a Saturday: the first week is clamped to it.
    expect(series.buckets[0]).toMatchObject({ key: '2025-03-01', from: '2025-03-01', to: '2025-03-02', deposited: 1_000_000, count: 1 });
    expect(series.buckets[1]).toMatchObject({ from: '2025-03-03', to: '2025-03-09' });
    // Monday 29 December 2025 to Sunday 4 January 2026 is one week.
    const yearEnd = series.buckets.find((bucket) => bucket.from === '2025-12-29');
    expect(yearEnd).toMatchObject({ to: '2026-01-04', deposited: 300_000, withdrawn: 40_000, count: 3 });
    // 18 February 2026 is a Wednesday: the last week ends today.
    expect(series.buckets[series.buckets.length - 1]).toMatchObject({ from: '2026-02-16', to: '2026-02-18', deposited: 50_000 });
    expect(reconciles(series)).toBe(true);
    // Each bucket's count is what the history lists for its dates.
    for (const bucket of series.buckets) {
      expect(reserveActivityInRange(activity, bucket.from, bucket.to, '2026-02-18')).toHaveLength(bucket.count);
    }
  });

  it('buckets a longer life by month, from the month of the first activity', () => {
    const activity = reserveActivity(
      [entry('a', '2024-06-15', 1_000_000), entry('b', '2026-11-03', 100_000)],
      [purchase('p', '2025-02-10', 200_000)],
    );
    const series = reserveExplorerSeries(activity, '2026-11-24', 'all');
    expect(series.unit).toBe('month');
    expect(series.buckets[0]).toMatchObject({ key: '2024-06-15', from: '2024-06-15', to: '2024-06-30', held: 1_000_000 });
    expect(series.buckets[1]).toMatchObject({ from: '2024-07-01', to: '2024-07-31', count: 0 });
    expect(series.buckets.find((bucket) => bucket.from === '2025-02-01')).toMatchObject({ to: '2025-02-28', withdrawn: 200_000, held: 800_000 });
    expect(series.buckets[series.buckets.length - 1]).toMatchObject({ from: '2026-11-01', to: '2026-11-24', held: 900_000 });
    expect(series.buckets).toHaveLength(30);
    expect(reconciles(series)).toBe(true);
    for (const bucket of series.buckets) {
      expect(reserveActivityInRange(activity, bucket.from, bucket.to, '2026-11-24')).toHaveLength(bucket.count);
    }
  });

  it('starts at the first activity when the reserve is younger than the period', () => {
    const activity = reserveActivity([entry('a', '2026-11-20', 500_000)], []);
    const series = reserveExplorerSeries(activity, '2026-11-24', '1y');
    expect(series.unit).toBe('day');
    expect(series.from).toBe('2026-11-20');
    expect(series.buckets).toHaveLength(5);
  });
});

describe('reserve history filter', () => {
  const activity = reserveActivity(
    [entry('in', '2026-11-03', 500_000), entry('back', '2026-11-05', 100_000, 'return'), entry('old', '2026-06-01', 900_000)],
    [purchase('rent', '2026-11-04', 300_000, 'rent'), purchase('chairs', '2026-11-04', 80_000, 'equipment'), purchase('old-rent', '2026-06-02', 300_000, 'rent')],
  );

  it('narrows to dates, then a category of purchases, then a kind', () => {
    const ids = (filter: Parameters<typeof filterReserveHistory>[1]) => filterReserveHistory(activity, filter, '2026-11-24').map((row) => row.id);
    expect(ids({ kind: 'all' })).toHaveLength(6);
    expect(ids({ kind: 'all', from: '2026-11-03', to: '2026-11-09' })).toEqual(['back', 'rent', 'chairs', 'in']);
    expect(ids({ kind: 'purchase', from: '2026-11-03', to: '2026-11-09', category: 'rent' })).toEqual(['rent']);
    expect(ids({ kind: 'purchase', category: 'rent' })).toEqual(['rent', 'old-rent']);
    expect(ids({ kind: 'deposit', from: '2026-11-03', to: '2026-11-09' })).toEqual(['in']);
    expect(ids({ kind: 'exchange', from: '2026-11-03', to: '2026-11-09' })).toEqual([]);
  });

  it('keeps the rows of a period for the spending donut', () => {
    expect(reserveActivityInPeriod(activity, '30d', '2026-11-24').map((row) => row.id)).toEqual(['back', 'rent', 'chairs', 'in']);
    expect(reserveActivityInPeriod(activity, 'all', '2026-11-24')).toHaveLength(6);
  });
});
