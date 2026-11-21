'use client';

import { SectionTabs } from '@/components/layout/SectionTabs';

/** Views inside the Reports page itself. */
export type ReportsView = 'closeout' | 'collected' | 'writeOffs';
/** Every report tab: the Reports views plus the day and month reports, which are pages of their own. */
export type ReportsTab = ReportsView | 'day' | 'month';

const PAGE_OF_TAB: Record<'day' | 'month', string> = { day: '/daily-report', month: '/monthly-report' };
const VIEWS: readonly ReportsView[] = ['closeout', 'collected', 'writeOffs'];

/** The Reports address that opens on `view`. */
export function reportsViewHref(view: ReportsView): string {
  return view === 'closeout' ? '/reports' : `/reports?view=${view}`;
}

/**
 * The `reports` section tabs (`SECTION_TABS` in `src/lib/navigation.ts`), named
 * by view: the money closeout, collected days and write-offs of the Reports
 * page, and the day and month profit reports. The Reports page switches its
 * own views in place (`onSelectView`); everything else is a navigation to a
 * prefetched route.
 */
export function ReportsTabs({ value, onSelectView }: {
  value: ReportsTab;
  /** Given by the Reports page: called instead of navigating for one of its own views. */
  onSelectView?: (view: ReportsView) => void;
}) {
  return (
    <SectionTabs
      section="reports"
      active={value === 'day' || value === 'month' ? PAGE_OF_TAB[value] : reportsViewHref(value)}
      onSelect={(href) => {
        const view = VIEWS.find((candidate) => reportsViewHref(candidate) === href);
        if (!view || !onSelectView) return false;
        onSelectView(view);
        return true;
      }}
    />
  );
}
