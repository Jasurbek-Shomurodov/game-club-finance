import { describe, expect, it } from 'vitest';
import { accessibleSectionPaths, activeSectionTab, sectionForPath, sectionHome, sectionTabs } from './navigation';

const hrefs = (tabs: { href: string }[]) => tabs.map((tab) => tab.href);

describe('sectionTabs', () => {
  it('shows an owner every tab of every section', () => {
    expect(hrefs(sectionTabs('bar', 'owner', null))).toEqual(['/closing-stock', '/stock-purchase', '/products', '/promotions']);
    expect(hrefs(sectionTabs('ownerMoney', 'owner', null))).toEqual(['/money-taken', '/reserve']);
    expect(hrefs(sectionTabs('team', 'owner', null))).toEqual(['/team', '/history']);
  });

  it('keeps the owner-only tabs from other roles, whatever they were granted', () => {
    // The reserve and the edit history share the owner-only team feature.
    expect(hrefs(sectionTabs('ownerMoney', 'admin', null))).toEqual(['/money-taken']);
    expect(hrefs(sectionTabs('ownerMoney', 'admin', ['owner_profit', 'team']))).toEqual(['/money-taken']);
    expect(sectionTabs('team', 'admin', ['team'])).toEqual([]);
  });

  it('follows feature access tab by tab', () => {
    // A viewer reads the catalog only.
    expect(hrefs(sectionTabs('bar', 'viewer', null))).toEqual(['/products']);
    // Promotions share the closing-stock feature.
    expect(hrefs(sectionTabs('bar', 'admin', ['closing_stock']))).toEqual(['/closing-stock', '/promotions']);
    expect(hrefs(sectionTabs('bar', 'admin', ['stock_purchase', 'inventory']))).toEqual(['/stock-purchase', '/products']);
    expect(sectionTabs('bar', 'admin', ['dashboard'])).toEqual([]);
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
    expect(sectionForPath('/reserve')).toBe('ownerMoney');
    expect(sectionForPath('/history')).toBe('team');
    expect(sectionForPath('/closing-stock/anything')).toBe('bar');
  });

  it('has no section for other pages, including look-alike paths', () => {
    expect(sectionForPath('/dashboard')).toBeNull();
    expect(sectionForPath('/salaries/history')).toBeNull();
    expect(sectionForPath('/products-old')).toBeNull();
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
      '/closing-stock', '/stock-purchase', '/products', '/promotions', '/money-taken', '/reserve', '/team', '/history',
    ]);
    expect(accessibleSectionPaths('viewer', null)).toEqual(['/products', '/money-taken']);
  });
});
