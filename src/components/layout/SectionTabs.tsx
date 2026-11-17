'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SegmentedControl } from '@/components/PresentationFoundation';
import { activeSectionTab, sectionTabs, type NavSection } from '@/lib/navigation';
import { useClub } from './DashboardShell';

/**
 * The tabs beside a page title that join the screens of one section (the bar,
 * owner money, the team). Each tab is its own route, already prefetched by the
 * sidebar, so switching swaps pages without a round trip. Pass the result to
 * `PageHeader`'s `tabs`. Renders nothing for a member who can open only one of
 * the section's screens.
 */
export function SectionTabs({ section }: { section: NavSection }) {
  const t = useTranslations('nav');
  const router = useRouter();
  const pathname = usePathname();
  const { role, featureAccess } = useClub();
  const tabs = sectionTabs(section, role, featureAccess);
  const active = activeSectionTab(tabs, pathname);
  if (tabs.length < 2 || !active) return null;

  return (
    <SegmentedControl
      variant="tabs"
      label={t('sectionTabs')}
      options={tabs.map((tab) => ({ value: tab.href, label: t(tab.labelKey) }))}
      value={active}
      onChange={(href) => { if (href !== active) router.push(href); }}
    />
  );
}

/**
 * `SectionTabs` for `PageHeader`'s `tabs`, or undefined when this member has
 * nothing to switch between (the header then lays out as a page without tabs).
 */
export function useSectionTabs(section: NavSection): ReactNode | undefined {
  const { role, featureAccess } = useClub();
  return sectionTabs(section, role, featureAccess).length > 1 ? <SectionTabs section={section} /> : undefined;
}
