'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { useSignOut } from './useSignOut';
import {
  LayoutDashboard,
  Wallet,
  Package,
  Users,
  LogOut,
  X,
  ChevronRight,
  Shield,
  CircleDollarSign,
  BarChart3,
  HandCoins,
  ChartPie,
  Gamepad2,
  PanelLeft,
  PiggyBank,
  Sparkles,
} from 'lucide-react';
import type { Club, UserRole } from '@/types';
import { canAccessFeature, featureForPath, type FeatureKey } from '@/lib/permissions';
import { Avatar, ClubLogo, Drawer, IconButton, LanguageSwitcher, NativeSelectOverlay } from '@/components/PresentationFoundation';
import { DASHBOARD_PATH } from '@/lib/routes';
import {
  RESERVE_PATH,
  accessibleSectionPaths,
  isSidebarItemActive,
  sectionHome,
  type NavSection,
  type SidebarNavTarget,
} from '@/lib/navigation';

interface SidebarClubOption {
  club: Club;
  role: UserRole;
}

interface SidebarProps {
  role: UserRole;
  fullName: string;
  memberships?: SidebarClubOption[];
  selectedClubId?: string;
  onSelectClub?: (clubId: string) => void;
  mobileOpen?: boolean;
  /** Desktop only: the sidebar slides fully off-canvas when collapsed. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  activePathname?: string;
  featureAccess?: FeatureKey[];
  onClose?: () => void;
  onNavigate?: (href: string) => void;
  /** Open access requests, shown on the Team item; the shell counts them once for the sidebar and the bottom bar. */
  pendingCount?: number;
}

/** A section item opens the section's first tab and stays lit on all of them; a path item stands for one route. */
interface NavItem extends SidebarNavTarget {
  icon: React.ElementType;
  label: string;
  badge?: number;
}

function NavLink({
  href,
  icon: Icon,
  label,
  active,
  badge,
  onNavigate,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  badge?: number;
  onNavigate?: (href: string) => void;
}) {
  const [prefetchOnIntent, setPrefetchOnIntent] = useState(false);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    onNavigate?.(href);
  }

  return (
    <Link
      href={href}
      // Other routes are fully prefetched by the Sidebar effect below. The
      // dashboard embeds live totals in its server response, so it is only
      // prefetched on intent to avoid retaining totals from before an edit.
      prefetch={href === DASHBOARD_PATH ? prefetchOnIntent : true}
      onClick={handleClick}
      onMouseEnter={() => setPrefetchOnIntent(true)}
      onFocus={() => setPrefetchOnIntent(true)}
      onTouchStart={() => setPrefetchOnIntent(true)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-10 items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        active
          ? 'bg-primary-50 font-semibold text-primary-700'
          : 'font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-950',
      )}
    >
      <Icon size={17} strokeWidth={active ? 2.25 : 2} className={active ? 'text-primary-600' : 'text-gray-400'} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="rounded-full bg-warning-50 px-1.5 py-0.5 text-xs font-semibold leading-none text-warning-700">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

export function Sidebar({
  role,
  fullName,
  memberships = [],
  selectedClubId = '',
  onSelectClub,
  mobileOpen,
  collapsed = false,
  onToggleCollapsed,
  activePathname,
  featureAccess = [],
  onClose,
  onNavigate,
  pendingCount = 0,
}: SidebarProps) {
  const t = useTranslations('nav');
  const tTeam = useTranslations('team');
  const currentPathname = usePathname();
  const pathname = activePathname ?? currentPathname;
  const { signOut, signingOut } = useSignOut();
  const selectedClub = memberships.find((membership) => membership.club.id === selectedClubId)?.club ?? null;
  // The profile link lights on Settings; nav items light through isSidebarItemActive.
  const activeFeature = featureForPath(pathname);

  function allowed(feature: FeatureKey) {
    if (feature === 'reports') return canAccessFeature(role, featureAccess, 'reports') || canAccessFeature(role, featureAccess, 'expenses');
    return feature === 'salaries' || canAccessFeature(role, featureAccess, feature);
  }

  // A section's screens (bar, team) share one item; tabs beside
  // the page title switch between them. The item leads to the first screen
  // this member can open and is hidden when there is none.
  const sectionItem = (section: NavSection, icon: React.ElementType, label: string, feature: FeatureKey, badge?: number): NavItem[] => {
    const href = sectionHome(section, role, featureAccess);
    return href ? [{ href, icon, label, feature, badge, section }] : [];
  };

  // Grouped by when the owner reaches for them: every shift, money questions,
  // and occasional management.
  const allGroups: Array<{ label?: string; items: NavItem[] }> = [
    {
      items: [
        { href: DASHBOARD_PATH, icon: LayoutDashboard, label: t('dashboard'), feature: 'dashboard' },
        { href: '/financial-analysis', icon: ChartPie, label: t('financialAnalysis'), feature: 'dashboard' },
        { href: '/assistant', icon: Sparkles, label: t('assistant'), feature: 'assistant' },
      ],
    },
    {
      label: t('groupDaily'),
      items: [
        { href: '/daily-cash', icon: Wallet, label: t('dailyCash'), feature: 'daily_cash' },
        // Closing stock, purchases, products and promotions.
        ...sectionItem('bar', Package, t('bar'), 'closing_stock'),
      ],
    },
    {
      label: t('groupMoney'),
      items: [
        { href: '/reports', icon: BarChart3, label: t('reports'), feature: 'reports' },
        ...sectionItem('ownerMoney', CircleDollarSign, t('moneyTaken'), 'owner_profit'),
        // The owner reserve has its own item; it is owner-only through the team feature, as /reserve is.
        { href: RESERVE_PATH, icon: PiggyBank, label: t('reserve'), feature: 'team', path: RESERVE_PATH },
        { href: '/debts', icon: Users, label: t('debts'), feature: 'debts' },
        { href: '/salaries', icon: HandCoins, label: t('salaries'), feature: 'salaries' },
      ],
    },
    {
      label: t('groupManage'),
      items: [
        { href: '/showcase', icon: Gamepad2, label: t('showcase'), feature: 'showcase' },
        // Team and the edit history, both owner-only.
        ...sectionItem('team', Shield, t('team'), 'team', pendingCount),
      ],
    },
  ];
  const groups = allGroups
    // A section item already passed its own access check: its tabs do not share one feature.
    .map((group) => ({ ...group, items: group.items.filter((item) => Boolean(item.section) || allowed(item.feature)) }))
    .filter((group) => group.items.length > 0);

  // The phone drawer is unmounted while closed, so Link's viewport prefetch
  // never runs for it, and a default prefetch only covers the loading skeleton:
  // every tap still waited on a round trip to the Sydney functions before the
  // page switched and its data could start loading. These pages are client
  // components that load their own data, so their full server response holds
  // nothing stale; prefetch it up front and a tap swaps pages with no request.
  // The dashboard embeds live totals, so it keeps the skeleton-only
  // prefetch, and only once the drawer opens.
  const router = useRouter();
  // Every tab of a section too (the bar, the reports, salaries, the public page…), so switching tabs is as instant as the sidebar.
  const navHrefs = Array.from(new Set([
    ...groups.flatMap((group) => group.items.map((item) => item.href)),
    ...accessibleSectionPaths(role, featureAccess),
  ]));
  if (allowed('settings')) navHrefs.push('/settings');
  const navHrefKey = navHrefs.join('|');
  useEffect(() => {
    for (const href of navHrefKey.split('|')) {
      if (href === DASHBOARD_PATH) {
        if (mobileOpen) router.prefetch(href);
      } else if (href) {
        router.prefetch(href, { kind: PrefetchKind.FULL });
      }
    }
  }, [mobileOpen, navHrefKey, router]);

  // Highlight the section, not just the exact path: /salaries/employees/…,
  // /daily-report and the money-details pages all belong to a nav item.
  const isActive = (item: NavItem) => isSidebarItemActive(item, pathname);

  const profile = (
    <>
      <Avatar name={fullName} size="sm" />
      <span className="min-w-0 flex-1 text-left leading-tight">
        <span className="block truncate text-[13px] font-semibold text-gray-950">{fullName}</span>
        <span className="block truncate text-xs text-gray-500">{tTeam(`roles.${role}`)}</span>
      </span>
    </>
  );

  const content = (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        {memberships.length > 0 ? (
          <NativeSelectOverlay
            className="flex-1"
            value={selectedClubId}
            onChange={(event) => onSelectClub?.(event.target.value)}
            aria-label={t('club')}
            display={(
              <>
                <ClubLogo src={selectedClub?.logo_url} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm font-semibold text-gray-950">{selectedClub?.name ?? t('appName')}</span>
                  <span className="block truncate text-xs text-gray-500">{tTeam(`roles.${role}`)}</span>
                </span>
              </>
            )}
          >
            {memberships.map((membership) => (
              <option key={membership.club.id} value={membership.club.id}>
                {membership.club.name}
              </option>
            ))}
          </NativeSelectOverlay>
        ) : (
          <div className="flex min-h-12 min-w-0 flex-1 items-center gap-2.5 px-2.5">
            <ClubLogo />
            <span className="truncate text-sm font-semibold text-gray-950">{t('appName')}</span>
          </div>
        )}
        {onClose && (
          <IconButton
            variant="ghost"
            label={t('closeNavigation')}
            icon={<X size={20} />}
            onClick={onClose}
            className="lg:hidden"
          />
        )}
        {onToggleCollapsed && (
          <IconButton
            variant="ghost"
            label={t('toggleSidebar')}
            title={t('toggleSidebar')}
            icon={<PanelLeft size={18} />}
            onClick={onToggleCollapsed}
            className="hidden lg:inline-flex"
          />
        )}
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-2" aria-label={t('mainNavigation')}>
        {groups.map((group, index) => (
          <div key={group.label ?? index} className="space-y-0.5">
            {group.label && (
              <p className="px-2.5 pb-1 pt-1 text-xs font-semibold text-gray-500">{group.label}</p>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                icon={item.icon}
                label={item.label}
                badge={item.badge}
                active={isActive(item)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t border-gray-100 px-3 py-3">
        <LanguageSwitcher className="flex w-full [&>button]:flex-1" />
        <div className="flex items-center gap-1">
          {/* Tapping the profile opens Settings, which no longer has its own nav item. */}
          {allowed('settings') ? (
            <Link
              href="/settings"
              onClick={(event) => {
                if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey) {
                  onNavigate?.('/settings');
                }
              }}
              aria-current={activeFeature === 'settings' ? 'page' : undefined}
              aria-label={`${fullName}, ${t('settings')}`}
              title={t('settings')}
              className={cn(
                'flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                activeFeature === 'settings' ? 'bg-primary-50' : 'hover:bg-gray-100',
              )}
            >
              {profile}
              <ChevronRight size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
            </Link>
          ) : (
            <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-1.5 py-1.5">{profile}</div>
          )}
          <IconButton
            variant="ghost"
            size="sm"
            label={t('signOut')}
            icon={<LogOut size={16} />}
            onClick={signOut}
            loading={signingOut}
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden overflow-hidden border-gray-200 transition-[width] duration-200 ease-linear motion-reduce:transition-none lg:flex',
          collapsed ? 'w-0 border-r-0' : 'w-64 border-r',
        )}
        inert={collapsed}
        aria-hidden={collapsed || undefined}
      >
        <div className="w-64 shrink-0">{content}</div>
      </aside>

      <Drawer
        open={Boolean(mobileOpen)}
        onClose={() => onClose?.()}
        side="left"
        id="mobile-nav"
        ariaLabel={t('mainNavigation')}
        className="lg:hidden"
        panelClassName="w-[min(18rem,86vw)] max-w-none"
      >
        {content}
      </Drawer>
    </>
  );
}
