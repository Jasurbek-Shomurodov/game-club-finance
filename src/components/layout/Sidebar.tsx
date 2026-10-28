'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { useSignOut } from './useSignOut';
import { usePendingTeamCount } from './usePendingTeamCount';
import {
  LayoutDashboard,
  Wallet,
  Gift,
  Package,
  ShoppingCart,
  Users,
  LogOut,
  X,
  ChevronRight,
  ChevronsUpDown,
  Archive,
  Shield,
  CircleDollarSign,
  BarChart3,
  HandCoins,
  ChartPie,
  Gamepad2,
  History,
  PanelLeft,
  Sparkles,
} from 'lucide-react';
import type { Club, UserRole } from '@/types';
import { canAccessFeature, featureForPath, type FeatureKey } from '@/lib/permissions';
import { Avatar, ClubLogo, Drawer, IconButton, LanguageSwitcher } from '@/components/PresentationFoundation';
import { DASHBOARD_PATH } from '@/lib/routes';

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
}

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
  feature: FeatureKey;
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
        <span className="rounded-full bg-warning-50 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-warning-700">
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
}: SidebarProps) {
  const t = useTranslations('nav');
  const tTeam = useTranslations('team');
  const currentPathname = usePathname();
  const pathname = activePathname ?? currentPathname;
  const { signOut, signingOut } = useSignOut();
  const selectedClub = memberships.find((membership) => membership.club.id === selectedClubId)?.club ?? null;
  // Highlight the section, not just the exact path: /salaries/employees/…,
  // /daily-report and the money-details pages all belong to a nav item.
  const activeFeature = featureForPath(pathname);
  // Re-counted on club change and when the team page approves or rejects someone.
  const pendingCount = usePendingTeamCount(role === 'owner', selectedClubId);

  function allowed(feature: FeatureKey) {
    if (feature === 'reports') return canAccessFeature(role, featureAccess, 'reports') || canAccessFeature(role, featureAccess, 'expenses');
    return feature === 'salaries' || canAccessFeature(role, featureAccess, feature);
  }

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
        { href: '/closing-stock', icon: Archive, label: t('closingStock'), feature: 'closing_stock' },
        { href: '/promotions', icon: Gift, label: t('promotions'), feature: 'closing_stock' },
        { href: '/stock-purchase', icon: ShoppingCart, label: t('stockPurchase'), feature: 'stock_purchase' },
      ],
    },
    {
      label: t('groupMoney'),
      items: [
        { href: '/reports', icon: BarChart3, label: t('reports'), feature: 'reports' },
        { href: '/money-taken', icon: CircleDollarSign, label: t('moneyTaken'), feature: 'owner_profit' },
        { href: '/debts', icon: Users, label: t('debts'), feature: 'debts' },
        { href: '/salaries', icon: HandCoins, label: t('salaries'), feature: 'salaries' },
      ],
    },
    {
      label: t('groupManage'),
      items: [
        { href: '/products', icon: Package, label: t('products'), feature: 'inventory' },
        { href: '/showcase', icon: Gamepad2, label: t('showcase'), feature: 'showcase' },
        { href: '/team', icon: Shield, label: t('team'), feature: 'team', badge: pendingCount },
        { href: '/history', icon: History, label: t('history'), feature: 'team' },
      ],
    },
  ];
  const groups = allGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => allowed(item.feature)) }))
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
  const navHrefs = groups.flatMap((group) => group.items.map((item) => item.href));
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

  function isActive(item: NavItem) {
    if (item.href === '/reports') return activeFeature === 'reports' || activeFeature === 'expenses';
    // Both dashboard-feature routes share a feature; tell them apart by path.
    const onAnalysis = pathname === '/financial-analysis' || pathname.startsWith('/financial-analysis/');
    if (item.href === '/financial-analysis') return onAnalysis;
    if (item.href === DASHBOARD_PATH) return activeFeature === 'dashboard' && !onAnalysis;
    // Promotions share the closing-stock feature; tell them apart by path.
    const onPromotions = pathname === '/promotions' || pathname.startsWith('/promotions/');
    if (item.href === '/promotions') return onPromotions;
    if (item.href === '/closing-stock') return activeFeature === 'closing_stock' && !onPromotions;
    // Entry history shares the owner-only team feature.
    const onHistory = pathname === '/history' || pathname.startsWith('/history/');
    if (item.href === '/history') return onHistory;
    if (item.href === '/team') return activeFeature === 'team' && !onHistory;
    return activeFeature === item.feature;
  }

  const profile = (
    <>
      <Avatar name={fullName} size="sm" />
      <span className="min-w-0 flex-1 text-left leading-tight">
        <span className="block truncate text-[13px] font-semibold text-gray-950">{fullName}</span>
        <span className="block truncate text-[11px] text-gray-500">{tTeam(`roles.${role}`)}</span>
      </span>
    </>
  );

  const content = (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        {memberships.length > 0 ? (
          <label className="relative flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-xl border border-gray-200 bg-surface px-2.5 transition hover:border-gray-300 focus-within:ring-2 focus-within:ring-primary-500">
            <ClubLogo src={selectedClub?.logo_url} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold text-gray-950">{selectedClub?.name ?? t('appName')}</span>
              <span className="block truncate text-[11px] text-gray-500">{tTeam(`roles.${role}`)}</span>
            </span>
            <select
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none text-base opacity-0"
              value={selectedClubId}
              onChange={(event) => onSelectClub?.(event.target.value)}
              aria-label={t('club')}
            >
              {memberships.map((membership) => (
                <option key={membership.club.id} value={membership.club.id}>
                  {membership.club.name}
                </option>
              ))}
            </select>
            <ChevronsUpDown size={15} className="pointer-events-none shrink-0 text-gray-400" aria-hidden="true" />
          </label>
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
              <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{group.label}</p>
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
          'fixed inset-y-0 left-0 z-40 hidden overflow-hidden border-gray-200 transition-[width] duration-200 ease-linear lg:flex',
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
