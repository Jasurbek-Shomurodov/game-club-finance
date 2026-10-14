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
  InlineAlert,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  SectionHeading,
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
  availableClubsForMember,
  isPendingRequest,
  isProtectedOwner,
  removalBlock,
  resolveAccessDraft,
  roleChangeBlock,
  selectedMembershipFor,
  sortActiveMembers,
  type AccessDraft,
  type TeamMember,
  type TeamMembership,
} from '@/lib/team';
import { AddAccessControls } from './AddAccessControls';
import { MemberAccessPanel } from './MemberAccessPanel';
import { PendingRequestCard } from './PendingRequestCard';
import { useTeamMembers } from './useTeamMembers';

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
    role: currentClubRole,
    loading: clubLoading,
    memberships: currentMemberships,
    refreshClubs,
  } = useClub();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const currentUserId = account.userId;
  const [accessDrafts, setAccessDrafts] = useState<Record<string, AccessDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [expandedAddAccessId, setExpandedAddAccessId] = useState<string | null>(null);
  const [membershipSelection, setMembershipSelection] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
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
  const activeProfiles = useMemo(() => sortActiveMembers(profiles), [profiles]);

  const filteredActiveProfiles = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase(locale);
    if (!query) return activeProfiles;

    return activeProfiles.filter((profile) =>
      profile.full_name.toLocaleLowerCase(locale).includes(query)
      || profile.email?.toLocaleLowerCase(locale).includes(query)
      || profile.memberships.some((membership) => membership.clubName.toLocaleLowerCase(locale).includes(query)),
    );
  }, [activeProfiles, locale, searchQuery]);

  function availableClubsForProfile(profile: TeamMember) {
    return availableClubsForMember(profile, managedClubs, ownedClubIds);
  }

  function draftForProfile(profile: TeamMember) {
    return resolveAccessDraft(
      accessDrafts[profile.id],
      availableClubsForProfile(profile).map((club) => club.id),
      selectedClubId,
    );
  }

  function updateAccessDraft(profileId: string, patch: Partial<AccessDraft>) {
    setAccessDrafts((current) => ({
      ...current,
      [profileId]: {
        clubId: current[profileId]?.clubId ?? '',
        role: current[profileId]?.role ?? 'viewer',
        ...patch,
      },
    }));
  }

  function isSavingProfile(profileId: string) {
    return savingId?.startsWith(`${profileId}:`) ?? false;
  }

  function changeContext(profile: TeamMember, membership: TeamMembership) {
    return { members: profiles, member: profile, membership, currentUserId, ownedClubIds };
  }

  async function refreshOwnClubsIfSelf(profile: TeamMember) {
    if (profile.id === currentUserId) await refreshClubs();
  }

  async function addClubAccess(profile: TeamMember) {
    const draft = draftForProfile(profile);

    if (!draft.clubId || !ownedClubIds.has(draft.clubId)) {
      showError(t('selectClubFirst'));
      return;
    }

    if (draft.role === 'owner') {
      const clubName = managedClubs.find((club) => club.id === draft.clubId)?.name ?? '';
      const confirmed = await confirm({
        title: t('promoteOwnerTitle'),
        description: t('promoteOwnerConfirm', { name: profile.full_name, club: clubName }),
        confirmLabel: t('promoteOwnerAction'),
        tone: 'primary',
      });
      if (!confirmed) return;
    }

    setSavingId(`${profile.id}:${draft.clubId}:add`);
    try {
      if (!await team.addAccess(profile.id, draft.clubId, draft.role)) {
        showError(t('saveError'));
        return;
      }
      showToast(t('accessAdded'));
      await refreshOwnClubsIfSelf(profile);
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
      await refreshOwnClubsIfSelf(profile);
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
      await refreshOwnClubsIfSelf(profile);
    } finally {
      setSavingId(null);
    }
  }

  function renderAccessControls(profile: TeamMember, buttonLabel: string, buttonVariant: ButtonVariant = 'primary') {
    return (
      <AddAccessControls
        availableClubs={availableClubsForProfile(profile)}
        draft={draftForProfile(profile)}
        saving={isSavingProfile(profile.id)}
        ownsAnyClub={managedClubs.length > 0}
        buttonLabel={buttonLabel}
        buttonVariant={buttonVariant}
        onDraftChange={(patch) => updateAccessDraft(profile.id, patch)}
        onSubmit={() => void addClubAccess(profile)}
      />
    );
  }

  /** "Касса, Склад, Долги" — or "Всё" for owners. */
  function pageAccessSummary(membership: TeamMembership) {
    if (membership.role === 'owner') return t('everything');
    const access = featureAccessForMembership(membership.role, membership.featureAccess);
    return FEATURE_DEFINITIONS
      .filter((feature) => !('ownerOnly' in feature && feature.ownerOnly) && access.includes(feature.key))
      .map((feature) => t(`features.${feature.labelKey}`))
      .join(', ');
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
        <InlineAlert
          variant="danger"
          className="mb-4"
          action={<Button variant="outline" size="sm" disabled={loading} onClick={() => void team.load()}>{tc('retry')}</Button>}
        >
          {t('loadError')}
        </InlineAlert>
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

          {activeProfiles.length === 0 ? (
            <Card><EmptyState icon={Users} title={tc('noData')} /></Card>
          ) : (
            <Card as="section" padding="none" className="overflow-hidden">
              <CardHeader>
                <SectionHeading
                  title={t('members')}
                  badge={<Badge variant="neutral">{activeProfiles.length}</Badge>}
                  action={(
                    <SearchInput
                      className="w-full sm:w-72"
                      value={searchQuery}
                      onChange={setSearchQuery}
                      placeholder={t('searchPlaceholder')}
                      clearLabel={t('clearSearch')}
                    />
                  )}
                />
              </CardHeader>

              {filteredActiveProfiles.length === 0 ? (
                <EmptyState
                  compact
                  icon={Users}
                  title={t('noSearchResults')}
                  action={<Button variant="ghost" size="sm" onClick={() => setSearchQuery('')}>{t('clearSearch')}</Button>}
                />
              ) : (
                <div className="divide-y divide-gray-100">
                  {filteredActiveProfiles.map((profile) => {
                    const membership = selectedMembershipFor(profile, membershipSelection[profile.id], selectedClubId);
                    if (!membership) return null;
                    const expanded = expandedMemberId === profile.id;
                    const addAccessExpanded = expandedAddAccessId === profile.id;
                    const saving = isSavingProfile(profile.id);

                    return (
                      <article key={profile.id}>
                        <div className={cn(
                          'grid items-center gap-3 px-5 py-4 transition-colors sm:grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_auto] lg:gap-5',
                          !expanded && 'hover:bg-gray-50/60',
                        )}>
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar name={profile.full_name} tone={membership.role === 'viewer' ? 'neutral' : 'primary'} />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="break-words text-sm font-semibold text-gray-950">{profile.full_name}</h3>
                                {profile.id === currentUserId && <Badge variant="outline" size="sm">{t('you')}</Badge>}
                              </div>
                              {profile.email && <p className="mt-0.5 truncate text-xs text-gray-500" title={profile.email}>{profile.email}</p>}
                            </div>
                          </div>

                          <div className="min-w-0 sm:order-3 sm:col-span-2 lg:order-none lg:col-span-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge size="sm" variant={ROLE_BADGE_VARIANT[membership.role]}>
                                {t(`roles.${membership.role}`)}
                              </Badge>
                              {profile.memberships.map((item) => (
                                <Badge key={item.clubId} size="sm" variant="outline" icon={<Building2 size={12} aria-hidden="true" />}>
                                  {item.clubName}
                                </Badge>
                              ))}
                            </div>
                            {team.featureAccessAvailable && (
                              <p className="mt-1.5 line-clamp-2 text-xs text-gray-500" title={pageAccessSummary(membership)}>
                                {pageAccessSummary(membership)}
                              </p>
                            )}
                          </div>

                          <Button
                            variant="ghost"
                            size="sm"
                            className="sm:order-2 lg:order-none"
                            onClick={() => {
                              setExpandedMemberId(expanded ? null : profile.id);
                              setExpandedAddAccessId(null);
                            }}
                            aria-label={t('manageMember', { name: profile.full_name })}
                            aria-expanded={expanded}
                            aria-controls={`member-access-${profile.id}`}
                            icon={<Settings2 size={15} aria-hidden="true" />}
                            iconRight={<ChevronDown size={14} className={cn('shrink-0 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />}
                          >
                            {t('manageAccess')}
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
                            hasAvailableClubs={availableClubsForProfile(profile).length > 0}
                            addAccessExpanded={addAccessExpanded}
                            addAccessControls={renderAccessControls(profile, t('addAccess'))}
                            onSelectClub={(clubId) => {
                              setMembershipSelection((current) => ({ ...current, [profile.id]: clubId }));
                              setExpandedAddAccessId(null);
                            }}
                            onRoleChange={(role) => void updateMembershipRole(profile, membership, role)}
                            onToggleAddAccess={() => setExpandedAddAccessId(addAccessExpanded ? null : profile.id)}
                            onFeatureChange={(featureKey, enabled) => void updateMembershipFeatureAccess(profile, membership, featureKey, enabled)}
                            onRemove={() => void removeClubAccess(profile, membership)}
                            onClose={() => setExpandedMemberId(null)}
                          />
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
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
