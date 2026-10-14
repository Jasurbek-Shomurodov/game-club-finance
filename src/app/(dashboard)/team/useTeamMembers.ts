'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient, mutateFinanceRequest } from '@/lib/supabase/client';
import { isMissingDatabaseColumn } from '@/lib/supabase/errors';
import { fetchAllRows } from '@/lib/supabase/pagination';
import {
  buildTeamMembers,
  notifyTeamChanged,
  type TeamMembershipRow,
  type TeamProfileRow,
} from '@/lib/team';
import type { FeatureKey } from '@/lib/permissions';
import type { Club, UserRole } from '@/types';

const PROFILE_COLUMNS = 'id, full_name, email, role, created_at, updated_at';

export type RejectResult = 'rejected' | 'has_access' | 'gone' | 'error';

/**
 * Team data for the owner's team page and its writes.
 *
 * RLS (074) limits the reads to the caller's own profile, people who share a
 * club with them, and open access requests; memberships to the caller's clubs.
 * Only memberships in `managedClubs` (active clubs the caller owns) are listed.
 *
 * Every write reports whether a row was actually changed: RLS silently skips
 * rows the caller may not touch, which must not look like success.
 */
export function useTeamMembers({ enabled, managedClubs }: { enabled: boolean; managedClubs: ReadonlyArray<Pick<Club, 'id' | 'name'>> }) {
  const requestSequence = useRef(0);
  const [profileRows, setProfileRows] = useState<TeamProfileRow[]>([]);
  const [membershipRows, setMembershipRows] = useState<TeamMembershipRow[]>([]);
  const [featureAccessAvailable, setFeatureAccessAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const members = useMemo(
    () => buildTeamMembers(profileRows, membershipRows, managedClubs),
    [managedClubs, membershipRows, profileRows],
  );

  const fetchTeam = useCallback(async () => {
    const supabase = createClient();
    const profiles = (columns: string) => fetchAllRows<TeamProfileRow>(() => supabase
      .from('profiles')
      .select(columns)
      .order('full_name', { ascending: true })
      .order('id', { ascending: true }) as never);
    const memberships = (columns: string) => fetchAllRows<TeamMembershipRow>(() => supabase
      .from('club_memberships')
      .select(columns)
      .order('club_id', { ascending: true })
      .order('user_id', { ascending: true }) as never);

    let [profileRes, membershipRes] = await Promise.all([
      profiles(`${PROFILE_COLUMNS}, access_rejected_at`),
      memberships('club_id, user_id, role, feature_access'),
    ]);

    // Before 072 there is no rejection mark; every member-less profile is pending.
    if (isMissingDatabaseColumn(profileRes.error, 'access_rejected_at')) {
      profileRes = await profiles(PROFILE_COLUMNS);
    }
    const hasFeatureAccess = !isMissingDatabaseColumn(membershipRes.error, 'feature_access');
    if (!hasFeatureAccess) {
      membershipRes = await memberships('club_id, user_id, role');
    }

    const error = profileRes.error ?? membershipRes.error;
    if (error) throw new Error(error.message);
    return {
      profiles: profileRes.data ?? [],
      memberships: membershipRes.data ?? [],
      hasFeatureAccess,
    };
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    const requestId = ++requestSequence.current;
    if (!silent) setLoading(true);
    setLoadFailed(false);
    try {
      const team = await fetchTeam();
      if (requestId !== requestSequence.current) return;
      setProfileRows(team.profiles);
      setMembershipRows(team.memberships);
      setFeatureAccessAvailable(team.hasFeatureAccess);
    } catch (loadError) {
      if (requestId !== requestSequence.current) return;
      console.error('Failed to load team', loadError);
      setLoadFailed(true);
      setProfileRows([]);
      setMembershipRows([]);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [fetchTeam]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    return () => { requestSequence.current += 1; };
  }, [enabled, load]);

  /** Grants club access; approving a request is the same write. */
  const addAccess = useCallback(async (userId: string, clubId: string, role: UserRole) => {
    const { error } = await createClient()
      .from('club_memberships')
      .insert({ club_id: clubId, user_id: userId, role });
    if (error) {
      console.error('Failed to add club access', error);
      return false;
    }
    notifyTeamChanged();
    await load({ silent: true });
    return true;
  }, [load]);

  const updateRole = useCallback(async (userId: string, clubId: string, role: UserRole) => {
    const { data, error } = await createClient()
      .from('club_memberships')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('club_id', clubId)
      .eq('user_id', userId)
      .select('user_id');
    if (error || !data?.length) {
      console.error('Failed to update role', error ?? 'no membership row was updated');
      return false;
    }
    await load({ silent: true });
    return true;
  }, [load]);

  const removeAccess = useCallback(async (userId: string, clubId: string) => {
    const { data, error } = await createClient()
      .from('club_memberships')
      .delete()
      .eq('club_id', clubId)
      .eq('user_id', userId)
      .select('user_id');
    if (error || !data?.length) {
      console.error('Failed to remove club access', error ?? 'no membership row was deleted');
      return false;
    }
    notifyTeamChanged();
    await load({ silent: true });
    return true;
  }, [load]);

  /** Saves page access optimistically and puts the previous value back on failure. */
  const updateFeatureAccess = useCallback(async (
    userId: string,
    clubId: string,
    nextAccess: FeatureKey[],
    previousAccess: FeatureKey[] | null,
  ) => {
    const setAccess = (featureAccess: FeatureKey[] | null) => setMembershipRows((current) => current.map((row) => (
      row.user_id === userId && row.club_id === clubId ? { ...row, feature_access: featureAccess } : row
    )));

    setAccess(nextAccess);
    try {
      const { data, error } = await createClient()
        .from('club_memberships')
        .update({ feature_access: nextAccess, updated_at: new Date().toISOString() })
        .eq('club_id', clubId)
        .eq('user_id', userId)
        .select('user_id');
      if (error || !data?.length) {
        console.error('Failed to update feature access', error ?? 'no membership row was updated');
        setAccess(previousAccess);
        return false;
      }
      return true;
    } catch (saveError) {
      console.error('Failed to update feature access', saveError);
      setAccess(previousAccess);
      return false;
    }
  }, []);

  /** Rejects an open request server-side (the route re-checks it atomically). */
  const reject = useCallback(async (userId: string): Promise<RejectResult> => {
    let result: RejectResult;
    try {
      const response = await mutateFinanceRequest('/api/team/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      result = response.ok
        ? 'rejected'
        : response.status === 409
          ? 'has_access'
          : response.status === 404
            ? 'gone'
            : 'error';
      if (result === 'error') console.error('Failed to reject request', response.status);
    } catch (rejectError) {
      console.error('Failed to reject request', rejectError);
      result = 'error';
    }
    if (result !== 'error') {
      notifyTeamChanged();
      await load({ silent: true });
    }
    return result;
  }, [load]);

  return {
    members,
    loading,
    loadFailed,
    featureAccessAvailable,
    load,
    addAccess,
    updateRole,
    removeAccess,
    updateFeatureAccess,
    reject,
  };
}
