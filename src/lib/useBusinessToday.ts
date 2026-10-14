'use client';

import { useEffect, useState } from 'react';
import { todayIso } from '@/lib/utils';

/** How often an open tab re-checks the business date. */
const CLOCK_REFRESH_MS = 60_000;

/**
 * The club's current business date, kept current while the page stays open
 * (overnight tabs, sleep, a backgrounded phone). Re-checks every minute and on
 * focus/visibility, so forms and pickers roll over to the new business day.
 */
export function useBusinessToday(businessDayStartHour: number | null | undefined): string {
  const [today, setToday] = useState(() => todayIso(new Date(), businessDayStartHour ?? undefined));

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      const next = todayIso(new Date(), businessDayStartHour ?? undefined);
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
  }, [businessDayStartHour]);

  return today;
}
