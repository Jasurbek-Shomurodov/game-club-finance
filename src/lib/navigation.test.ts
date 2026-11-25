import { describe, expect, it } from 'vitest';
import {
  RESERVE_PATH,
  accessibleSectionPaths,
  activeSectionTab,
  isPrimaryNavItemActive,
  isSidebarItemActive,
  primaryNavItems,
  sectionForPath,
  sectionHome,
  sectionTabs,
  type SidebarNavTarget,
} from './navigation';

const hrefs = (tabs: { href: string }[]) => tabs.map((tab) => tab.href);

describe('sectionTabs', () => {
  it('shows an owner every tab of every section', () => {
    expect(hrefs(sectionTabs('bar', 'owner', null))).toEqual(['/closing-stock', '/write-offs', '/stock-purchase', '/products', '/promotions']);
    // The reserve has a sidebar item of its own, so Owner Profit has no tabs.
    expect(hrefs(sectionTabs('ownerMoney', 'owner', null))).toEqual(['/money-taken']);
    expect(hrefs(sectionTabs('team', 'owner', null))).toEqual(['/team', '/history']);
  });

  it('keeps the owner-only tabs from other roles, whatever they were granted', () => {
    // Team and the edit history are owner-only, even with the team feature granted.
    expect(sectionTabs('team', 'admin', ['team'])).toEqual([]);
    expect(hrefs(sectionTabs('ownerMoney', 'admin', ['owner_profit', 'team']))).toEqual(['/money-taken']);
  });

  it('follows feature access tab by tab', () => {
    // A viewer reads the catalog only.
    expect(hrefs(sectionTabs('bar', 'viewer', null))).toEqual(['/products']);
    // Write-offs and promotions share the closing-stock feature.
    expect(hrefs(sectionTabs('bar', 'admin', ['closing_stock']))).toEqual(['/closing-stock', '/write-offs', '/promotions']);
    expect(hrefs(sectionTabs('bar', 'admin', ['stock_purchase', 'inventory']))).toEqual(['/stock-purchase', '/products']);
    expect(sectionTabs('bar', 'admin', ['dashboard'])).toEqual([]);
  });
});

describe('tab rows of pages with their own sidebar item', () => {
  it('lists the report views and pages, write-offs for owners only', () => {
    expect(hrefs(sectionTabs('reports', 'owner', null))).toEqual(['/reports', '/reports?view=collected', '/reports?view=writeOffs', '/daily-report', '/monthly-report']);
    expect(hrefs(sectionTabs('reports', 'admin', ['reports']))).toEqual(['/reports', '/reports?view=collected', '/daily-report', '/monthly-report']);
    // Expenses alone opens /reports but not the day and month reports.
    expect(hrefs(sectionTabs('reports', 'admin', ['expenses']))).toEqual(['/reports', '/reports?view=collected']);
  });

  it('shows every member the salary views and keeps the brand page for owners', () => {
    expect(hrefs(sectionTabs('salaries', 'viewer', null))).toEqual(['/salaries/employees', '/salaries/operations', '/salaries/history']);
    expect(hrefs(sectionTabs('showcase', 'owner', null))).toEqual(['/showcase', '/showcase/games', '/showcase/google', '/showcase/brand']);
    expect(hrefs(sectionTabs('showcase', 'admin', ['showcase']))).toEqual(['/showcase', '/showcase/games', '/showcase/google']);
    expect(sectionTabs('showcase', 'admin', ['dashboard'])).toEqual([]);
  });

  it('names the deepest matching tab and leaves the sidebar sections alone', () => {
    const showcase = sectionTabs('showcase', 'owner', null);
    expect(activeSectionTab(showcase, '/showcase')).toBe('/showcase');
    expect(activeSectionTab(showcase, '/showcase/games')).toBe('/showcase/games');
    // Views of one route cannot be told apart by path: the page names its view itself.
    expect(activeSectionTab(sectionTabs('reports', 'owner', null), '/reports')).toBe('/reports');
    expect(sectionForPath('/reports')).toBeNull();
    expect(sectionForPath('/showcase/games')).toBeNull();
  });
});

describe('sectionHome', () => {
  it('is the first tab the member can open', () => {
    expect(sectionHome('bar', 'owner', null)).toBe('/closing-stock');
    expect(sectionHome('bar', 'viewer', null)).toBe('/products');
    expect(sectionHome('bar', 'admin', ['stock_purchase'])).toBe('/stock-purchase');
    expect(sectionHome('team', 'admin', null)).toBeNull();
  });
});

describe('sectionForPath', () => {
  it('finds the section of a tab, its sub-pages and a trailing slash', () => {
    expect(sectionForPath('/promotions')).toBe('bar');
    expect(sectionForPath('/products/')).toBe('bar');
    expect(sectionForPath('/money-taken')).toBe('ownerMoney');
    expect(sectionForPath('/history')).toBe('team');
    expect(sectionForPath('/closing-stock/anything')).toBe('bar');
  });

  it('has no section for other pages, including look-alike paths', () => {
    expect(sectionForPath('/dashboard')).toBeNull();
    expect(sectionForPath('/salaries/history')).toBeNull();
    expect(sectionForPath('/products-old')).toBeNull();
    // The reserve is a screen of its own, outside Owner Profit.
    expect(sectionForPath('/reserve')).toBeNull();
    expect(sectionForPath('/')).toBeNull();
  });
});

describe('activeSectionTab', () => {
  it('names the tab the path is on', () => {
    const tabs = sectionTabs('bar', 'owner', null);
    expect(activeSectionTab(tabs, '/stock-purchase')).toBe('/stock-purchase');
    expect(activeSectionTab(tabs, '/products/')).toBe('/products');
    expect(activeSectionTab(tabs, '/reports')).toBeNull();
  });
});

describe('accessibleSectionPaths', () => {
  it('lists every tab route the member can open', () => {
    expect(accessibleSectionPaths('owner', null)).toEqual([
      '/closing-stock', '/write-offs', '/stock-purchase', '/products', '/promotions', '/money-taken', '/team', '/history',
      // The views of /reports share one route, listed once.
      '/reports', '/daily-report', '/monthly-report',
      '/salaries/employees', '/salaries/operations', '/salaries/history',
      '/showcase', '/showcase/games', '/showcase/google', '/showcase/brand',
    ]);
    expect(accessibleSectionPaths('viewer', null)).toEqual([
      '/products', '/money-taken', '/reports', '/daily-report', '/monthly-report',
      '/salaries/employees', '/salaries/operations', '/salaries/history',
    ]);
  });
});

describe('primaryNavItems', () => {
  const keys = (items: { key: string }[]) => items.map((item) => item.key);

  it('gives an owner the four everyday screens', () => {
    const items = primaryNavItems('owner', null);
    expect(keys(items)).toEqual(['dashboard', 'dailyCash', 'bar', 'reports']);
    expect(items.map((item) => item.href)).toEqual(['/dashboard', '/daily-cash', '/closing-stock', '/reports']);
  });

  it('fills the bar with the next screens a member can open', () => {
    // Only daily cash and debts: no dashboard, bar or reports slot is left empty.
    expect(keys(primaryNavItems('admin', ['daily_cash', 'debts']))).toEqual(['dailyCash', 'debts', 'salaries']);
    // Expenses alone still opens Reports.
    expect(keys(primaryNavItems('admin', ['expenses']))).toEqual(['reports', 'salaries']);
    // The bar item leads to the first bar tab the member has.
    expect(primaryNavItems('admin', ['stock_purchase']).find((item) => item.key === 'bar')?.href).toBe('/stock-purchase');
  });

  it('honours the limit', () => {
    expect(keys(primaryNavItems('owner', null, 2))).toEqual(['dashboard', 'dailyCash']);
    expect(keys(primaryNavItems('owner', null, 10))).toEqual(['dashboard', 'dailyCash', 'bar', 'reports', 'moneyTaken', 'debts', 'salaries']);
  });
});

describe('isPrimaryNavItemActive', () => {
  const [dashboard, dailyCash, bar, reports, ownerMoney, debts, salaries] = primaryNavItems('owner', null, 10);
  const active = (pathname: string) => [dashboard, dailyCash, bar, reports, ownerMoney, debts, salaries]
    .filter((item) => isPrimaryNavItemActive(item, pathname)).map((item) => item.key);

  it('lights one item per page', () => {
    expect(active('/dashboard')).toEqual(['dashboard']);
    expect(active('/daily-cash')).toEqual(['dailyCash']);
    expect(active('/reports')).toEqual(['reports']);
    expect(active('/daily-report')).toEqual(['reports']);
    expect(active('/debts')).toEqual(['debts']);
    expect(active('/salaries')).toEqual(['salaries']);
  });

  it('lights a section item on every one of its tabs', () => {
    for (const path of ['/closing-stock', '/write-offs', '/stock-purchase', '/products', '/promotions']) expect(active(path)).toEqual(['bar']);
    expect(active('/money-taken')).toEqual(['moneyTaken']);
  });

  it('lights nothing on screens that live in the menu', () => {
    expect(active('/financial-analysis')).toEqual([]);
    expect(active('/team')).toEqual([]);
    expect(active('/settings')).toEqual([]);
    // The reserve has its own sidebar item, so it does not light Owner Profit.
    expect(active('/reserve')).toEqual([]);
  });
});

describe('isSidebarItemActive', () => {
  // The sidebar's items as an owner sees them, in order.
  const items: SidebarNavTarget[] = [
    { href: '/dashboard', feature: 'dashboard' },
    { href: '/financial-analysis', feature: 'dashboard' },
    { href: '/assistant', feature: 'assistant' },
    { href: '/daily-cash', feature: 'daily_cash' },
    { href: '/closing-stock', feature: 'closing_stock', section: 'bar' },
    { href: '/reports', feature: 'reports' },
    { href: '/money-taken', feature: 'owner_profit', section: 'ownerMoney' },
    { href: RESERVE_PATH, feature: 'team', path: RESERVE_PATH },
    { href: '/debts', feature: 'debts' },
    { href: '/salaries', feature: 'salaries' },
    { href: '/showcase', feature: 'showcase' },
    { href: '/team', feature: 'team', section: 'team' },
  ];
  const lit = (pathname: string) => items.filter((item) => isSidebarItemActive(item, pathname)).map((item) => item.href);

  it('lights only the Reserve item on the reserve, not Owner Profit or Team', () => {
    expect(lit('/reserve')).toEqual(['/reserve']);
    expect(lit('/reserve/')).toEqual(['/reserve']);
    expect(lit('/reserve/anything')).toEqual(['/reserve']);
    expect(lit('/reserve-old')).toEqual([]);
  });

  it('lights one item per page', () => {
    expect(lit('/dashboard')).toEqual(['/dashboard']);
    expect(lit('/financial-analysis')).toEqual(['/financial-analysis']);
    expect(lit('/money-taken')).toEqual(['/money-taken']);
    expect(lit('/daily-report')).toEqual(['/reports']);
    expect(lit('/write-offs')).toEqual(['/closing-stock']);
    expect(lit('/salaries/history')).toEqual(['/salaries']);
    expect(lit('/showcase/games')).toEqual(['/showcase']);
  });

  it('keeps the owner-only pages outside any section under Team', () => {
    expect(lit('/history')).toEqual(['/team']);
    expect(lit('/test-checklist')).toEqual(['/team']);
  });
});
