'use client';

import { SkeletonStatus } from '@/components/PresentationFoundation';
import { useClub } from '@/components/layout/DashboardShell';
import { canAccessPath } from '@/lib/permissions';
import { DashboardSkeleton } from './DashboardSkeleton';

/**
 * The dashboard's route placeholder for the member looking at it: the reserve
 * tile only for those who can open /reserve, as DashboardPage shows it. Before
 * a club is known it keeps the owner's five-tile shape.
 */
export function DashboardRouteSkeleton() {
  const { selectedClubId, role, featureAccess } = useClub();
  const withReserve = !selectedClubId || canAccessPath(role, featureAccess, '/reserve');
  return <SkeletonStatus><DashboardSkeleton withReserve={withReserve} /></SkeletonStatus>;
}
