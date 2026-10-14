import { describe, expect, it } from 'vitest';
import {
  availableClubsForMember,
  buildTeamMembers,
  countPendingRequests,
  isPendingRequest,
  isProtectedOwner,
  removalBlock,
  resolveAccessDraft,
  roleChangeBlock,
  selectedMembershipFor,
  sortActiveMembers,
  type TeamProfileRow,
} from './team';

const profile = (id: string, extra: Partial<TeamProfileRow> = {}): TeamProfileRow => ({
  id,
  full_name: id,
  email: `${id}@example.test`,
  role: 'viewer',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...extra,
});

const clubs = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];

describe('team access rules', () => {
  it('treats only member-less, unrejected profiles as pending', () => {
    expect(isPendingRequest({ hasAnyMembership: false })).toBe(true);
    expect(isPendingRequest({ hasAnyMembership: false, access_rejected_at: null })).toBe(true);
    expect(isPendingRequest({ hasAnyMembership: false, access_rejected_at: '2026-01-02T00:00:00Z' })).toBe(false);
    expect(isPendingRequest({ hasAnyMembership: true })).toBe(false);
  });

  it('counts pending requests the same way as the team page', () => {
    const profiles = [
      profile('member'),
      profile('pending'),
      profile('rejected', { access_rejected_at: '2026-01-02T00:00:00Z' }),
      profile('inactive-club-member'),
    ];
    const memberships = [{ user_id: 'member' }, { user_id: 'inactive-club-member' }];
    expect(countPendingRequests(profiles, memberships)).toBe(1);

    const members = buildTeamMembers(profiles, memberships.map((row) => ({ ...row, club_id: 'z', role: 'viewer' })), clubs);
    expect(members.filter(isPendingRequest).map((member) => member.id)).toEqual(['pending']);
  });

  it('lists only managed clubs but keeps other access out of the pending list', () => {
    const members = buildTeamMembers(
      [profile('x')],
      [
        { club_id: 'b', user_id: 'x', role: 'admin', feature_access: ['reports', 'bogus'] },
        { club_id: 'other', user_id: 'x', role: 'owner' },
        { club_id: 'a', user_id: 'x', role: 'weird' },
      ],
      clubs,
    );
    expect(members[0].hasAnyMembership).toBe(true);
    expect(members[0].memberships).toEqual([
      { clubId: 'a', clubName: 'Alpha', role: 'viewer', featureAccess: null },
      { clubId: 'b', clubName: 'Beta', role: 'admin', featureAccess: ['reports'] },
    ]);
  });

  it('sorts active members by role, clubs, then pages', () => {
    const members = buildTeamMembers(
      [profile('viewer'), profile('owner'), profile('admin-two-clubs'), profile('pending')],
      [
        { club_id: 'a', user_id: 'viewer', role: 'viewer' },
        { club_id: 'a', user_id: 'owner', role: 'owner' },
        { club_id: 'a', user_id: 'admin-two-clubs', role: 'admin' },
        { club_id: 'b', user_id: 'admin-two-clubs', role: 'admin' },
      ],
      clubs,
    );
    expect(sortActiveMembers(members).map((member) => member.id)).toEqual(['owner', 'admin-two-clubs', 'viewer']);
  });

  it('blocks self-demotion, last-owner changes, and changes outside owned clubs', () => {
    const members = buildTeamMembers(
      [profile('me'), profile('co-owner'), profile('admin')],
      [
        { club_id: 'a', user_id: 'me', role: 'owner' },
        { club_id: 'b', user_id: 'co-owner', role: 'owner' },
        { club_id: 'a', user_id: 'admin', role: 'admin' },
      ],
      clubs,
    );
    const [me, coOwner, admin] = members;
    const owned = new Set(['a', 'b']);
    const context = (member = me) => ({ members, member, membership: member.memberships[0], currentUserId: 'me', ownedClubIds: owned });

    expect(roleChangeBlock(context(), 'admin')).toBe('selfDemoteBlocked');
    expect(roleChangeBlock(context(coOwner), 'viewer')).toBe('lastOwnerBlocked');
    expect(roleChangeBlock(context(admin), 'owner')).toBeNull();
    expect(roleChangeBlock({ ...context(admin), ownedClubIds: new Set(['b']) }, 'viewer')).toBe('notClubOwner');

    expect(removalBlock(context())).toBe('selfRemoveBlocked');
    expect(removalBlock(context(coOwner))).toBe('lastOwnerBlocked');
    expect(removalBlock(context(admin))).toBeNull();

    expect(isProtectedOwner(members, me, me.memberships[0], 'me')).toBe(true);
    expect(isProtectedOwner(members, coOwner, coOwner.memberships[0], 'me')).toBe(true);
    expect(isProtectedOwner(members, admin, admin.memberships[0], 'me')).toBe(false);
  });

  it('resolves add-access drafts and the selected membership', () => {
    const [member] = buildTeamMembers([profile('m')], [{ club_id: 'a', user_id: 'm', role: 'viewer' }], clubs);
    expect(availableClubsForMember(member, clubs, new Set(['a', 'b'])).map((club) => club.id)).toEqual(['b']);
    expect(availableClubsForMember(member, clubs, new Set(['a']))).toEqual([]);

    expect(resolveAccessDraft(undefined, ['a', 'b'], 'b')).toEqual({ clubId: 'b', role: 'viewer' });
    expect(resolveAccessDraft({ clubId: 'a', role: 'admin' }, ['a', 'b'], 'b')).toEqual({ clubId: 'a', role: 'admin' });
    expect(resolveAccessDraft({ clubId: 'gone' }, ['a'], 'b')).toEqual({ clubId: 'a', role: 'viewer' });
    expect(resolveAccessDraft(undefined, [], 'b')).toEqual({ clubId: '', role: 'viewer' });

    expect(selectedMembershipFor(member, 'missing', 'a')?.clubId).toBe('a');
  });
});
