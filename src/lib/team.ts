import type { Club, Profile, UserRole } from '@/types';
import { featureAccessForMembership, normalizeFeatureAccess, type FeatureKey } from '@/lib/permissions';

export const TEAM_ROLES: UserRole[] = ['owner', 'admin', 'viewer'];

export interface TeamMembership {
  clubId: string;
  clubName: string;
  role: UserRole;
  featureAccess: FeatureKey[] | null;
}

export interface TeamMember extends Profile {
  /** Memberships in clubs the signed-in owner manages. */
  memberships: TeamMembership[];
  /** Has a membership in some club, including inactive clubs not listed here. */
  hasAnyMembership: boolean;
  access_rejected_at?: string | null;
}

export interface TeamProfileRow extends Profile {
  access_rejected_at?: string | null;
}

export interface TeamMembershipRow {
  club_id: string;
  user_id: string;
  role: string;
  feature_access?: string[] | null;
}

/** A member together with their membership in one club. */
export interface ClubMember {
  member: TeamMember;
  membership: TeamMembership;
}

export function normalizeTeamRole(role: string | null | undefined): UserRole {
  return role === 'owner' || role === 'admin' || role === 'viewer' ? role : 'viewer';
}

/**
 * An access request is someone with no club access at all who has not been
 * rejected. Access to an inactive club still counts as access, and the server
 * refuses to reject such a person. Before migration 072 there is no rejection
 * mark, so every member-less profile is pending.
 */
export function isPendingRequest(profile: { hasAnyMembership: boolean; access_rejected_at?: string | null }): boolean {
  return !profile.hasAnyMembership && !profile.access_rejected_at;
}

/** Number of open access requests among the profiles the caller can read. */
export function countPendingRequests(
  profiles: ReadonlyArray<{ id: string; access_rejected_at?: string | null }>,
  memberships: ReadonlyArray<{ user_id: string }>,
): number {
  const withAccess = new Set(memberships.map((row) => row.user_id));
  return profiles.filter((profile) => isPendingRequest({
    hasAnyMembership: withAccess.has(profile.id),
    access_rejected_at: profile.access_rejected_at,
  })).length;
}

/**
 * Joins profiles with memberships. Only memberships in `managedClubs` (the
 * active clubs the caller owns) are listed, while `hasAnyMembership` looks at
 * every readable membership so a teammate from another club is never mistaken
 * for an access request.
 */
export function buildTeamMembers(
  profiles: ReadonlyArray<TeamProfileRow>,
  memberships: ReadonlyArray<TeamMembershipRow>,
  managedClubs: ReadonlyArray<Pick<Club, 'id' | 'name'>>,
): TeamMember[] {
  const clubById = new Map(managedClubs.map((club) => [club.id, club]));
  const usersWithAnyMembership = new Set(memberships.map((membership) => membership.user_id));
  const membershipsByUser = new Map<string, TeamMembership[]>();

  for (const membership of memberships) {
    const club = clubById.get(membership.club_id);
    if (!club) continue;
    const userMemberships = membershipsByUser.get(membership.user_id) ?? [];
    userMemberships.push({
      clubId: club.id,
      clubName: club.name,
      role: normalizeTeamRole(membership.role),
      featureAccess: normalizeFeatureAccess(membership.feature_access),
    });
    membershipsByUser.set(membership.user_id, userMemberships);
  }

  for (const userMemberships of Array.from(membershipsByUser.values())) {
    userMemberships.sort((a, b) => a.clubName.localeCompare(b.clubName));
  }

  return profiles.map((profile) => ({
    ...profile,
    memberships: membershipsByUser.get(profile.id) ?? [],
    hasAnyMembership: usersWithAnyMembership.has(profile.id),
  }));
}

/** Members with access to a managed club, most access first: highest role, then clubs, then pages. */
export function sortActiveMembers(members: ReadonlyArray<TeamMember>): TeamMember[] {
  const roleRank: Record<UserRole, number> = { owner: 2, admin: 1, viewer: 0 };
  const accessScore = (member: TeamMember) => {
    const topRole = Math.max(...member.memberships.map((membership) => roleRank[membership.role]));
    const featureCount = member.memberships.reduce(
      (sum, membership) => sum + featureAccessForMembership(membership.role, membership.featureAccess).length,
      0,
    );
    return [topRole, member.memberships.length, featureCount];
  };

  return members
    .filter((member) => member.memberships.length > 0)
    .sort((a, b) => {
      const scoreA = accessScore(a);
      const scoreB = accessScore(b);
      for (let i = 0; i < scoreA.length; i += 1) {
        if (scoreA[i] !== scoreB[i]) return scoreB[i] - scoreA[i];
      }
      return a.full_name.localeCompare(b.full_name);
    });
}

export function ownerCountForClub(members: ReadonlyArray<TeamMember>, clubId: string): number {
  return members.filter((member) =>
    member.memberships.some((membership) => membership.clubId === clubId && membership.role === 'owner'),
  ).length;
}

/** Why a membership change is refused, as a `team.*` message key; null when allowed. */
export type MembershipChangeBlock = 'notClubOwner' | 'selfDemoteBlocked' | 'selfRemoveBlocked' | 'lastOwnerBlocked';

interface MembershipChangeContext {
  members: ReadonlyArray<TeamMember>;
  member: TeamMember;
  membership: TeamMembership;
  currentUserId: string;
  ownedClubIds: ReadonlySet<string>;
}

export function roleChangeBlock(
  { members, member, membership, currentUserId, ownedClubIds }: MembershipChangeContext,
  nextRole: UserRole,
): MembershipChangeBlock | null {
  if (!ownedClubIds.has(membership.clubId)) return 'notClubOwner';
  const demotingOwner = membership.role === 'owner' && nextRole !== 'owner';
  if (demotingOwner && member.id === currentUserId) return 'selfDemoteBlocked';
  if (demotingOwner && ownerCountForClub(members, membership.clubId) <= 1) return 'lastOwnerBlocked';
  return null;
}

export function removalBlock(
  { members, member, membership, currentUserId, ownedClubIds }: MembershipChangeContext,
): MembershipChangeBlock | null {
  if (!ownedClubIds.has(membership.clubId)) return 'notClubOwner';
  if (member.id === currentUserId) return 'selfRemoveBlocked';
  if (membership.role === 'owner' && ownerCountForClub(members, membership.clubId) <= 1) return 'lastOwnerBlocked';
  return null;
}

/** An owner who must stay an owner: the caller themself or a club's only owner. */
export function isProtectedOwner(members: ReadonlyArray<TeamMember>, member: TeamMember, membership: TeamMembership, currentUserId: string) {
  return membership.role === 'owner'
    && (member.id === currentUserId || ownerCountForClub(members, membership.clubId) <= 1);
}

/** Members with access to one club, highest role in that club first, then most pages, then name. */
export function membersOfClub(members: ReadonlyArray<TeamMember>, clubId: string): ClubMember[] {
  const roleRank: Record<UserRole, number> = { owner: 2, admin: 1, viewer: 0 };
  const clubMembers: ClubMember[] = [];
  for (const member of members) {
    const membership = member.memberships.find((item) => item.clubId === clubId);
    if (membership) clubMembers.push({ member, membership });
  }
  const pageCount = ({ membership }: ClubMember) =>
    featureAccessForMembership(membership.role, membership.featureAccess).length;

  return clubMembers.sort((a, b) =>
    roleRank[b.membership.role] - roleRank[a.membership.role]
    || pageCount(b) - pageCount(a)
    || a.member.full_name.localeCompare(b.member.full_name));
}

/**
 * Team changes (approval, rejection, removal) affect counts shown elsewhere,
 * such as the pending-requests badge in the sidebar.
 */
export const TEAM_CHANGED_EVENT = 'game-club-finance:team-changed';

export function notifyTeamChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(TEAM_CHANGED_EVENT));
}
