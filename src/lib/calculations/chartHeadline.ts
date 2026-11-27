/**
 * The change line under a chart's headline figure: how much a series moved
 * over the period shown, as an amount and a share of where it started. These
 * only compare values a chart already receives; they define no new totals.
 */

export interface HeadlineChange {
  /** Last value minus first value. */
  amount: number;
  /** `amount` as a share (0.12 = 12%) of the opening value; null when the opening value is not positive. */
  percent: number | null;
}

/** Last minus first; null when either end is missing. */
export function periodChange(first: number | null | undefined, last: number | null | undefined): number | null {
  if (typeof first !== 'number' || typeof last !== 'number' || !Number.isFinite(first) || !Number.isFinite(last)) return null;
  return last - first;
}

/**
 * `change` as a share of the value it started from (`current - change`).
 * Null when there is no change or the opening value is zero or negative,
 * where a percentage would mislead.
 */
export function changePercent(current: number, change: number | null): number | null {
  if (change === null || !Number.isFinite(current)) return null;
  const opening = current - change;
  return opening > 0 ? change / opening : null;
}

/** The first and last finite values of a series in order, skipping days without an entry. */
export function seriesEnds(values: ReadonlyArray<number | null | undefined>): { first: number; last: number } | null {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return finite.length ? { first: finite[0], last: finite[finite.length - 1] } : null;
}

/** How a series moved from its first to its last value; null for fewer than two values. */
export function seriesChange(values: ReadonlyArray<number | null | undefined>): HeadlineChange | null {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (finite.length < 2) return null;
  const ends = seriesEnds(finite)!;
  const amount = periodChange(ends.first, ends.last)!;
  return { amount, percent: changePercent(ends.last, amount) };
}
