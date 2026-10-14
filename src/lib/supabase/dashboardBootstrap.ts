import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import type { ClubMembership, UserRole } from '@/types';
import { isMissingDatabaseFunction } from './errors';
import { loadUserMemberships, SELECTED_CLUB_COOKIE } from './memberships';
import { createClient } from './server';

export interface DashboardBootstrap {
  initialEmail: string;
  initialFullName: string;
  initialMemberships: ClubMembership[];
  initialRole: UserRole;
  initialSelectedClubId: string;
  userId: string;
}

interface DashboardBootstrapSnapshot {
  profile: {
    full_name: string | null;
    role: UserRole | null;
  } | null;
  memberships: ClubMembership[];
}

/**
 * Shared by the dashboard layout and index page. React cache keeps auth,
 * profile, and membership lookup to one server-side bootstrap per request.
 */
export const getDashboardBootstrap = cache(async (): Promise<DashboardBootstrap | null> => {
  const supabase = await createClient();
  // The RPC authorizes through auth.uid()/RLS independently. Start it alongside
  // remote user validation, but never return account data before getUser passes.
  // Promise.all also observes either failure without an unhandled rejection.
  const [{ data: { user } }, snapshotRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc('get_dashboard_bootstrap'),
  ]);
  if (!user) return null;

  let profile: DashboardBootstrapSnapshot['profile'] = null;
  let memberships: ClubMembership[] = [];

  if (!snapshotRes.error) {
    const snapshot = snapshotRes.data as DashboardBootstrapSnapshot;
    profile = snapshot.profile;
    memberships = snapshot.memberships ?? [];
  } else if (isMissingDatabaseFunction(snapshotRes.error, 'get_dashboard_bootstrap')) {
    // Compatibility path while migration 048 is being deployed.
    const [profileRes, membershipRows] = await Promise.all([
      supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', user.id)
        .maybeSingle(),
      loadUserMemberships(supabase, user.id),
    ]);

    profile = profileRes.data as DashboardBootstrapSnapshot['profile'];
    memberships = membershipRows;
  } else {
    // Null means unauthenticated to the layout. Returning it for a database
    // outage loops between /login (valid session) and the dashboard.
    throw new Error('Could not load dashboard account data. Please try again.');
  }

  const cookieStore = await cookies();
  const preferredClubId = cookieStore.get(SELECTED_CLUB_COOKIE)?.value ?? '';
  const initialSelectedClubId = memberships.some((membership) => membership.club_id === preferredClubId)
    ? preferredClubId
    : memberships[0]?.club_id ?? '';

  const initialEmail = user.email ?? '';
  return {
    initialEmail,
    initialFullName: profile?.full_name ?? initialEmail,
    initialMemberships: memberships,
    initialRole: profile?.role ?? 'viewer',
    initialSelectedClubId,
    userId: user.id,
  };
});
