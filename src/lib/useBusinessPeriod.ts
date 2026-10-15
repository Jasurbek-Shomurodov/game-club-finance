'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { followBusinessPeriod } from '@/lib/businessPeriod';

/**
 * A selected date, month or range that follows the club's business period:
 * it opens on `current`, resets to it on a club switch, and rolls forward with
 * it while still showing the previous one. `current` comes from
 * `useBusinessToday` (or a value derived from it); `equals` must be stable.
 */
export function useBusinessPeriod<T>(
  current: T,
  clubId: string | null,
  equals: (a: T, b: T) => boolean = Object.is,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(current);
  const previous = useRef({ current, clubId });

  useEffect(() => {
    const last = previous.current;
    const clubChanged = last.clubId !== clubId;
    if (!clubChanged && equals(last.current, current)) return;
    previous.current = { current, clubId };
    setValue((selected) => followBusinessPeriod(selected, last.current, current, clubChanged, equals));
  }, [clubId, current, equals]);

  return [value, setValue];
}

/**
 * Calls `onRollover(previous, next)` when the business date or month changes
 * while the page stays open, so forms can move untouched dates forward.
 */
export function useBusinessRollover(current: string, onRollover: (previous: string, next: string) => void) {
  const previous = useRef(current);
  const callback = useRef(onRollover);

  useEffect(() => {
    callback.current = onRollover;
  });

  useEffect(() => {
    const last = previous.current;
    if (last === current) return;
    previous.current = current;
    callback.current(last, current);
  }, [current]);
}
