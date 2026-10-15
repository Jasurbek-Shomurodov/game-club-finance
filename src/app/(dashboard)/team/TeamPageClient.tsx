'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Avatar,
  Badge,
  type BadgeVariant,
  Button,
  type ButtonVariant,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  LoadErrorAlert,
  Modal,
  PageHeader,
  SearchInput,
  SectionHeading,
  SegmentedControl,
  TableSkeleton,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import {
  Building2,
  ChevronDown,
  Copy,
  Lock,
  Settings2,
  UserPlus,
  Users,
} from 'lucide-react';
import type { UserRole } from '@/types';
import {
  FEATURE_DEFINITIONS,
  featureAccessForMembership,
  updateFeatureAccessSelection,
  type FeatureKey,
} from '@/lib/permissions';
import {
  isPendingRequest,
  TEAM_ROLES,
  isProtectedOwner,
  membersOfClub,
  removalBlock,
  roleChangeBlock,
  sortActiveMembers,
  type TeamMember,
  type TeamMembership,
} from '@/lib/team';
import { AddAccessControls } from './AddAccessControls';
import { MemberAccessPanel } from './MemberAccessPanel';
import { PendingRequestCard } from './PendingRequestCard';
import { useTeamMembers } from './useTeamMembers';

// Member, role, page access, manage: one column set shared by the header and rows.
const MEMBER_GRID = 'grid items-center gap-x-4 px-5 lg:grid-cols-[minmax(0,1.3fr)_110px_minmax(0,1.5fr)_auto]';

// One accent for the highest role; the rest stay quiet.
const ROLE_BADGE_VARIANT: Record<UserRole, BadgeVariant> = {
  owner: 'primary',
  admin: 'neutral',
  viewer: 'outline',
};

export default function TeamPageClient() {
  const t = useTranslations('team');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const {
    account,
    selectedClubId,
    selectedClub,
    role: currentClubRole,
    loading: clubLoading,
    memberships: currentMemberships,
  } = useClub();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const currentUserId = account.userId;
  const [accessRoles, setAccessRoles] = useState<Record<string, UserRole>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [loginUrl, setLoginUrl] = useState('');

  // The shell already blocks this route for non-owners (canAccessPath); this
  // only waits for a club switch to settle and for the signed-in user's id,
  // which the self-demotion and self-removal guards need.
  const isOwner = !clubLoading && currentClubRole === 'owner' && Boolean(currentUserId);

  // Active clubs the signed-in user owns. Only their memberships are listed and
  // managed here; RLS (migration 074) enforces the same per-club boundary.
  const managedClubs = useMemo(
    () => currentMemberships.filter((membership) => membership.role === 'owner').map((membership) => membership.club),
    [currentMemberships],
  );
  const ownedClubIds = useMemo(() => new Set(managedClubs.map((club) => club.id)), [managedClubs]);

  const team = useTeamMembers({ enabled: isOwner, managedClubs });
  const profiles = team.members;

  useEffect(() => {
    setLoginUrl(`${window.location.origin}/login`);
  }, []);

  async function copyLoginLink() {
    try {
      await navigator.clipboard.writeText(loginUrl);
      showToast(t('linkCopied'));
    } catch (copyError) {
      console.error('Failed to copy login link', copyError);
      showToast(t('copyFailed'), 'error');
    }
  }

  function showError(message: string) {
    showToast(message, 'error');
  }

  const pendingProfiles = useMemo(() => profiles.filter(isPendingRequest), [profiles]);
  // The club is chosen in the sidebar switcher; this page only shows and
  // manages access to that one club.
  const clubMembers = useMemo(() => membersOfClub(profiles, selectedClubId), [profiles, selectedClubId]);
  // Teammates from the owner's other clubs who can be added to this one.
  const otherClubProfiles = useMemo(
    () => sortActiveMembers(profiles).filter((profile) => !profile.memberships.some((membership) => membership.clubId === selectedClubId)),
    [profiles, selectedClubId],
  );

  const matchesSearch = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase(locale);
    return (profile: TeamMember) => !query
      || profile.full_name.toLocaleLowerCase(locale).includes(query)
      || Boolean(profile.email?.toLocaleLowerCase(locale).includes(query));
  }, [locale, searchQuery]);
  const roleCounts = useMemo(() => {
    const counts: Record<UserRole, number> = { owner: 0, admin: 0, viewer: 0 };
    for (const { membership } of clubMembers) counts[membership.role] += 1;
    return counts;
  }, [clubMembers]);
  const filteredClubMembers = clubMembers.filter(({ member, membership }) =>
    (roleFilter === 'all' || membership.role === roleFilter) && matchesSearch(member));
  const filteredOtherClubProfiles = otherClubProfiles.filter(matchesSearch);

  function isSavingProfile(profileId: string) {
    return savingId?.startsWith(`${profileId}:`) ?? false;
  }

  function changeContext(profile: TeamMember, membership: TeamMembership) {
    return { members: profiles, member: profile, membership, currentUserId, ownedClubIds };
  }

  async function addClubAccess(profile: TeamMember) {
    const clubId = selectedClubId;
    const role = accessRoles[profile.id] ?? 'viewer';

    if (!clubId || !ownedClubIds.has(clubId)) {
      showError(t('selectClubFirst'));
      return;
    }

    if (role === 'owner') {
      const confirmed = await confirm({
        title: t('promoteOwnerTitle'),
        description: t('promoteOwnerConfirm', { name: profile.full_name, club: selectedClub?.name ?? '' }),
        confirmLabel: t('promoteOwnerAction'),
        tone: 'primary',
      });
      if (!confirmed) return;
    }

    setSavingId(`${profile.id}:${clubId}:add`);
    try {
      if (!await team.addAccess(profile.id, clubId, role)) {
        showError(t('saveError'));
        return;
      }
      showToast(t('accessAdded'));
    } catch (saveError) {
      console.error('Failed to add club access', saveError);
      showError(t('saveError'));
    } finally {
      setSavingId(null);
    }
  }

  async function updateMembershipRole(profile: TeamMember, membership: TeamMembership, role: UserRole) {
    if (membership.role === role) return;

    const blocked = roleChangeBlock(changeContext(profile, membership), role);
    if (blocked) {
      showError(t(blocked));
      return;
    }

    if (role === 'owner' || membership.role === 'owner') {
      const promoting = role === 'owner';
      const confirmed = await confirm({
        title: promoting ? t('promoteOwnerTitle') : t('demoteOwnerTitle'),
        description: promoting
          ? t('promoteOwnerConfirm', { name: profile.full_name, club: membership.clubName })
          : t('demoteOwnerConfirm', { name: profile.full_name, club: membership.clubName, role: t(`roles.${role}`) }),
        confirmLabel: promoting ? t('promoteOwnerAction') : t('demoteOwnerAction'),
        tone: 'primary',
      });
      if (!confirmed) return;
    }

    setSavingId(`${profile.id}:${membership.clubId}:role`);
    try {
      if (!await team.updateRole(profile.id, membership.clubId, role)) {
        showError(t('saveError'));
        return;
      }
      showToast(t('saved'));
    } catch (saveError) {
      console.error('Failed to update role', saveError);
      showError(t('saveError'));
    } finally {
      setSavingId(null);
    }
  }

  async function rejectPendingProfile(profile: TeamMember) {
    const confirmed = await confirm({
      title: t('rejectTitle'),
      description: t('rejectDescription', { name: profile.full_name || profile.email || '' }),
      confirmLabel: t('reject'),
    });
    if (!confirmed) return;

    setSavingId(`${profile.id}:reject`);
    try {
      const result = await team.reject(profile.id);
      if (result === 'has_access') showError(t('rejectHasAccess'));
      else if (result === 'error') showError(t('rejectError'));
      // 'gone': someone else already closed the request; the list is refreshed.
      else showToast(t('rejected'));
    } finally {
      setSavingId(null);
    }
  }

  async function removeClubAccess(profile: TeamMember, membership: TeamMembership) {
    const blocked = removalBlock(changeContext(profile, membership));
    if (blocked) {
      showError(t(blocked));
      return;
    }

    const confirmed = await confirm({
      title: t('removeAccess'),
      description: t('removeClubConfirm', { club: membership.clubName }),
      confirmLabel: t('removeAccess'),
    });
    if (!confirmed) return;

    setSavingId(`${profile.id}:${membership.clubId}:remove`);
    try {
      if (!await team.removeAccess(profile.id, membership.clubId)) {
        showError(t('saveError'));
        return;
      }
      showToast(t('removed'));
    } catch (saveError) {
      console.error('Failed to remove club access', saveError);
      showError(t('saveError'));
    } finally {
      setSavingId(null);
    }
  }

  async function updateMembershipFeatureAccess(
    profile: TeamMember,
    membership: TeamMembership,
    featureKey: FeatureKey,
    enabled: boolean,
  ) {
    const definition = FEATURE_DEFINITIONS.find((feature) => feature.key === featureKey);
    if (membership.role === 'owner' || (definition && 'ownerOnly' in definition && definition.ownerOnly)) return;
    if (!ownedClubIds.has(membership.clubId)) return;

    const currentAccess = featureAccessForMembership(membership.role, membership.featureAccess);
    const nextAccess = updateFeatureAccessSelection(currentAccess, featureKey, enabled);

    setSavingId(`${profile.id}:${membership.clubId}:features`);
    try {
      if (!await team.updateFeatureAccess(profile.id, membership.clubId, nextAccess, membership.featureAccess)) {
        showError(t('saveError'));
        return;
      }
      showToast(t('featureAccessSaved'));
    } finally {
      setSavingId(null);
    }
  }

  function renderAccessControls(profile: TeamMember, buttonLabel: string, buttonVariant: ButtonVariant = 'primary') {
    return (
      <AddAccessControls
        role={accessRoles[profile.id] ?? 'viewer'}
        saving={isSavingProfile(profile.id)}
        buttonLabel={buttonLabel}
        buttonVariant={buttonVariant}
        onRoleChange={(role) => setAccessRoles((current) => ({ ...current, [profile.id]: role }))}
        onSubmit={() => void addClubAccess(profile)}
      />
    );
  }

  /** Pages a member can open in this club, out of the pages a non-owner can be given. */
  function pageAccessFor(membership: TeamMembership) {
    const grantable = FEATURE_DEFINITIONS.filter((feature) => !('ownerOnly' in feature && feature.ownerOnly));
    if (membership.role === 'owner') return { all: true, count: grantable.length, total: grantable.length, labels: [] as string[] };
    const access = featureAccessForMembership(membership.role, membership.featureAccess);
    const labels = grantable
      .filter((feature) => access.includes(feature.key))
      .map((feature) => t(`features.${feature.labelKey}`));
    return { all: labels.length === grantable.length, count: labels.length, total: grantable.length, labels };
  }

  function renderPageAccess(membership: TeamMembership) {
    const access = pageAccessFor(membership);
    const percent = access.total ? Math.round((access.count / access.total) * 100) : 0;
    const shown = access.labels.slice(0, 3);
    const hidden = access.labels.length - shown.length;

    return (
      <div className="min-w-0" title={access.labels.join(', ') || undefined}>
        <div className="flex items-center gap-2.5">
          <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
            <div
              className={cn('h-full rounded-full', access.all ? 'bg-primary-500' : 'bg-gray-400')}
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-xs font-medium tabular-nums text-gray-700">
            {membership.role === 'owner' ? t('everything') : t('pagesOfTotal', { count: access.count, total: access.total })}
          </span>
        </div>
        {shown.length > 0 && !access.all && (
          <p className="mt-1 truncate text-xs text-gray-500">
            {shown.join(' · ')}
            {hidden > 0 && <span className="text-gray-400"> · {t('morePages', { count: hidden })}</span>}
          </p>
        )}
      </div>
    );
  }

  if (!clubLoading && currentClubRole !== 'owner') {
    return (
      <Card>
        <EmptyState icon={Lock} title={tc('accessDeniedTitle')} description={tc('accessDeniedDescription')} />
      </Card>
    );
  }

  if (!isOwner) return <TableSkeleton rows={6} columns={4} />;

  const loading = team.loading;

  return (
    <div>
      <PageHeader
        title={t('title')}
        action={(
          <Button onClick={() => setInviteOpen(true)} icon={<UserPlus size={16} aria-hidden="true" />}>
            {t('invite')}
          </Button>
        )}
      />

      {team.loadFailed && (
        <LoadErrorAlert className="mb-4" retrying={loading} onRetry={() => void team.load()}>
          {t('loadError')}
        </LoadErrorAlert>
      )}

      {loading ? (
        <TableSkeleton rows={7} columns={4} />
      ) : (
        <div className="space-y-6">
          {pendingProfiles.length > 0 && (
            <section aria-label={t('pendingApproval')} className="space-y-3">
              {pendingProfiles.map((profile) => (
                <PendingRequestCard
                  key={profile.id}
                  member={profile}
                  accessControls={renderAccessControls(profile, t('approve'), 'success')}
                  rejecting={savingId === `${profile.id}:reject`}
                  busy={Boolean(savingId)}
                  onReject={() => void rejectPendingProfile(profile)}
                />
              ))}
            </section>
          )}

          {clubMembers.length === 0 ? (
            <Card><EmptyState icon={Users} title={tc('noData')} /></Card>
          ) : (
            <Card as="section" padding="none" className="overflow-hidden">
              <CardHeader className="space-y-4">
                <SectionHeading
                  title={t('members')}
                  badge={<Badge variant="neutral">{clubMembers.length}</Badge>}
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <SegmentedControl
                    variant="chips"
                    size="sm"
                    label={t('role')}
                    value={roleFilter}
                    onChange={setRoleFilter}
                    options={[
                      { value: 'all', label: `${t('allRoles')} · ${clubMembers.length}` },
                      ...TEAM_ROLES
                        .filter((role) => roleCounts[role] > 0)
                        .map((role) => ({ value: role, label: `${t(`roles.${role}`)} · ${roleCounts[role]}` })),
                    ]}
                  />
                  <SearchInput
                    className="w-full sm:w-72"
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder={t('searchPlaceholder')}
                    clearLabel={t('clearSearch')}
                  />
                </div>
              </CardHeader>

              {filteredClubMembers.length === 0 ? (
                <EmptyState
                  compact
                  icon={Users}
                  title={t('noSearchResults')}
                  action={(
                    <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(''); setRoleFilter('all'); }}>
                      {t('clearSearch')}
                    </Button>
                  )}
                />
              ) : (
                <>
                  <div className={cn(MEMBER_GRID, 'hidden border-b border-gray-100 bg-gray-50/60 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 lg:grid')}>
                    <span>{t('member')}</span>
                    <span>{t('role')}</span>
                    <span>{t('pageAccess')}</span>
                    <span className="sr-only">{t('manageAccess')}</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {filteredClubMembers.map(({ member: profile, membership }) => {
                      const expanded = expandedMemberId === profile.id;
                      const saving = isSavingProfile(profile.id);

                      return (
                        <article key={profile.id} className={cn(expanded && 'bg-gray-50/40')}>
                          <div className={cn(MEMBER_GRID, 'grid-cols-[minmax(0,1fr)_auto] gap-y-3 py-3.5 transition-colors', !expanded && 'hover:bg-gray-50/60')}>
                            <div className="flex min-w-0 items-center gap-3">
                              <Avatar name={profile.full_name} tone={membership.role === 'viewer' ? 'neutral' : 'primary'} />
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
                                  <h3 className="truncate text-sm font-semibold text-gray-950" title={profile.full_name}>{profile.full_name}</h3>
                                  {profile.id === currentUserId && <Badge variant="outline" size="sm">{t('you')}</Badge>}
                                </div>
                                {profile.email && profile.email !== profile.full_name && (
                                  <p className="mt-0.5 truncate text-xs text-gray-500" title={profile.email}>{profile.email}</p>
                                )}
                              </div>
                            </div>

                            <div className="order-3 col-span-2 flex items-center gap-3 pl-12 lg:order-none lg:col-span-1 lg:pl-0">
                              <Badge size="sm" variant={ROLE_BADGE_VARIANT[membership.role]}>
                                {t(`roles.${membership.role}`)}
                              </Badge>
                              {team.featureAccessAvailable && <div className="min-w-0 flex-1 lg:hidden">{renderPageAccess(membership)}</div>}
                            </div>

                            <div className="hidden min-w-0 lg:block">
                              {team.featureAccessAvailable && renderPageAccess(membership)}
                            </div>

                            <Button
                              variant={expanded ? 'outline' : 'ghost'}
                              size="sm"
                              className="justify-self-end"
                              onClick={() => setExpandedMemberId(expanded ? null : profile.id)}
                              aria-label={t('manageMember', { name: profile.full_name })}
                              aria-expanded={expanded}
                              aria-controls={`member-access-${profile.id}`}
                              icon={<Settings2 size={15} aria-hidden="true" />}
                              iconRight={<ChevronDown size={14} className={cn('shrink-0 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />}
                            >
                              <span className="hidden sm:inline">{t('manageAccess')}</span>
                            </Button>
                          </div>

                          {expanded && (
                            <MemberAccessPanel
                              member={profile}
                              membership={membership}
                              isCurrentUser={profile.id === currentUserId}
                              canManage={ownedClubIds.has(membership.clubId)}
                              protectedOwner={isProtectedOwner(profiles, profile, membership, currentUserId)}
                              saving={saving}
                              savingFeatures={savingId === `${profile.id}:${membership.clubId}:features`}
                              featureAccessAvailable={team.featureAccessAvailable}
                              onRoleChange={(role) => void updateMembershipRole(profile, membership, role)}
                              onFeatureChange={(featureKey, enabled) => void updateMembershipFeatureAccess(profile, membership, featureKey, enabled)}
                              onRemove={() => void removeClubAccess(profile, membership)}
                              onClose={() => setExpandedMemberId(null)}
                            />
                          )}
                        </article>
                      );
                    })}
                  </div>
                </>
              )}
            </Card>
          )}

          {filteredOtherClubProfiles.length > 0 && (
            <Card as="section" padding="none" className="overflow-hidden">
              <CardHeader>
                <SectionHeading
                  title={t('otherClubMembers')}
                  description={t('otherClubMembersHelp', { club: selectedClub?.name ?? '' })}
                  badge={<Badge variant="neutral">{filteredOtherClubProfiles.length}</Badge>}
                />
              </CardHeader>
              <div className="divide-y divide-gray-100">
                {filteredOtherClubProfiles.map((profile) => (
                  <article
                    key={profile.id}
                    className="grid items-center gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:gap-5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={profile.full_name} tone="neutral" />
                      <div className="min-w-0">
                        <h3 className="break-words text-sm font-semibold text-gray-950">{profile.full_name}</h3>
                        {profile.email && <p className="mt-0.5 truncate text-xs text-gray-500" title={profile.email}>{profile.email}</p>}
                      </div>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {profile.memberships.map((item) => (
                        <Badge key={item.clubId} size="sm" variant="outline" icon={<Building2 size={12} aria-hidden="true" />}>
                          {item.clubName}
                        </Badge>
                      ))}
                    </div>
                    <div className="min-w-0 lg:w-[280px]">
                      {renderAccessControls(profile, t('addToClub'), 'outline')}
                    </div>
                  </article>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t('inviteTitle')}
        footer={<Button variant="ghost" onClick={() => setInviteOpen(false)}>{tc('close')}</Button>}
      >
        <p className="text-sm leading-6 text-gray-600">{t('inviteHelp')}</p>
        <Field label={t('loginLink')} htmlFor="team-login-link" className="mt-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="team-login-link" readOnly value={loginUrl} onFocus={(event) => event.currentTarget.select()} className="font-mono sm:text-[13px]" />
            <Button variant="outline" className="shrink-0" onClick={() => void copyLoginLink()} icon={<Copy size={16} aria-hidden="true" />}>
              {t('copyLink')}
            </Button>
          </div>
        </Field>
      </Modal>

      {toastElement}
      {confirmDialog}
    </div>
  );
}
