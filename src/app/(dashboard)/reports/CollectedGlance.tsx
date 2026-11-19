'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Card, SectionHeading, Skeleton } from '@/components/PresentationFoundation';
import { ChartCard, chartColors } from '@/components/dashboard/ChartCard';
import { DonutCardSkeleton, DonutSkeleton, InOutChartCardSkeleton, InOutChartSkeleton } from '@/components/charts/ChartSkeletons';
import { toDonutSlices } from '@/components/charts/donutSlices';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import type { CollectedMethod, CollectedMoneyMove, CollectedMoneySummary } from '@/lib/calculations/collectedMoney';
import { collectedFlowByDay } from '@/lib/calculations/pageGlance';
import { formatDateShort } from '@/lib/formatters';

const DailyInOutChart = dynamic(() => import('@/components/charts/DailyInOutChart').then((module) => module.DailyInOutChart), {
  ssr: false,
  loading: () => <InOutChartSkeleton height={200} />,
});
const DonutBreakdown = dynamic(() => import('@/components/charts/DonutBreakdown').then((module) => module.DonutBreakdown), {
  ssr: false,
  loading: () => <DonutSkeleton />,
});

/**
 * Collected money over time (taken in against paid out or moved to the
 * reserve, per day) beside how it came in by payment method.
 */
export function CollectedGlance({ moves, summary, methods, methodLabel }: {
  moves: readonly CollectedMoneyMove[];
  summary: CollectedMoneySummary;
  methods: readonly CollectedMethod[];
  methodLabel: (method: CollectedMethod) => string;
}) {
  const t = useTranslations('glance.collected');
  const tg = useTranslations('glance');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const currency = tc('currency');
  const days = useMemo(
    () => collectedFlowByDay(moves).map((day) => ({ date: day.date, label: formatDateShort(day.date, locale), income: day.collected, expenses: day.out })),
    [locale, moves],
  );
  const slices = useMemo(
    () => toDonutSlices(methods.map((method) => ({ key: method, label: methodLabel(method), value: summary.collected[method] })), { key: 'other', label: tg('other') }),
    [methodLabel, methods, summary.collected, tg],
  );
  if (!summary.collected.total) return null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <ChartCard title={t('chartTitle')} description={t('chartDescription')}>
        <div className="mt-4">
          <DailyInOutChart
            data={days}
            incomeLabel={t('in')}
            expensesLabel={t('out')}
            legendLabel={t('chartTitle')}
            incomeColor={chartColors.success}
            expensesColor={chartColors.purple}
            currency={currency}
            locale={locale}
            height={200}
          />
        </div>
      </ChartCard>
      <Card as="section">
        <SectionHeading size="sm" title={t('methodTitle')} description={t('methodDescription')} />
        <div className="mt-4">
          <DonutBreakdown size="sm" slices={slices} total={summary.collected.total} totalLabel={t('in')} currency={currency} locale={locale} />
        </div>
      </Card>
    </div>
  );
}

/** The collected chart and the payment-method donut while the period loads. */
export function CollectedGlanceSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" aria-hidden="true">
      <InOutChartCardSkeleton height={200} />
      <DonutCardSkeleton />
    </div>
  );
}

/** The one-line "paid out / reserve / still held" split bar above the glance. */
export function CollectedSplitSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-2xl border border-gray-200 bg-surface px-4 py-3 shadow-card">
      <Skeleton className="h-2.5 w-full rounded-full bg-gray-100" />
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {[0, 1, 2].map((index) => <Skeleton key={index} className="h-4 w-28" />)}
      </div>
    </div>
  );
}
