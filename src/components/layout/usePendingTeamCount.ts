'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isMissingDatabaseColumn } from '@/lib/supabase/errors';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { countPendingRequests, TEAM_CHANGED_EVENT } from '@/lib/team';

type PendingProfileRow = { id: string; access_rejected_at?: string | null };

async function loadPendingCount() {
  const supabase = createClient();
  const profiles = (columns: string) => fetchAllRows<PendingProfileRow>(() => supabase
    .from('profiles')
    .select(columns)
    .order('id') as never);

  const [initialProfileRes, membershipRes] = await Promise.all([
    profiles('id, access_rejected_at'),
    fetchAllRows<{ user_id: string }>(() => supabase
      .from('club_memberships')
      .select('user_id')
      .order('user_id')),
  ]);
  // Before 072 there is no rejection mark; every member-less profile is pending.
  const profileRes = isMissingDatabaseColumn(initialProfileRes.error, 'access_rejected_at')
    ? await profiles('id')
    : initialProfileRes;
  if (profileRes.error || membershipRes.error) return null;
  return countPendingRequests(profileRes.data ?? [], membershipRes.data ?? []);
}

/**
 * Number of open access requests (people with no club access who were not
 * rejected). Owners see it as a badge on the Team item so a new employee's
 * request is noticed without opening the page. Non-owners cannot read
 * requests, so the hook stays idle for them.
 *
 * Re-counted when the club changes, when the team page reports a change, and
 * when the window regains focus — not on every navigation.
 */
export function usePendingTeamCount(enabled: boolean, clubId: string) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let cancelled = false;
    let latest = 0;

    const refresh = () => {
      const request = ++latest;
      loadPendingCount()
        .then((next) => {
          if (!cancelled && request === latest && next !== null) setCount(next);
        })
        .catch(() => {
          // Badge only; a failed read keeps the last count.
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };

    refresh();
    window.addEventListener(TEAM_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      window.removeEventListener(TEAM_CHANGED_EVENT, refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [enabled, clubId]);

  return count;
}
