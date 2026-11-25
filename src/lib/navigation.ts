import type { UserRole } from '@/types';
import { canAccessFeature, canAccessPath, featureForPath, type FeatureKey } from '@/lib/permissions';
import { DASHBOARD_PATH } from '@/lib/routes';

/** Screens that belong together and share one sidebar item; each stays its own route. */
export type NavSection = 'bar' | 'ownerMoney' | 'team';

/**
 * Every row of tabs beside a page title: the sidebar sections, plus the areas
 * whose sidebar item is a page of its own with its sub-screens as tabs.
 */
export type TabSection = NavSection | 'reports' | 'salaries' | 'showcase';

/** Message namespace a tab's label (or a tab row's accessible name) is read from. */
export type TabLabelNamespace = 'nav' | 'reports' | 'salaries' | 'showcase';

export interface SectionTab {
  /** Where the tab leads; a view inside one page carries its query (`/reports?view=collected`). */
  href: string;
  /** Key of the label in `labelNs` (the `nav` messages unless given). */
  labelKey: string;
  labelNs?: TabLabelNamespace;
  /** Shown to owners only, whatever feature access says. */
  ownerOnly?: boolean;
}

/** Tabs of each section, in the order they are shown. The first one a member can open is the section's home. */
const SECTION_TABS: Record<TabSection, readonly SectionTab[]> = {
  bar: [
    { href: '/closing-stock', labelKey: 'closingStock' },
    { href: '/write-offs', labelKey: 'writeOffs' },
    { href: '/stock-purchase', labelKey: 'stockPurchase' },
    { href: '/products', labelKey: 'products' },
    { href: '/promotions', labelKey: 'promotions' },
  ],
  // The reserve has a sidebar item of its own (owners only); Owner Profit is one screen.
  ownerMoney: [
    { href: '/money-taken', labelKey: 'moneyTaken' },
  ],
  team: [
    { href: '/team', labelKey: 'team' },
    { href: '/history', labelKey: 'history' },
  ],
  // The closeout, collected days and write-offs are views of /reports; the day and month reports are pages.
  reports: [
    { href: '/reports', labelKey: 'title', labelNs: 'reports' },
    { href: '/reports?view=collected', labelKey: 'collectedTab', labelNs: 'reports' },
    // Write-offs are an owner tool.
    { href: '/reports?view=writeOffs', labelKey: 'writeOffsTab', labelNs: 'reports', ownerOnly: true },
    { href: '/daily-report', labelKey: 'dayTab', labelNs: 'reports' },
    { href: '/monthly-report', labelKey: 'monthTab', labelNs: 'reports' },
  ],
  salaries: [
    { href: '/salaries/employees', labelKey: 'employees', labelNs: 'salaries' },
    { href: '/salaries/operations', labelKey: 'dailyOperations', labelNs: 'salaries' },
    { href: '/salaries/history', labelKey: 'history', labelNs: 'salaries' },
  ],
  showcase: [
    { href: '/showcase', labelKey: 'tabPage', labelNs: 'showcase' },
    { href: '/showcase/games', labelKey: 'libraryTitle', labelNs: 'showcase' },
    { href: '/showcase/google', labelKey: 'tabGoogle', labelNs: 'showcase' },
    { href: '/showcase/brand', labelKey: 'brandTitle', labelNs: 'showcase', ownerOnly: true },
  ],
};

/** The accessible name of each tab row. */
export const SECTION_TABS_LABEL: Record<TabSection, { ns: TabLabelNamespace; key: string }> = {
  bar: { ns: 'nav', key: 'sectionTabs' },
  ownerMoney: { ns: 'nav', key: 'sectionTabs' },
  team: { ns: 'nav', key: 'sectionTabs' },
  reports: { ns: 'reports', key: 'viewSwitcher' },
  salaries: { ns: 'salaries', key: 'viewSwitcher' },
  showcase: { ns: 'showcase', key: 'title' },
};

/** Sections that are one sidebar item: a page in one of them lights that item only. */
const NAV_SECTIONS: readonly NavSection[] = ['bar', 'ownerMoney', 'team'];

const underPath = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
const normalizePath = (pathname: string) => (pathname !== '/' ? pathname.replace(/\/$/, '') : pathname);

/** A tab's route without its query. */
export function tabPath(href: string): string {
  return href.split('?')[0];
}

/** The section's tabs this member can open. Feature access decides, exactly as it does for the pages. */
export function sectionTabs(section: TabSection, role: UserRole, explicitAccess: unknown): SectionTab[] {
  return SECTION_TABS[section].filter((tab) => (!tab.ownerOnly || role === 'owner') && canAccessPath(role, explicitAccess, tabPath(tab.href)));
}

/** Where the section's sidebar item leads: its first tab the member can open, or null when there is none. */
export function sectionHome(section: TabSection, role: UserRole, explicitAccess: unknown): string | null {
  return sectionTabs(section, role, explicitAccess)[0]?.href ?? null;
}

/** The sidebar section a path belongs to, so its sidebar item stays highlighted on every tab. */
export function sectionForPath(pathname: string): NavSection | null {
  const normalized = normalizePath(pathname);
  for (const section of NAV_SECTIONS) {
    if (SECTION_TABS[section].some((tab) => underPath(normalized, tab.href))) return section;
  }
  return null;
}

/**
 * The tab of `tabs` a path is on, or null (a page outside the section). The
 * deepest matching route wins (`/showcase/games` over `/showcase`); views that
 * share one route cannot be told apart by path, so the first of them is named
 * and the page says which view it shows.
 */
export function activeSectionTab(tabs: readonly SectionTab[], pathname: string): string | null {
  const normalized = normalizePath(pathname);
  let best: SectionTab | null = null;
  for (const tab of tabs) {
    if (underPath(normalized, tabPath(tab.href)) && (!best || tabPath(tab.href).length > tabPath(best.href).length)) best = tab;
  }
  return best?.href ?? null;
}

/** Every tab route of every section this member can open, for the sidebar's up-front prefetch. */
export function accessibleSectionPaths(role: UserRole, explicitAccess: unknown): string[] {
  const paths = (Object.keys(SECTION_TABS) as TabSection[])
    .flatMap((section) => sectionTabs(section, role, explicitAccess).map((tab) => tabPath(tab.href)));
  return Array.from(new Set(paths));
}

/** The owner reserve: an owner-only screen with a sidebar item of its own, outside any section. */
export const RESERVE_PATH = '/reserve';

/** What the sidebar needs of an item to tell whether the page being shown is one of its pages. */
export interface SidebarNavTarget {
  href: string;
  feature: FeatureKey;
  /** The item stands for a whole section and stays lit on all of its tabs. */
  section?: NavSection;
  /**
   * The item stands for one route and its sub-paths rather than for its whole
   * feature (the reserve shares the owner-only team feature with Team).
   */
  path?: string;
}

/** Whether `pathname` is one of the pages the sidebar item stands for. One item is lit per page. */
export function isSidebarItemActive(item: SidebarNavTarget, pathname: string): boolean {
  const normalized = normalizePath(pathname);
  if (item.path) return underPath(normalized, item.path);
  const section = sectionForPath(normalized);
  const feature = featureForPath(normalized);
  if (item.section) {
    // Owner-only pages outside any section (the test checklist) sit under Team; the reserve has its own item.
    return section === item.section
      || (item.section === 'team' && section === null && feature === 'team' && !underPath(normalized, RESERVE_PATH));
  }
  // A page inside a section lights only that section's item.
  if (section) return false;
  if (item.href === '/reports') return feature === 'reports' || feature === 'expenses';
  // Both dashboard-feature routes share a feature; tell them apart by path.
  const onAnalysis = underPath(normalized, '/financial-analysis');
  if (item.href === '/financial-analysis') return onAnalysis;
  if (item.href === DASHBOARD_PATH) return feature === 'dashboard' && !onAnalysis;
  return feature === item.feature;
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
