'use client';

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { createClubQuerySequence } from './clubQuerySequence';

export interface ClubQueryLoadOptions {
  /** Keep the current data on screen (no skeleton) and keep it if the load fails. */
  silent?: boolean;
}

export interface ClubQuery<T> {
  data: T;
  /** True while a non-silent load is in flight. */
  loading: boolean;
  /** True while a silent reload is in flight (data stays on screen). */
  refreshing: boolean;
  /** The latest load failed. */
  error: boolean;
  /** Re-runs the loader; resolves once this load has settled. */
  reload: (options?: ClubQueryLoadOptions) => Promise<void>;
  /** Local updates between loads (optimistic edits, clearing a list). */
  setData: Dispatch<SetStateAction<T>>;
}

/**
 * Loads club data with the app's standard request rules: only the latest
 * request may land, a failed load shows the error instead of stale data, and
 * a silent reload after a save keeps the screen as it is.
 *
 * `load` must be memoised (`useCallback`); a new identity reloads. Pass `null`
 * when there is nothing to load (no club selected) to show `initialData`.
 * `load` throws to report a failure and may poll `isCurrent()` between
 * requests to stop early once superseded.
 */
export function useClubQuery<T>(
  load: ((isCurrent: () => boolean) => Promise<T>) | null,
  initialData: T,
): ClubQuery<T> {
  const [initial] = useState(initialData);
  const [data, setData] = useState<T>(initialData);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** The loader whose request last settled; a new loader is loading until its first request lands. */
  const [settledLoad, setSettledLoad] = useState<typeof load | undefined>(undefined);
  const [error, setError] = useState(false);
  const [sequence] = useState(() => createClubQuerySequence(load));

  // Recorded before the reload effect below, so the new loader's first request starts.
  useEffect(() => {
    sequence.setCurrentLoader(load);
  }, [load, sequence]);

  const reload = useCallback(async ({ silent = false }: ClubQueryLoadOptions = {}) => {
    // A reload captured before a club or date switch would discard the new loader's request.
    const isCurrent = sequence.begin(load);
    if (!isCurrent) return;
    setError(false);
    if (!load) {
      setData(initial);
      setPending(false);
      setRefreshing(false);
      return;
    }

    if (silent) setRefreshing(true);
    else setPending(true);
    try {
      const next = await load(isCurrent);
      if (!isCurrent()) return;
      setData(next);
    } catch {
      // A superseded load must not paint its failure over a newer request.
      if (!isCurrent()) return;
      if (!silent) setData(initial);
      setError(true);
    }
    setPending(false);
    setRefreshing(false);
    setSettledLoad(() => load);
  }, [initial, load, sequence]);

  useEffect(() => {
    void reload();
    return () => sequence.cancel();
  }, [reload, sequence]);

  const loading = load !== null && (pending || settledLoad !== load);
  return { data, loading, refreshing, error, reload, setData };
}
