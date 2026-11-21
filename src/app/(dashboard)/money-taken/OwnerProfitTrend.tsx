'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { SegmentedControl, Skeleton } from '@/components/PresentationFoundation';
import { ChartCard, chartColors } from '@/components/dashboard/ChartCard';
import { ChangeHint, GlanceStat } from '@/components/charts/GlanceStat';
import { GlanceStatSkeleton, HeadingSkeleton, InOutChartSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { changeRatio, monthlyPairs, recentYearMonths } from '@/lib/calculations/pageGlance';
import { formatCurrency, formatMonthShort, formatYearMonth } from '@/lib/formatters';
import { formatPercentShare } from '@/components/charts/chartFormat';
import { previousYearMonth } from '@/lib/utils';

const DailyInOutChart = dynamic(() => import('@/components/charts/DailyInOutChart').then((module) => module.DailyInOutChart), {
  ssr: false,
  loading: () => <InOutChartSkeleton height={200} />,
});

const MONTHS_SHOWN = 6;

interface SideBalance {
  earned: number;
  withdrawn: number;
  available: number;
}

type Side = 'gameClub' | 'bar';

/**
 * Six months of one side's owner profit, earned against withdrawn, ending at
 * the selected month. One business at a time; each month chip opens it.
 */
export function OwnerProfitTrend({ balancesByMonth, month, currentMonth, onSelectMonth }: {
  balancesByMonth: Readonly<Record<string, { gameClub: SideBalance; bar: SideBalance }>>;
  month: string;
  /** The club's business month, still running: it is not compared with a finished month. */
  currentMonth: string;
  onSelectMonth: (month: string) => void;
}) {
  const t = useTranslations('glance.ownerProfit');
  const tg = useTranslations('glance');
  const tc = useTranslations('common');
  const { locale } = useAppLocale();
  const currency = tc('currency');
  const [side, setSide] = useState<Side>('gameClub');
  const months = useMemo(() => recentYearMonths(month, MONTHS_SHOWN), [month]);
  const pairs = useMemo(
    () => monthlyPairs(months, balancesByMonth, (row) => ({ first: row[side].earned, second: row[side].withdrawn })),
    [balancesByMonth, months, side],
  );
  const series = useMemo(
    () => pairs.map((row) => ({ date: row.month, label: formatMonthShort(row.month, locale), income: Math.max(0, row.first), expenses: Math.max(0, row.second) })),
    [locale, pairs],
  );
  const earnedTotal = pairs.reduce((sum, row) => sum + row.first, 0);
  const withdrawnTotal = pairs.reduce((sum, row) => sum + row.second, 0);
  const current = balancesByMonth[month]?.[side];
  const before = balancesByMonth[previousYearMonth(month)]?.[side];
  // Months without a row are drawn as zero but are not part of the average.
  const monthsWithData = months.filter((key) => balancesByMonth[key] !== undefined).length;
  const best = pairs.reduce<{ month: string; first: number } | null>((top, row) => (row.first > (top?.first ?? 0) ? row : top), null);
  if (!pairs.some((row) => row.first !== 0 || row.second !== 0)) return null;

  return (
    <ChartCard
      title={t('title')}
      description={t('description', { count: MONTHS_SHOWN })}
      action={(
        <SegmentedControl
          label={t('side')}
          variant="soft"
          size="sm"
          value={side}
          onChange={setSide}
          options={[{ value: 'gameClub', label: t('gameClub') }, { value: 'bar', label: t('bar') }]}
        />
      )}
    >
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <GlanceStat
          label={t('earnedMonth', { month: formatYearMonth(month, locale) })}
          value={formatCurrency(current?.earned ?? 0)}
          unit={currency}
          tone={(current?.earned ?? 0) < 0 ? 'danger' : 'success'}
          hint={month < currentMonth
            ? <ChangeHint ratio={changeRatio(current?.earned ?? 0, before?.earned ?? 0)} label={tg('vsLastMonth')} locale={locale} />
            : undefined}
        />
        <GlanceStat label={t('earnedPeriod', { count: MONTHS_SHOWN })} value={formatCurrency(earnedTotal)} unit={currency} hint={monthsWithData > 0 ? t('average', { amount: `${formatCurrency(Math.round(earnedTotal / monthsWithData))} ${currency}` }) : undefined} />
        <GlanceStat
          label={t('withdrawnPeriod', { count: MONTHS_SHOWN })}
          value={formatCurrency(withdrawnTotal)}
          unit={currency}
          hint={earnedTotal > 0 ? t('withdrawnShare', { share: formatPercentShare(withdrawnTotal / earnedTotal, locale) }) : undefined}
        />
        <GlanceStat label={t('bestMonth')} value={best ? formatYearMonth(best.month, locale) : '—'} hint={best ? `${formatCurrency(best.first)} ${currency}` : undefined} />
      </div>
      <div className="mt-4">
        <DailyInOutChart
          data={series}
          incomeLabel={t('earned')}
          expensesLabel={t('withdrawn')}
          legendLabel={t('title')}
          incomeColor={side === 'bar' ? chartColors.orange : chartColors.primary}
          expensesColor={chartColors.purple}
          currency={currency}
          locale={locale}
          height={200}
        />
      </div>
      <SegmentedControl
        className="mt-3"
        label={t('openMonth')}
        variant="chips"
        size="sm"
        value={month}
        onChange={onSelectMonth}
        options={pairs.map((row) => ({ value: row.month, label: formatMonthShort(row.month, locale) }))}
      />
    </ChartCard>
  );
}

/** The trend card while owner profit loads: side switch, four figures, the six-month chart and its month chips. */
export function OwnerProfitTrendSkeleton() {
  return (
    <SkeletonCard>
      <HeadingSkeleton action />
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <GlanceStatSkeleton key={index} />)}
      </div>
      <InOutChartSkeleton className="mt-4" height={200} bars={MONTHS_SHOWN} />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Array.from({ length: MONTHS_SHOWN }, (_, index) => <Skeleton key={index} className="h-9 w-14 rounded-full bg-gray-100" />)}
      </div>
    </SkeletonCard>
  );
}
