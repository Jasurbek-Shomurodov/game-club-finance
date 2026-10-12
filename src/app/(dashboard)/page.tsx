import DashboardPage from './DashboardPage';
import { Suspense } from 'react';
import { PageSkeleton } from '@/components/PresentationFoundation';
import type { Club, ClubMembership } from '@/types';
import { normalizeBusinessDayStartHour, serverTodayIso } from '@/lib/utils';
import { createClient } from '@/lib/supabase/server';
import { getDashboardBootstrap } from '@/lib/supabase/dashboardBootstrap';
import {
  getDashboardComparisonRange,
  getDashboardRange,
  type InventorySnapshotRow,
} from '@/lib/calculations/dashboardMetrics';
import {
  buildDashboardDataFromSnapshot,
  type DashboardSnapshotPayload,
} from '@/lib/calculations/dashboardSnapshot';

function relatedClub(relation: ClubMembership['clubs']): Club | null {
  if (!relation) return null;
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

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
  const period = 'month' as const;
  const range = getDashboardRange(period, businessToday);
  const previousRange = getDashboardComparisonRange(period, range);
  const inventoryComparisonRange = getDashboardRange('lastMonth', businessToday);
  const supabase = await createClient();
  const snapshotResult = await supabase.rpc('get_dashboard_snapshot', {
    p_club_id: bootstrap.initialSelectedClubId,
    p_range_from: range.from,
    p_range_to: range.to,
    p_previous_from: previousRange.from,
    p_previous_to: previousRange.to,
    p_inventory_from: inventoryComparisonRange.from,
    p_inventory_to: inventoryComparisonRange.to,
  });

  if (snapshotResult.error) return <DashboardPage />;

  const snapshot = snapshotResult.data as Omit<DashboardSnapshotPayload, 'inventoryRows'> & {
    inventoryRows?: InventorySnapshotRow[];
  };
  const data = buildDashboardDataFromSnapshot({
    period,
    range,
    previousRange,
    inventoryComparisonRange,
    payload: {
      ...snapshot,
      inventoryRows: snapshot.inventoryRows ?? snapshot.stockRows as unknown as InventorySnapshotRow[],
    },
  });

  return (
    <DashboardPage
      initialSnapshot={{
        clubId: bootstrap.initialSelectedClubId,
        data,
        range,
        // Browser Back can replay this server payload from the router cache;
        // the client only trusts it without refetching while it is fresh.
        generatedAt: now.getTime(),
      }}
    />
  );
}
