'use client';

// Dashboard layout shell and shared club/date context.

import { useCallback, useEffect, useMemo, useRef, useState, createContext, useContext } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Clock3, Gamepad2, LogOut, Menu, ShieldCheck } from 'lucide-react';
import { useSignOut } from './useSignOut';
import { Sidebar } from './Sidebar';
import { Button, Card, EmptyState, IconButton, InlineAlert, PageSkeleton } from '@/components/PresentationFoundation';
import { createClient } from '@/lib/supabase/client';
import { isMissingDatabaseColumn } from '@/lib/supabase/errors';
import { normalizePaymentMethods } from '@/lib/paymentMethods';
import { PAYMENT_METHODS, type Club, type ClubMembership, type EntryPaymentMethod, type UserRole } from '@/types';
import {
  canAccessPath,
  defaultPathForAccess,
  featureAccessForMembership,
  type FeatureKey,
} from '@/lib/permissions';
import { normalizeBusinessDayStartHour } from '@/lib/utils';
import { useLatestRef } from '@/components/i18n/useLatestRef';

interface DashboardShellProps {
  initialEmail?: string;
  initialFullName?: string;
  initialProfileRole?: UserRole;
  initialMembershipRows?: ClubMembership[];
  initialSelectedClubId?: string;
  children: React.ReactNode;
}

interface ClubOption {
  club: Club;
  role: UserRole;
  featureAccess: FeatureKey[] | null;
}

interface ClubContextValue {
  selectedClubId: string;
  selectedClub: Club | null;
  memberships: ClubOption[];
  role: UserRole;
  featureAccess: FeatureKey[];
  businessDayStartHour: number;
  enabledPaymentMethods: EntryPaymentMethod[];
  loading: boolean;
  setSelectedClubId: (clubId: string) => void;
  /**
   * Re-reads memberships and clubs. Refreshes in place (the current page stays
   * mounted, keeping its toasts and form state); only the very first load
   * shows the shell skeleton. Throws when the membership read fails, leaving
   * the previous memberships untouched.
   */
  refreshClubs: () => Promise<void>;
}

const ClubContext = createContext<ClubContextValue>({
  selectedClubId: '',
  selectedClub: null,
  memberships: [],
  role: 'viewer',
  featureAccess: [],
  businessDayStartHour: 0,
  enabledPaymentMethods: [...PAYMENT_METHODS],
  loading: true,
  setSelectedClubId: () => {},
  refreshClubs: async () => {},
});

export function useClub() {
  return useContext(ClubContext);
}

function isUserRole(role: string | null | undefined): role is UserRole {
  return role === 'owner' || role === 'admin' || role === 'viewer';
}

function relatedClub(relation: ClubMembership['clubs']): Club | null {
  if (!relation) return null;
  return Array.isArray(relation) ? relation[0] ?? null : relation;
}

const SELECTED_CLUB_STORAGE_KEY = 'game-club-finance:selected-club-id';
const SELECTED_CLUB_COOKIE = 'game-club-finance-selected-club-id';

function persistSelectedClubId(clubId: string) {
  if (clubId) {
    window.localStorage.setItem(SELECTED_CLUB_STORAGE_KEY, clubId);
    document.cookie = `${SELECTED_CLUB_COOKIE}=${encodeURIComponent(clubId)}; path=/; max-age=31536000; samesite=lax`;
  } else {
    window.localStorage.removeItem(SELECTED_CLUB_STORAGE_KEY);
    document.cookie = `${SELECTED_CLUB_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }
}

function PendingApproval({ fullName }: { fullName: string }) {
  const t = useTranslations('approval');
  const { signOut, signingOut } = useSignOut();

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] w-full max-w-xl items-center justify-center">
      <Card padding="lg" className="w-full text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-warning-50 text-warning-600">
          <Clock3 size={28} aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-gray-950">{t('title')}</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          {t('description', { name: fullName || t('fallbackName') })}
        </p>
        <div className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-primary-50 px-4 py-3 text-sm font-medium text-primary-800">
          <ShieldCheck size={17} aria-hidden="true" />
          {t('ownerOnly')}
        </div>
        <Button variant="outline" className="mt-6" onClick={signOut} loading={signingOut} icon={<LogOut size={16} />}>
          {t('signOut')}
        </Button>
      </Card>
    </div>
  );
}

function membershipOptions(rows: ClubMembership[]): ClubOption[] {
  return rows
    .map((membership) => ({
      club: relatedClub(membership.clubs),
      role: isUserRole(membership.role) ? membership.role : 'viewer',
      featureAccess: Array.isArray(membership.feature_access)
        ? membership.feature_access as FeatureKey[]
        : null,
    }))
    .filter((membership): membership is ClubOption => Boolean(membership.club?.is_active))
    .sort((a, b) => a.club.name.localeCompare(b.club.name));
}

export function DashboardShell({
  initialEmail = '',
  initialFullName = '',
  initialProfileRole = 'viewer',
  initialMembershipRows = [],
  initialSelectedClubId = '',
  children,
}: DashboardShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const tc = useTranslations('common');
  const tn = useTranslations('nav');
  const tnRef = useLatestRef(tn);
  const initialMemberships = useMemo(() => membershipOptions(initialMembershipRows), [initialMembershipRows]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileRole, setProfileRole] = useState<UserRole>(initialProfileRole);
  const [fullName, setFullName] = useState(initialFullName || initialEmail);
  const [memberships, setMemberships] = useState<ClubOption[]>(initialMemberships);
  const [selectedClubId, setSelectedClubIdState] = useState(() =>
    initialMemberships.some((membership) => membership.club.id === initialSelectedClubId)
      ? initialSelectedClubId
      : initialMemberships[0]?.club.id ?? '',
  );
  const [clubLoading, setClubLoading] = useState(false);
  const [shellError, setShellError] = useState('');
  const [navigatingTo, setNavigatingTo] = useState('');
  const mainRef = useRef<HTMLElement>(null);
  const membershipsLoadedRef = useRef(initialMemberships.length > 0);

  const selectedMembership = useMemo(
    () => memberships.find((membership) => membership.club.id === selectedClubId) ?? null,
    [memberships, selectedClubId],
  );
  const role = selectedMembership?.role ?? profileRole;
  const featureAccess = useMemo(
    () => featureAccessForMembership(role, selectedMembership?.featureAccess),
    [role, selectedMembership?.featureAccess],
  );
  const selectedClub = selectedMembership?.club ?? null;
  const businessDayStartHour = normalizeBusinessDayStartHour(selectedClub?.business_day_start_hour);
  const enabledPaymentMethods = useMemo(
    () => normalizePaymentMethods(selectedClub?.enabled_payment_methods),
    [selectedClub?.enabled_payment_methods],
  );

  const setSelectedClubId = useCallback((clubId: string) => {
    setSelectedClubIdState(clubId);
    persistSelectedClubId(clubId);
  }, []);

  const loadClubs = useCallback(async (supabase: ReturnType<typeof createClient>, firstLoad: boolean) => {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      router.replace('/login');
      return;
    }

    const [profileRes, membershipRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', session.user.id)
        .maybeSingle(),
      supabase
        .from('club_memberships')
        .select('club_id, role, feature_access, created_at, updated_at, clubs(id, name, address, business_day_start_hour, enabled_payment_methods, is_active, created_at, updated_at)')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: true }),
    ]);

    if (
      membershipRes.error &&
      !isMissingDatabaseColumn(membershipRes.error, 'enabled_payment_methods') &&
      !isMissingDatabaseColumn(membershipRes.error, 'feature_access')
    ) {
      // A network or permission failure must not look like "no memberships"
      // (which would show the pending-approval screen to an existing member).
      throw membershipRes.error;
    }

    if (!profileRes.error) {
      setFullName(profileRes.data?.full_name ?? session.user.email ?? initialEmail);
      setProfileRole(isUserRole(profileRes.data?.role) ? profileRes.data.role : 'viewer');
    }

    let membershipRows = (membershipRes.data as ClubMembership[] | null) ?? [];
    if (isMissingDatabaseColumn(membershipRes.error, 'enabled_payment_methods')) {
      const withoutPaymentMethodsRes = await supabase
        .from('club_memberships')
        .select('club_id, role, feature_access, created_at, updated_at, clubs(id, name, address, business_day_start_hour, is_active, created_at, updated_at)')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: true });
      membershipRows = (withoutPaymentMethodsRes.data as ClubMembership[] | null) ?? [];

      if (isMissingDatabaseColumn(withoutPaymentMethodsRes.error, 'feature_access')) {
        const legacyMembershipRes = await supabase
          .from('club_memberships')
          .select('club_id, role, created_at, updated_at, clubs(id, name, address, business_day_start_hour, is_active, created_at, updated_at)')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: true });
        membershipRows = (legacyMembershipRes.data as ClubMembership[] | null) ?? [];
      }
    } else if (isMissingDatabaseColumn(membershipRes.error, 'feature_access')) {
      const withoutFeatureAccessRes = await supabase
        .from('club_memberships')
        .select('club_id, role, created_at, updated_at, clubs(id, name, address, business_day_start_hour, enabled_payment_methods, is_active, created_at, updated_at)')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: true });
      membershipRows = (withoutFeatureAccessRes.data as ClubMembership[] | null) ?? [];

      if (isMissingDatabaseColumn(withoutFeatureAccessRes.error, 'enabled_payment_methods')) {
        const legacyMembershipRes = await supabase
          .from('club_memberships')
          .select('club_id, role, created_at, updated_at, clubs(id, name, address, business_day_start_hour, is_active, created_at, updated_at)')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: true });
        membershipRows = (legacyMembershipRes.data as ClubMembership[] | null) ?? [];
      }
    }

    const nextMemberships = membershipOptions(membershipRows);

    membershipsLoadedRef.current = nextMemberships.length > 0 || !firstLoad;
    setShellError('');
    setMemberships(nextMemberships);
    setSelectedClubIdState((currentClubId) => {
      const storedClubId = window.localStorage.getItem(SELECTED_CLUB_STORAGE_KEY) ?? '';
      const preferredClubId = currentClubId || storedClubId;
      const nextClubId =
        nextMemberships.find((membership) => membership.club.id === preferredClubId)?.club.id ??
        nextMemberships[0]?.club.id ??
        '';

      persistSelectedClubId(nextClubId);

      return nextClubId;
    });
  }, [initialEmail, router]);

  const refreshClubs = useCallback(async () => {
    const supabase = createClient();
    // Only the first load swaps the page for a skeleton. Later refreshes (after
    // renaming a club, changing access, …) keep the page mounted.
    const showSkeleton = !membershipsLoadedRef.current;
    if (showSkeleton) setClubLoading(true);
    try {
      await loadClubs(supabase, showSkeleton);
    } finally {
      if (showSkeleton) setClubLoading(false);
    }
  }, [loadClubs]);

  useEffect(() => {
    // Keep the cookie in sync with the server-chosen initial club.
    if (selectedClubId) persistSelectedClubId(selectedClubId);
    // Only on mount; later changes go through setSelectedClubId.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // The server bootstrap already returned memberships; nothing to re-read.
    if (initialMembershipRows.length > 0) return;

    let cancelled = false;
    refreshClubs().catch(() => {
      if (!cancelled) setShellError(tnRef.current('shellLoadError'));
    });

    return () => {
      cancelled = true;
    };
  }, [initialMembershipRows.length, refreshClubs, tnRef]);

  useEffect(() => {
    // Route changed: clear the pending indicator, close the drawer (also on
    // Back/Forward and redirects), and move focus to the new page content.
    setNavigatingTo('');
    setSidebarOpen(false);
    if (window.matchMedia('(max-width: 1023px)').matches) {
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [pathname]);

  useEffect(() => {
    if (!navigatingTo) return;
    // Aborted or redirected navigations never change `pathname`; don't let the
    // progress bar and highlighted item stick forever.
    const timer = window.setTimeout(() => setNavigatingTo(''), 10000);
    return () => window.clearTimeout(timer);
  }, [navigatingTo]);

  function handleSelectClub(clubId: string) {
    setSelectedClubId(clubId);
    setSidebarOpen(false);
  }

  function handleNavigate(href: string) {
    if (href !== pathname) setNavigatingTo(href);
    setSidebarOpen(false);
  }

  const navigationPending = Boolean(navigatingTo && navigatingTo !== pathname);
  const pathAllowed = canAccessPath(role, selectedMembership?.featureAccess, pathname);
  const fallbackPath = pathAllowed ? null : defaultPathForAccess(role, selectedMembership?.featureAccess);

  useEffect(() => {
    if (memberships.length === 0 || pathAllowed || !fallbackPath || fallbackPath === pathname) return;
    setNavigatingTo(fallbackPath);
    router.replace(fallbackPath);
  }, [fallbackPath, memberships.length, pathAllowed, pathname, router]);

  const clubContextValue = useMemo(
    () => ({
      selectedClubId,
      selectedClub,
      memberships,
      role,
      featureAccess,
      businessDayStartHour,
      enabledPaymentMethods,
      loading: clubLoading,
      setSelectedClubId,
      refreshClubs,
    }),
    [businessDayStartHour, clubLoading, enabledPaymentMethods, featureAccess, memberships, refreshClubs, role, selectedClub, selectedClubId, setSelectedClubId],
  );

  return (
      <ClubContext.Provider value={clubContextValue}>
      <div className="relative min-h-dvh overflow-x-clip bg-gray-50">
        <a
          href="#main-content"
          className="sr-only z-[100] rounded-lg bg-surface px-4 py-2 text-sm font-semibold text-primary-700 shadow-lg focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          {tn('skipToContent')}
        </a>
        {navigationPending && (
          <div
            className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-primary-100"
            role="status"
            aria-label={tc('loading')}
          >
            <div className="h-full w-full origin-left animate-pulse bg-primary-600" />
          </div>
        )}
        <Sidebar
          role={role}
          fullName={fullName}
          memberships={memberships}
          selectedClubId={selectedClubId}
          activePathname={navigatingTo || pathname}
          featureAccess={featureAccess}
          onSelectClub={handleSelectClub}
          mobileOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onNavigate={handleNavigate}
        />

        <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
          <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 border-b border-gray-200 bg-surface/90 px-3 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
            <IconButton
              variant="ghost"
              label={tn('openNavigation')}
              icon={<Menu size={20} />}
              onClick={() => setSidebarOpen(true)}
              aria-expanded={sidebarOpen}
              aria-controls="mobile-nav"
              aria-haspopup="dialog"
            />
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-950 text-gray-50">
                <Gamepad2 size={16} aria-hidden="true" />
              </div>
              <p className="truncate text-sm font-semibold text-gray-950">{selectedClub?.name ?? tn('appName')}</p>
            </div>
          </div>

          <main id="main-content" ref={mainRef} tabIndex={-1} className="min-w-0 flex-1 overflow-x-clip outline-none">
            <div className="w-full px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[4.5rem] sm:px-6 lg:px-8 lg:py-8">
              {shellError ? (
                <InlineAlert
                  variant="danger"
                  className="mx-auto max-w-xl"
                  action={<Button size="sm" variant="outline" onClick={() => window.location.reload()}>{tc('retry')}</Button>}
                >
                  {shellError}
                </InlineAlert>
              ) : clubLoading || (!pathAllowed && Boolean(fallbackPath)) ? (
                <PageSkeleton />
              ) : memberships.length === 0 ? (
                <PendingApproval fullName={fullName} />
              ) : !pathAllowed ? (
                <Card className="mx-auto max-w-xl">
                  <EmptyState icon={ShieldCheck} title={tc('accessDeniedTitle')} description={tc('accessDeniedDescription')} compact />
                </Card>
              ) : (
                children
              )}
            </div>
          </main>
        </div>
      </div>
      </ClubContext.Provider>
  );
}
