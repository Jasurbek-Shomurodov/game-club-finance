import type { UserRole } from '@/types';
import { canAccessPath } from '@/lib/permissions';

/** Screens that belong together and share one sidebar item; each stays its own route. */
export type NavSection = 'bar' | 'ownerMoney' | 'team';

export interface SectionTab {
  href: string;
  /** Key in the `nav` messages. */
  labelKey: 'closingStock' | 'stockPurchase' | 'products' | 'promotions' | 'moneyTaken' | 'reserve' | 'team' | 'history';
}

/** Tabs of each section, in the order they are shown. The first one a member can open is the section's home. */
const SECTION_TABS: Record<NavSection, readonly SectionTab[]> = {
  bar: [
    { href: '/closing-stock', labelKey: 'closingStock' },
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
