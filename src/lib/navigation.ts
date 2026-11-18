import type { UserRole } from '@/types';
import { canAccessFeature, canAccessPath, featureForPath, type FeatureKey } from '@/lib/permissions';
import { DASHBOARD_PATH } from '@/lib/routes';

/** Screens that belong together and share one sidebar item; each stays its own route. */
export type NavSection = 'bar' | 'ownerMoney' | 'team';

export interface SectionTab {
  href: string;
  /** Key in the `nav` messages. */
  labelKey: 'closingStock' | 'writeOffs' | 'stockPurchase' | 'products' | 'promotions' | 'moneyTaken' | 'reserve' | 'team' | 'history';
}

/** Tabs of each section, in the order they are shown. The first one a member can open is the section's home. */
const SECTION_TABS: Record<NavSection, readonly SectionTab[]> = {
  bar: [
    { href: '/closing-stock', labelKey: 'closingStock' },
    { href: '/write-offs', labelKey: 'writeOffs' },
    { href: '/stock-purchase', labelKey: 'stockPurchase' },
    { href: '/products', labelKey: 'products' },
    { href: '/promotions', labelKey: 'promotions' },
  ],
  ownerMoney: [
    { href: '/money-taken', labelKey: 'moneyTaken' },
    { href: '/reserve', labelKey: 'reserve' },
  ],
  team: [
    { href: '/team', labelKey: 'team' },
    { href: '/history', labelKey: 'history' },
  ],
};

const underPath = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The section's tabs this member can open. Feature access decides, exactly as it does for the pages. */
export function sectionTabs(section: NavSection, role: UserRole, explicitAccess: unknown): SectionTab[] {
  return SECTION_TABS[section].filter((tab) => canAccessPath(role, explicitAccess, tab.href));
}

/** Where the section's sidebar item leads: its first tab the member can open, or null when there is none. */
export function sectionHome(section: NavSection, role: UserRole, explicitAccess: unknown): string | null {
  return sectionTabs(section, role, explicitAccess)[0]?.href ?? null;
}

/** The section a path belongs to, so its sidebar item stays highlighted on every tab. */
export function sectionForPath(pathname: string): NavSection | null {
  const normalized = pathname !== '/' ? pathname.replace(/\/$/, '') : pathname;
  for (const section of Object.keys(SECTION_TABS) as NavSection[]) {
    if (SECTION_TABS[section].some((tab) => underPath(normalized, tab.href))) return section;
  }
  return null;
}

/** The tab of `tabs` a path is on, or null (a page outside the section). */
export function activeSectionTab(tabs: readonly SectionTab[], pathname: string): string | null {
  const normalized = pathname !== '/' ? pathname.replace(/\/$/, '') : pathname;
  return tabs.find((tab) => underPath(normalized, tab.href))?.href ?? null;
}

/** Every tab route of every section this member can open, for the sidebar's up-front prefetch. */
export function accessibleSectionPaths(role: UserRole, explicitAccess: unknown): string[] {
  return (Object.keys(SECTION_TABS) as NavSection[])
    .flatMap((section) => sectionTabs(section, role, explicitAccess).map((tab) => tab.href));
}

/** A destination of the phone bottom bar. `key` is its label in the `nav` messages. */
export interface PrimaryNavItem {
  key: 'dashboard' | 'dailyCash' | 'bar' | 'reports' | 'moneyTaken' | 'debts' | 'salaries';
  href: string;
  /** The item stands for a whole section and stays lit on all of its tabs. */
  section?: NavSection;
  /** The feature whose pages light the item, for one that is not a section. */
  feature?: FeatureKey;
}

/**
 * The screens a phone keeps one tap away, most used first: the bottom bar
 * shows the first `limit` this member can open and leaves the rest to the
 * menu. Someone without the dashboard or the bar gets the next ones instead of
 * an empty slot.
 */
export function primaryNavItems(role: UserRole, explicitAccess: unknown, limit = 4): PrimaryNavItem[] {
  const can = (feature: FeatureKey) => canAccessFeature(role, explicitAccess, feature);
  const section = (key: PrimaryNavItem['key'], name: NavSection): PrimaryNavItem[] => {
    const href = sectionHome(name, role, explicitAccess);
    return href ? [{ key, href, section: name }] : [];
  };
  const items: PrimaryNavItem[] = [
    ...(can('dashboard') ? [{ key: 'dashboard', href: DASHBOARD_PATH, feature: 'dashboard' } as const] : []),
    ...(can('daily_cash') ? [{ key: 'dailyCash', href: '/daily-cash', feature: 'daily_cash' } as const] : []),
    ...section('bar', 'bar'),
    // Members with only expenses still open Reports, as in the sidebar.
    ...(can('reports') || can('expenses') ? [{ key: 'reports', href: '/reports', feature: 'reports' } as const] : []),
    ...section('moneyTaken', 'ownerMoney'),
    ...(can('debts') ? [{ key: 'debts', href: '/debts', feature: 'debts' } as const] : []),
    // Everyone sees their own salary.
    { key: 'salaries', href: '/salaries', feature: 'salaries' },
  ];
  return items.slice(0, Math.max(0, limit));
}

/** Whether `pathname` is one of the pages the bottom bar item stands for. */
export function isPrimaryNavItemActive(item: PrimaryNavItem, pathname: string): boolean {
  const section = sectionForPath(pathname);
  if (item.section) return section === item.section;
  // A page inside a section lights only that section's item.
  if (section) return false;
  const feature = featureForPath(pathname);
  if (item.key === 'reports') return feature === 'reports' || feature === 'expenses';
  // Financial Analysis shares the dashboard feature but is its own screen.
  if (item.key === 'dashboard') {
    return feature === 'dashboard' && pathname !== '/financial-analysis' && !pathname.startsWith('/financial-analysis/');
  }
  return feature === item.feature;
}
