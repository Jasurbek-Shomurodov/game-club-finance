'use client';

import { useEffect, useState } from 'react';
import { serverTodayIso } from '@/lib/utils';

/** How often an open tab re-checks the business date. */
const CLOCK_REFRESH_MS = 60_000;

/**
 * The club's current business date, kept current while the page stays open
 * (overnight tabs, sleep, a backgrounded phone). Re-checks every minute and on
 * focus/visibility, so forms and pickers roll over to the new business day.
 * `paused` holds the date still, e.g. while a form has unsaved edits.
 * Reads the APP_TIME_ZONE wall clock like the database's club_business_date(),
 * so a device in another time zone never defaults forms to a day the database
 * rejects as future (or to yesterday); it also matches the server render.
 */
export function useBusinessToday(
  businessDayStartHour: number | null | undefined,
  { paused = false }: { paused?: boolean } = {},
): string {
  const [today, setToday] = useState(() => serverTodayIso(new Date(), businessDayStartHour ?? undefined));

  useEffect(() => {
    // While paused (unsaved edits on screen) the date is frozen; it catches up
    // as soon as the pause ends.
    if (paused) return;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      const next = serverTodayIso(new Date(), businessDayStartHour ?? undefined);
      setToday((current) => (current === next ? current : next));
    };
    refresh();
    const timer = window.setInterval(refresh, CLOCK_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [businessDayStartHour, paused]);

  return today;
}
