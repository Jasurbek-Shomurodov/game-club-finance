'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Card, ChartSkeleton, SectionHeading } from '@/components/PresentationFoundation';
import { ChartCard, chartColors } from '@/components/dashboard/ChartCard';
import { toDonutSlices } from '@/components/charts/donutSlices';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import type { CollectedMethod, CollectedMoneyMove, CollectedMoneySummary } from '@/lib/calculations/collectedMoney';
import { collectedFlowByDay } from '@/lib/calculations/pageGlance';
import { formatDateShort } from '@/lib/formatters';

const DailyInOutChart = dynamic(() => import('@/components/charts/DailyInOutChart').then((module) => module.DailyInOutChart), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});
const DonutBreakdown = dynamic(() => import('@/components/charts/DonutBreakdown').then((module) => module.DonutBreakdown), {
  ssr: false,
  loading: () => <ChartSkeleton />,
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
