'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A phone, for the charts: a touch screen (coarse pointer) or a window
 * narrower than Tailwind's `sm` breakpoint. There a tap on a chart opens the
 * day's details instead of drawing a tooltip under the finger.
 */
export const MOBILE_CHART_QUERY = '(pointer: coarse), (max-width: 639px)';

/** The person asked the system for less motion; charts then draw without animating. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function mediaList(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
}

// The server draws the desktop chart with motion; the browser switches after hydration.
const serverSnapshot = () => false;

/** Whether a media query matches now, following it as it changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const list = mediaList(query);
    list?.addEventListener('change', onChange);
    return () => list?.removeEventListener('change', onChange);
  }, [query]);
  const snapshot = useCallback(() => mediaList(query)?.matches ?? false, [query]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** A phone (see `MOBILE_CHART_QUERY`): tap opens details, no tooltip under the finger. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_CHART_QUERY);
}

/** Reduced motion: pass `chartAnimation(reduced)` so bars and areas stop animating in. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
