/**
 * Where a selected business date, month or range goes when the club's current
 * period changes. A club switch always opens the current period; a rollover
 * (a new business day or month while the page stays open) moves the selection
 * forward only if it was still on the previous current period, so a period the
 * user picked deliberately is kept. Returns `value` itself when nothing moves.
 */
export function followBusinessPeriod<T>(
  value: T,
  previousCurrent: T,
  current: T,
  clubChanged: boolean,
  equals: (a: T, b: T) => boolean = Object.is,
): T {
  if (!clubChanged && !equals(value, previousCurrent)) return value;
  return equals(value, current) ? value : current;
}
