'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Avatar,
  Badge,
  type BadgeVariant,
  Button,
  type ButtonVariant,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  IconButton,
  InlineAlert,
  Input,
  Modal,
  PageHeader,
  SearchInput,
  SectionHeading,
  Select,
  TableSkeleton,
  useConfirm,
  useToast,
} from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { formatDateTime } from '@/lib/formatters';
import { isMissingDatabaseColumn } from '@/lib/supabase/errors';
import {
  Building2,
  ChevronDown,
  Copy,
  Lock,
  Settings2,
  X,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import type { Club, Profile, UserRole } from '@/types';
import {
  FEATURE_DEFINITIONS,
  featureAccessForMembership,
  normalizeFeatureAccess,
  updateFeatureAccessSelection,
  type FeatureKey,
} from '@/lib/permissions';

const ROLES: UserRole[] = ['owner', 'admin', 'viewer'];

interface TeamMembership {
  clubId: string;
  clubName: string;
  role: UserRole;
  featureAccess: FeatureKey[] | null;
}

interface TeamMember extends Profile {
  memberships: TeamMembership[];
  /** Has a membership in some club, including inactive clubs not listed here. */
  hasAnyMembership: boolean;
  access_rejected_at?: string | null;
}

interface AccessDraft {
  clubId: string;
  role: UserRole;
}

function normalizeRole(role: string | null | undefined): UserRole {
  return role === 'owner' || role === 'admin' || role === 'viewer' ? role : 'viewer';
}

// One accent for the highest role; the rest stay quiet.
const ROLE_BADGE_VARIANT: Record<UserRole, BadgeVariant> = {
  owner: 'primary',
  admin: 'neutral',
  viewer: 'outline',
};

export default function TeamPageClient() {
  const router = useRouter();
  const t = useTranslations('team');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const { selectedClubId, role: currentClubRole, loading: clubLoading, memberships: currentMemberships, refreshClubs } = useClub();
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const requestSequence = useRef(0);
  const [currentUserId, setCurrentUserId] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [profiles, setProfiles] = useState<TeamMember[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [accessDrafts, setAccessDrafts] = useState<Record<string, AccessDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [expandedAddAccessId, setExpandedAddAccessId] = useState<string | null>(null);
  const [membershipSelection, setMembershipSelection] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [featureAccessAvailable, setFeatureAccessAvailable] = useState(true);
  const [error, setError] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [loginUrl, setLoginUrl] = useState('');

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

  // Clubs the signed-in user owns. Membership changes are only offered for these;
  // other clubs are shown read-only (RLS enforces the same boundary).
  const ownedClubIds = useMemo(
    () => new Set(currentMemberships.filter((membership) => membership.role === 'owner').map((membership) => membership.club.id)),
    [currentMemberships],
  );

  const showError = useCallback((message: string) => {
    showToast(message, 'error');
  }, [showToast]);

  const fetchProfiles = useCallback(async (requestId: number) => {
    const supabase = createClient();
    const [membershipRes, profileRes, clubRes] = await Promise.all([
      supabase
        .from('club_memberships')
        .select('club_id, user_id, role, feature_access, created_at')
        .order('created_at', { ascending: true }),
      supabase
        .from('profiles')
        .select('id, full_name, email, role, created_at, updated_at, access_rejected_at')
        .order('full_name', { ascending: true }),
      supabase
        .from('clubs')
        .select('id, name, address, is_active, created_at, updated_at')
        .eq('is_active', true)
        .order('name', { ascending: true }),
    ]);

    if (requestId !== requestSequence.current) return;

    let membershipRows = (membershipRes.data ?? []) as Array<{
      club_id: string;
      user_id: string;
      role: string;
      feature_access?: string[] | null;
    }>;
    let membershipError = membershipRes.error;

    if (isMissingDatabaseColumn(membershipRes.error, 'feature_access')) {
      const fallbackMembershipRes = await supabase
        .from('club_memberships')
        .select('club_id, user_id, role, created_at')
        .order('created_at', { ascending: true });
      if (requestId !== requestSequence.current) return;
      membershipRows = (fallbackMembershipRes.data ?? []) as typeof membershipRows;
      membershipError = fallbackMembershipRes.error;
      setFeatureAccessAvailable(false);
    } else {
      setFeatureAccessAvailable(true);
    }

    let profileRows = (profileRes.data ?? []) as Array<Profile & { access_rejected_at?: string | null }>;
    let profileError = profileRes.error;

    // Before 072 there is no rejection mark; every member-less profile is pending.
    if (isMissingDatabaseColumn(profileRes.error, 'access_rejected_at')) {
      const fallbackProfileRes = await supabase
        .from('profiles')
        .select('id, full_name, email, role, created_at, updated_at')
        .order('full_name', { ascending: true });
      if (requestId !== requestSequence.current) return;
      profileRows = (fallbackProfileRes.data ?? []) as typeof profileRows;
      profileError = fallbackProfileRes.error;
    }

    if (membershipError || profileError || clubRes.error) {
      console.error('Failed to load team', membershipError ?? profileError ?? clubRes.error);
      setError(t('loadError'));
      setProfiles([]);
      setClubs([]);
      setLoading(false);
      return;
    }

    const clubRows = ((clubRes.data as Club[] | null) ?? []);
    const clubById = new Map(clubRows.map((club) => [club.id, club]));
    const membershipsByUser = new Map<string, TeamMembership[]>();
    const usersWithAnyMembership = new Set(membershipRows.map((membership) => membership.user_id));

    for (const membership of membershipRows) {
      const club = clubById.get(membership.club_id);
      if (!club) continue;

      const userMemberships = membershipsByUser.get(membership.user_id) ?? [];
      userMemberships.push({
        clubId: club.id,
        clubName: club.name,
        role: normalizeRole(membership.role),
        featureAccess: normalizeFeatureAccess(membership.feature_access),
      });
      membershipsByUser.set(membership.user_id, userMemberships);
    }

    for (const userMemberships of Array.from(membershipsByUser.values())) {
      userMemberships.sort((a, b) => a.clubName.localeCompare(b.clubName));
    }

    const teamRows = profileRows.map((profile) => ({
      ...profile,
      memberships: membershipsByUser.get(profile.id) ?? [],
      hasAnyMembership: usersWithAnyMembership.has(profile.id),
    }));

    setClubs(clubRows);
    setProfiles(teamRows);
    setLoading(false);
  }, [t]);

  const loadProfiles = useCallback(async ({ silent = false } = {}) => {
    const requestId = ++requestSequence.current;
    if (!selectedClubId) {
      setProfiles([]);
      setClubs([]);
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    setError('');
    try {
      await fetchProfiles(requestId);
    } catch (loadError) {
      if (requestId !== requestSequence.current) return;
      console.error('Failed to load team', loadError);
      setError(t('loadError'));
      setLoading(false);
    }
  }, [fetchProfiles, selectedClubId, t]);


  useEffect(() => {
    let cancelled = false;

    async function authorize() {
      if (clubLoading) return;

      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace('/login');
        return;
      }

      if (cancelled) return;

      if (currentClubRole !== 'owner') {
        setAuthorized(false);
        setAccessDenied(true);
        return;
      }

      setCurrentUserId(session.user.id);
      setAccessDenied(false);
      setAuthorized(true);
    }

    authorize().catch((err) => {
      if (cancelled) return;
      console.error('Failed to authorize team page', err);
      setError(t('loadError'));
      setAuthorized(false);
      setAccessDenied(false);
    });

    return () => {
      cancelled = true;
    };
  }, [clubLoading, currentClubRole, router, t]);

  useEffect(() => {
    if (!authorized) return;
    void loadProfiles();
    return () => { requestSequence.current += 1; };
  }, [authorized, loadProfiles]);

  const pendingProfiles = useMemo(
    // A request is someone with no club access at all; access to an inactive
    // club still counts, and the server refuses to reject such a person.
    () => profiles.filter((profile) => !profile.hasAnyMembership && !profile.access_rejected_at),
    [profiles],
  );

  // Most access first: highest role, then number of clubs, then number of permissions.
  const activeProfiles = useMemo(() => {
    const roleRank: Record<UserRole, number> = { owner: 2, admin: 1, viewer: 0 };
    const accessScore = (profile: TeamMember) => {
      const topRole = Math.max(...profile.memberships.map((membership) => roleRank[membership.role]));
      const featureCount = profile.memberships.reduce(
        (sum, membership) => sum + featureAccessForMembership(membership.role, membership.featureAccess).length,
        0,
      );
      return [topRole, profile.memberships.length, featureCount];
    };

    return profiles
      .filter((profile) => profile.memberships.length > 0)
      .sort((a, b) => {
        const scoreA = accessScore(a);
        const scoreB = accessScore(b);
        for (let i = 0; i < scoreA.length; i += 1) {
          if (scoreA[i] !== scoreB[i]) return scoreB[i] - scoreA[i];
        }
        return a.full_name.localeCompare(b.full_name);
      });
  }, [profiles]);

  const filteredActiveProfiles = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase(locale);
    if (!query) return activeProfiles;

    return activeProfiles.filter((profile) =>
      profile.full_name.toLocaleLowerCase(locale).includes(query)
      || profile.email?.toLocaleLowerCase(locale).includes(query)
      || profile.memberships.some((membership) => membership.clubName.toLocaleLowerCase(locale).includes(query)),
    );
  }, [activeProfiles, locale, searchQuery]);

  function ownerCountForClub(clubId: string) {
    return profiles.filter((profile) =>
      profile.memberships.some((membership) => membership.clubId === clubId && membership.role === 'owner'),
    ).length;
  }

  function availableClubsForProfile(profile: TeamMember) {
    const assignedClubIds = new Set(profile.memberships.map((membership) => membership.clubId));
    return clubs.filter((club) => ownedClubIds.has(club.id) && !assignedClubIds.has(club.id));
  }

  function draftForProfile(profile: TeamMember) {
    const availableClubs = availableClubsForProfile(profile);
    const currentDraft = accessDrafts[profile.id];
    const clubId =
      (currentDraft?.clubId && availableClubs.some((club) => club.id === currentDraft.clubId)
        ? currentDraft.clubId
        : '') ||
      availableClubs.find((club) => club.id === selectedClubId)?.id ||
      availableClubs[0]?.id ||
      '';

    return {
      clubId,
      role: currentDraft?.role ?? 'viewer',
    };
  }

  function selectedMembershipForProfile(profile: TeamMember): TeamMembership | undefined {
    const preferredClubId = membershipSelection[profile.id];
    return profile.memberships.find((membership) => membership.clubId === preferredClubId)
      ?? profile.memberships.find((membership) => membership.clubId === selectedClubId)
      ?? profile.memberships[0];
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

  async function addClubAccess(profile: TeamMember) {
    const draft = draftForProfile(profile);

    if (!draft.clubId || !ownedClubIds.has(draft.clubId)) {
      showError(t('selectClubFirst'));
      return;
    }

    if (draft.role === 'owner') {
      const clubName = clubs.find((club) => club.id === draft.clubId)?.name ?? '';
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
      const supabase = createClient();
      const { error: insertError } = await supabase
        .from('club_memberships')
        .insert({
          club_id: draft.clubId,
          user_id: profile.id,
          role: draft.role,
        });

      if (insertError) {
        console.error('Failed to add club access', insertError);
        showError(t('saveError'));
        return;
      }

      showToast(t('accessAdded'));
      await loadProfiles({ silent: true });

      if (profile.id === currentUserId) {
        await refreshClubs();
      }
    } catch (saveError) {
      console.error('Failed to add club access', saveError);
      showError(t('saveError'));
    } finally {
      setSavingId(null);
    }
  }

  async function updateMembershipRole(profile: TeamMember, membership: TeamMembership, role: UserRole) {
    if (membership.role === role) return;

    if (!ownedClubIds.has(membership.clubId)) {
      showError(t('notClubOwner'));
      return;
    }

    if (profile.id === currentUserId && membership.role === 'owner' && role !== 'owner') {
      showError(t('selfDemoteBlocked'));
      return;
    }

    if (membership.role === 'owner' && role !== 'owner' && ownerCountForClub(membership.clubId) <= 1) {
      showError(t('lastOwnerBlocked'));
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
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from('club_memberships')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('club_id', membership.clubId)
        .eq('user_id', profile.id);

      if (updateError) {
        console.error('Failed to update role', updateError);
        showError(t('saveError'));
        return;
      }

      showToast(t('saved'));
      await loadProfiles({ silent: true });

      if (profile.id === currentUserId) {
        await refreshClubs();
      }
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
      // Deletes the sign-up server-side; only allowed while the person has no club access.
      const response = await fetch('/api/team/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: profile.id }),
      });
      if (response.status === 409) {
        showError(t('rejectHasAccess'));
        await loadProfiles({ silent: true });
        return;
      }
      if (!response.ok) throw new Error(`Reject failed: ${response.status}`);
      showToast(t('rejected'));
      await loadProfiles({ silent: true });
    } catch (rejectError) {
      console.error('Failed to reject request', rejectError);
      showError(t('rejectError'));
    } finally {
      setSavingId(null);
    }
  }

  async function removeClubAccess(profile: TeamMember, membership: TeamMembership) {
    if (!ownedClubIds.has(membership.clubId)) {
      showError(t('notClubOwner'));
      return;
    }

    if (profile.id === currentUserId) {
      showError(t('selfRemoveBlocked'));
      return;
    }

    if (membership.role === 'owner' && ownerCountForClub(membership.clubId) <= 1) {
      showError(t('lastOwnerBlocked'));
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
      const supabase = createClient();
      const { error: deleteError } = await supabase
        .from('club_memberships')
        .delete()
        .eq('club_id', membership.clubId)
        .eq('user_id', profile.id);

      if (deleteError) {
        console.error('Failed to remove club access', deleteError);
        showError(t('saveError'));
        return;
      }

      showToast(t('removed'));
      await loadProfiles({ silent: true });
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
    const membershipSavingId = `${profile.id}:${membership.clubId}:features`;

    setSavingId(membershipSavingId);
    setProfiles((current) => current.map((member) => member.id !== profile.id
      ? member
      : {
          ...member,
          memberships: member.memberships.map((item) => item.clubId === membership.clubId
            ? { ...item, featureAccess: nextAccess }
            : item),
        }));

    const rollback = () => setProfiles((current) => current.map((member) => member.id !== profile.id
      ? member
      : {
          ...member,
          memberships: member.memberships.map((item) => item.clubId === membership.clubId
            ? { ...item, featureAccess: membership.featureAccess }
            : item),
        }));

    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from('club_memberships')
        .update({ feature_access: nextAccess, updated_at: new Date().toISOString() })
        .eq('club_id', membership.clubId)
        .eq('user_id', profile.id);

      if (updateError) {
        console.error('Failed to update feature access', updateError);
        rollback();
        showError(t('saveError'));
        return;
      }

      showToast(t('featureAccessSaved'));
      if (profile.id === currentUserId) await refreshClubs();
    } catch (saveError) {
      console.error('Failed to update feature access', saveError);
      rollback();
      showError(t('saveError'));
    } finally {
      setSavingId(null);
    }
  }

  function renderAccessControls(profile: TeamMember, buttonLabel: string, buttonVariant: ButtonVariant = 'primary') {
    const availableClubs = availableClubsForProfile(profile);
    const draft = draftForProfile(profile);
    const saving = isSavingProfile(profile.id);

    if (availableClubs.length === 0) {
      const ownsAnyOtherClub = clubs.some((club) => ownedClubIds.has(club.id));
      return (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-surface px-4 py-3 text-sm font-medium text-gray-500">
          <ShieldCheck size={16} className="text-success-500" aria-hidden="true" />
          {ownsAnyOtherClub ? t('allClubsAdded') : t('noOwnedClubs')}
        </div>
      );
    }

    return (
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
        <Select
          leadingIcon={<Building2 size={16} />}
          aria-label={t('gameClubs')}
          value={draft.clubId}
          disabled={saving}
          onChange={(event) => updateAccessDraft(profile.id, { clubId: event.target.value })}
        >
          {availableClubs.map((club) => (
            <option key={club.id} value={club.id}>{club.name}</option>
          ))}
        </Select>
        <Select
          aria-label={t('memberRole')}
          value={draft.role}
          disabled={saving}
          onChange={(event) => updateAccessDraft(profile.id, { role: event.target.value as UserRole })}
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>{t(`roles.${role}`)}</option>
          ))}
        </Select>
        <Button
          variant={buttonVariant}
          className="px-5"
          loading={saving}
          disabled={!draft.clubId}
          onClick={() => addClubAccess(profile)}
          icon={<UserPlus size={16} aria-hidden="true" />}
        >
          {buttonLabel}
        </Button>
      </div>
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

  function renderFeatureAccessPanel(profile: TeamMember, membership: TeamMembership) {
    const membershipId = `${profile.id}:${membership.clubId}`;
    const featureAccess = featureAccessForMembership(membership.role, membership.featureAccess);
    const savingFeatures = savingId === `${membershipId}:features`;
    const canManage = ownedClubIds.has(membership.clubId);

    return (
      <div className="border-t border-gray-200/70 pt-5">
        <SectionHeading
          as="h3"
          size="sm"
          title={t('pageAccess')}
          description={membership.role === 'owner' ? t('ownerFeatureAccessHelp') : t('featureAccessHelp')}
          action={<Badge variant="outline" icon={<Building2 size={13} aria-hidden="true" />}>{membership.clubName}</Badge>}
        />

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {FEATURE_DEFINITIONS.map((feature) => {
            const ownerOnly = 'ownerOnly' in feature && feature.ownerOnly;
            const disabled = savingFeatures || isSavingProfile(profile.id) || membership.role === 'owner' || ownerOnly || !canManage;
            const checked = membership.role === 'owner'
              ? true
              : !ownerOnly && featureAccess.includes(feature.key);

            return (
              <Checkbox
                key={feature.key}
                variant="card"
                className="min-h-[76px]"
                checked={checked}
                disabled={disabled}
                onChange={(event) => updateMembershipFeatureAccess(profile, membership, feature.key, event.target.checked)}
                label={t(`features.${feature.labelKey}`)}
                description={(
                  <>
                    {t(`features.${feature.descriptionKey}`)}
                    {ownerOnly && membership.role !== 'owner' && (
                      <span className="mt-1 flex items-center gap-1 font-medium text-gray-600">
                        <Lock size={12} aria-hidden="true" />
                        {t('ownerOnlyFeature')}
                      </span>
                    )}
                  </>
                )}
              />
            );
          })}
        </div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <Card>
        <EmptyState icon={Lock} title={tc('accessDeniedTitle')} description={tc('accessDeniedDescription')} />
      </Card>
    );
  }

  if (!authorized) {
    if (error) {
      return (
        <InlineAlert variant="danger">{error}</InlineAlert>
      );
    }
    return <TableSkeleton rows={6} columns={4} />;
  }

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        action={(
          <Button onClick={() => setInviteOpen(true)} icon={<UserPlus size={16} aria-hidden="true" />}>
            {t('invite')}
          </Button>
        )}
      />

      {error && (
        <InlineAlert
          variant="danger"
          className="mb-4"
          action={<Button variant="outline" size="sm" disabled={loading} onClick={() => void loadProfiles()}>{tc('retry')}</Button>}
        >
          {error}
        </InlineAlert>
      )}

      {loading ? (
        <TableSkeleton rows={7} columns={4} />
      ) : (
        <div className="space-y-6">
          {pendingProfiles.length > 0 && (
            <section aria-label={t('pendingApproval')} className="space-y-3">
              {pendingProfiles.map((profile) => (
                <Card
                  key={profile.id}
                  tone="warning"
                  padding="sm"
                  className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={profile.full_name} tone="neutral" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-950">{profile.full_name}</p>
                      <p className="truncate text-xs text-gray-500">
                        {profile.email && <span>{profile.email} · </span>}
                        {t('requestedAt', { date: formatDateTime(profile.created_at, locale) })}
                      </p>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center lg:shrink-0">
                    <div className="min-w-0 lg:w-[460px]">
                      {renderAccessControls(profile, t('approve'), 'success')}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 text-gray-500 hover:text-danger-600"
                      icon={<X size={15} aria-hidden="true" />}
                      loading={savingId === `${profile.id}:reject`}
                      disabled={Boolean(savingId) && savingId !== `${profile.id}:reject`}
                      onClick={() => void rejectPendingProfile(profile)}
                    >
                      {t('reject')}
                    </Button>
                  </div>
                </Card>
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
                    const membership = selectedMembershipForProfile(profile);
                    if (!membership) return null;
                    const expanded = expandedMemberId === profile.id;
                    const addAccessExpanded = expandedAddAccessId === profile.id;
                    const hasAvailableClubs = availableClubsForProfile(profile).length > 0;
                    const saving = isSavingProfile(profile.id);
                    const protectedOwner = membership.role === 'owner'
                      && (profile.id === currentUserId || ownerCountForClub(membership.clubId) <= 1);
                    const canManage = ownedClubIds.has(membership.clubId);

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
                            {featureAccessAvailable && (
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
                          <div id={`member-access-${profile.id}`} className="border-t border-gray-100 bg-gray-50/60 px-5 py-5">
                            <SectionHeading
                              as="h3"
                              size="sm"
                              className="mb-5"
                              title={t('accessSettings')}
                              description={canManage ? t('autoSave') : t('notClubOwner')}
                              action={<IconButton variant="ghost" size="sm" label={t('hideAccess')} icon={<X size={17} />} onClick={() => setExpandedMemberId(null)} />}
                            />
                            <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
                              <Field label={t('gameClubs')} htmlFor={`member-club-${profile.id}`}>
                                <Select
                                  id={`member-club-${profile.id}`}
                                  className="font-medium"
                                  value={membership.clubId}
                                  disabled={saving}
                                  onChange={(event) => {
                                    setMembershipSelection((current) => ({ ...current, [profile.id]: event.target.value }));
                                    setExpandedAddAccessId(null);
                                  }}
                                >
                                  {profile.memberships.map((item) => <option key={item.clubId} value={item.clubId}>{item.clubName}</option>)}
                                </Select>
                              </Field>
                              <Field
                                label={t('memberRole')}
                                htmlFor={`member-role-${profile.id}`}
                                hint={!canManage ? t('notClubOwner') : protectedOwner ? (profile.id === currentUserId ? t('selfDemoteBlocked') : t('lastOwnerBlocked')) : undefined}
                              >
                                <Select
                                  id={`member-role-${profile.id}`}
                                  className="font-medium"
                                  value={membership.role}
                                  disabled={saving || protectedOwner || !canManage}
                                  onChange={(event) => updateMembershipRole(profile, membership, event.target.value as UserRole)}
                                >
                                  {ROLES.map((role) => <option key={role} value={role}>{t(`roles.${role}`)}</option>)}
                                </Select>
                              </Field>
                              {hasAvailableClubs && (
                                <Button
                                  variant="outline"
                                  disabled={saving}
                                  onClick={() => setExpandedAddAccessId(addAccessExpanded ? null : profile.id)}
                                  aria-expanded={addAccessExpanded}
                                  aria-controls={`add-access-${profile.id}`}
                                  icon={<UserPlus size={16} aria-hidden="true" />}
                                >
                                  {t('addAccess')}
                                </Button>
                              )}
                            </div>
                            {addAccessExpanded && (
                              <div id={`add-access-${profile.id}`} className="mb-5 rounded-xl border border-gray-200 bg-surface p-4">
                                <p className="mb-3 text-sm font-medium text-gray-800">{t('addAccessHelp')}</p>
                                {renderAccessControls(profile, t('addAccess'))}
                              </div>
                            )}
                            {featureAccessAvailable && renderFeatureAccessPanel(profile, membership)}
                            <div className="mt-5 flex flex-col gap-3 border-t border-gray-200/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-xs leading-5 text-gray-500">
                                {!canManage ? t('notClubOwner') : profile.id === currentUserId ? t('selfRemoveBlocked') : protectedOwner ? t('lastOwnerBlocked') : t('removeAccessHelp', { club: membership.clubName })}
                              </p>
                              <Button
                                variant="dangerOutline"
                                size="sm"
                                className="shrink-0"
                                disabled={saving || profile.id === currentUserId || protectedOwner || !canManage}
                                onClick={() => removeClubAccess(profile, membership)}
                                aria-label={t('removeClubAccess', { club: membership.clubName })}
                                icon={<Trash2 size={15} aria-hidden="true" />}
                              >
                                {t('removeAccess')}
                              </Button>
                            </div>
                          </div>
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
