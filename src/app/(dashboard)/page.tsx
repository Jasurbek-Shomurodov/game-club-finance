import DashboardPage from './DashboardPage';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/PresentationFoundation';
import type { ClubMembership } from '@/types';
import { normalizeBusinessDayStartHour, serverTodayIso } from '@/lib/utils';
import { createClient } from '@/lib/supabase/server';
import { getDashboardBootstrap } from '@/lib/supabase/dashboardBootstrap';
import {
  buildDashboardDataFromSnapshot,
  getDashboardSnapshotRanges,
} from '@/lib/calculations/dashboardSnapshot';
import { fetchDashboardSnapshot } from '@/lib/supabase/dashboardSnapshot';
import { relatedClub } from '@/lib/supabase/memberships';

function selectedMembership(
  memberships: ClubMembership[],
  clubId: string,
) {
  return memberships.find((membership) => membership.club_id === clubId);
}

export default function DashboardRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardSnapshotRoute />
    </Suspense>
  );
}

async function DashboardSnapshotRoute() {
  const bootstrap = await getDashboardBootstrap();

  if (!bootstrap?.initialSelectedClubId) return <DashboardPage />;

  const membership = selectedMembership(
    bootstrap.initialMemberships,
    bootstrap.initialSelectedClubId,
  );
  const club = relatedClub(membership?.clubs ?? null);
  if (!club) return <DashboardPage />;

  // The server runs in UTC; compute the club's business date in the app time
  // zone so the snapshot matches the range the browser will ask for.
  const now = new Date();
  const businessToday = serverTodayIso(
    now,
    normalizeBusinessDayStartHour(club.business_day_start_hour),
  );
  // The dashboard always shows the club's current business month.
  const ranges = getDashboardSnapshotRanges(businessToday);
  const supabase = await createClient();
  const snapshot = await fetchDashboardSnapshot(supabase, bootstrap.initialSelectedClubId, ranges);

  // Errors and older databases without the RPC load on the client instead.
  if (!snapshot.data) return <DashboardPage />;

  const data = buildDashboardDataFromSnapshot({ ...ranges, payload: snapshot.data });

  return (
    <DashboardPage
      initialSnapshot={{
        clubId: bootstrap.initialSelectedClubId,
        data,
        range: ranges.range,
        // Browser Back can replay this server payload from the router cache;
        // the client only trusts it without refetching while it is fresh.
        generatedAt: now.getTime(),
      }}
    />
  );
}
