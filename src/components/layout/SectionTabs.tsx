'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SegmentedControl } from '@/components/PresentationFoundation';
import { SECTION_TABS_LABEL, activeSectionTab, sectionTabs, type TabSection } from '@/lib/navigation';
import { useClub } from './DashboardShell';

export interface SectionTabsOptions {
  /**
   * The tab shown, as its href. Given by a page whose tabs are views of one
   * route (Reports) or that switches in place (Salaries); otherwise the path decides.
   */
  active?: string;
  /** Called before navigating; return true when the page switched the view itself. */
  onSelect?: (href: string) => boolean | void;
}

/**
 * The tabs beside a page title that join the screens of one section (the bar,
 * the team, the reports, salaries, the public page). Tabs come
 * from `SECTION_TABS` in `src/lib/navigation.ts`; each is a route already
 * prefetched by the sidebar, so switching swaps pages without a round trip.
 * Pass the result to `PageHeader`'s `tabs`. Renders nothing for a member who
 * can open only one of the section's screens.
 */
export function SectionTabs({ section, active: activeOverride, onSelect }: { section: TabSection } & SectionTabsOptions) {
  // Tab labels keep the wording of their own area, so they are read from several namespaces.
  const t = useTranslations() as unknown as (key: string) => string;
  const router = useRouter();
  const pathname = usePathname();
  const { role, featureAccess } = useClub();
  const tabs = sectionTabs(section, role, featureAccess);
  const active = activeOverride && tabs.some((tab) => tab.href === activeOverride) ? activeOverride : activeSectionTab(tabs, pathname);
  if (tabs.length < 2 || !active) return null;
  const label = SECTION_TABS_LABEL[section];

  return (
    <SegmentedControl
      variant="tabs"
      label={t(`${label.ns}.${label.key}`)}
      options={tabs.map((tab) => ({ value: tab.href, label: t(`${tab.labelNs ?? 'nav'}.${tab.labelKey}`) }))}
      value={active}
      onChange={(href) => {
        if (href === active) return;
        if (onSelect?.(href) === true) return;
        router.push(href);
      }}
    />
  );
}

/**
 * `SectionTabs` for `PageHeader`'s `tabs`, or undefined when this member has
 * nothing to switch between (the header then lays out as a page without tabs).
 */
export function useSectionTabs(section: TabSection, options: SectionTabsOptions = {}): ReactNode | undefined {
  const { role, featureAccess } = useClub();
  return sectionTabs(section, role, featureAccess).length > 1
    ? <SectionTabs section={section} active={options.active} onSelect={options.onSelect} />
    : undefined;
}
