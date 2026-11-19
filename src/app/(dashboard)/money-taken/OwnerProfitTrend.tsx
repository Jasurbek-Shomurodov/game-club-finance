'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { ChartSkeleton, SegmentedControl } from '@/components/PresentationFoundation';
import { ChartCard, chartColors } from '@/components/dashboard/ChartCard';
import { ChangeHint, GlanceStat } from '@/components/charts/GlanceStat';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { changeRatio, monthlyPairs, previousYearMonth, recentYearMonths } from '@/lib/calculations/pageGlance';
import { formatCurrency, formatMonthShort, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';

const DailyInOutChart = dynamic(() => import('@/components/charts/DailyInOutChart').then((module) => module.DailyInOutChart), {
  ssr: false,
  loading: () => <ChartSkeleton />,
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
export function OwnerProfitTrend({ balancesByMonth, month, onSelectMonth }: {
  balancesByMonth: Readonly<Record<string, { gameClub: SideBalance; bar: SideBalance }>>;
  month: string;
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
          hint={<ChangeHint ratio={changeRatio(current?.earned ?? 0, before?.earned ?? 0)} label={tg('vsLastMonth')} locale={locale} />}
        />
        <GlanceStat label={t('earnedPeriod', { count: MONTHS_SHOWN })} value={formatCurrency(earnedTotal)} unit={currency} hint={t('average', { amount: `${formatCurrency(Math.round(earnedTotal / MONTHS_SHOWN))} ${currency}` })} />
        <GlanceStat
          label={t('withdrawnPeriod', { count: MONTHS_SHOWN })}
          value={formatCurrency(withdrawnTotal)}
          unit={currency}
          hint={earnedTotal > 0 ? t('withdrawnShare', { percent: Math.round((withdrawnTotal / earnedTotal) * 100) }) : undefined}
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
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={t('openMonth')}>
        {pairs.map((row) => (
          <button
            key={row.month}
            type="button"
            aria-pressed={row.month === month}
            onClick={() => onSelectMonth(row.month)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              row.month === month ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
            )}
          >
            {formatMonthShort(row.month, locale)}
          </button>
        ))}
      </div>
    </ChartCard>
  );
}
