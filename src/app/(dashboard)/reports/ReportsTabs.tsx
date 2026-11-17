'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SegmentedControl } from '@/components/PresentationFoundation';
import { useClub } from '@/components/layout/DashboardShell';

/** Views inside the Reports page itself. */
export type ReportsView = 'closeout' | 'collected' | 'writeOffs';
/** Every report tab: the Reports views plus the day and month reports, which are pages of their own. */
export type ReportsTab = ReportsView | 'day' | 'month';

const PAGE_OF_TAB: Record<'day' | 'month', string> = { day: '/daily-report', month: '/monthly-report' };

/** The Reports address that opens on `view`. */
export function reportsViewHref(view: ReportsView): string {
  return view === 'closeout' ? '/reports' : `/reports?view=${view}`;
}

/**
 * One row of tabs for every report: the money closeout, collected days and
 * write-offs of the Reports page, and the day and month profit reports. The
 * Reports page switches its own views in place (`onSelectView`); everything
 * else is a navigation to a prefetched route.
 */
export function ReportsTabs({ value, onSelectView }: {
  value: ReportsTab;
  /** Given by the Reports page: called instead of navigating for one of its own views. */
  onSelectView?: (view: ReportsView) => void;
}) {
  const t = useTranslations('reports');
  const router = useRouter();
  const { role } = useClub();

  function select(next: ReportsTab) {
    if (next === value) return;
    if (next === 'day' || next === 'month') router.push(PAGE_OF_TAB[next]);
    else if (onSelectView) onSelectView(next);
    else router.push(reportsViewHref(next));
  }

  return (
    <SegmentedControl
      variant="tabs"
      label={t('viewSwitcher')}
      options={[
        { value: 'closeout', label: t('title') },
        { value: 'collected', label: t('collectedTab') },
        // Write-offs are an owner tool.
        ...(role === 'owner' ? [{ value: 'writeOffs' as const, label: t('writeOffsTab') }] : []),
        { value: 'day', label: t('dayTab') },
        { value: 'month', label: t('monthTab') },
      ]}
      value={value}
      onChange={select}
    />
  );
}
