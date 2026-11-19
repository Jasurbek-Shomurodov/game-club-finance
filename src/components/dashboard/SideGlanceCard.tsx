'use client';

import { useId, useMemo, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, EmptyState, Skeleton } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateShort } from '@/lib/formatters';
import { averageByWeekday, bestAndWorstDays, rankShares, safeRatio } from '@/lib/calculations/insights';
import { CalendarHeatmap } from '@/components/charts/CalendarHeatmap';
import { DonutBreakdown, type DonutSlice } from '@/components/charts/DonutBreakdown';
import { RadialMeter } from '@/components/charts/RadialMeter';
import { WeekdayBars } from '@/components/charts/WeekdayBars';
import { formatPercentShare } from '@/components/charts/chartFormat';
import { categoricalColors, chartColors } from './ChartCard';

export interface SideGlanceSpending {
  key: string;
  label: string;
  value: number;
}

/**
 * One business's month in one card: every day shaded on a calendar, which
 * weekdays earn most, its best and weakest day, its margin and where its money
 * went. The game club and the bar each get their own card; nothing here adds
 * the two together.
 */
export function SideGlanceCard({
  title,
  icon: Icon,
  iconClassName,
  color,
  yearMonth,
  range,
  values,
  through,
  today,
  income,
  profit,
  spending,
  currency,
  locale,
  action,
}: {
  title: string;
  icon: LucideIcon;
  iconClassName: string;
  /** The side's own hue (teal for the game club, orange for the bar). */
  color: string;
  yearMonth: string;
  range: { from: string; to: string };
  /** The side's income per date. */
  values: ReadonlyMap<string, number>;
  /** The side's latest entry date in the month; later days are not counted yet. */
  through: string | null;
  today: string;
  income: number;
  profit: number;
  /** What the side's income paid for (expense categories, and the bar's goods cost). */
  spending: readonly SideGlanceSpending[];
  currency: string;
  locale: string;
  action?: ReactNode;
}) {
  const t = useTranslations('dashboard');
  const te = useTranslations('expenses');
  const headingId = useId();
  const margin = safeRatio(profit, income);
  const lastCounted = through && through < range.to ? through : range.to;
  const weekdays = useMemo(
    () => averageByWeekday(values, { from: range.from, through: through ? lastCounted : '' }),
    [values, range.from, through, lastCounted],
  );
  const extremes = useMemo(() => bestAndWorstDays(values), [values]);

  const slices: DonutSlice[] = useMemo(() => {
    const ranked = rankShares(spending, categoricalColors.length, { key: 'other', label: te('categories.other') });
    // Profit closes the ring, so the donut reads as "where each sum of income went".
    const withProfit = profit > 0 ? [...ranked.map((slice) => ({ ...slice })), { key: 'profit', label: t('glanceProfitSlice'), value: profit, share: 0 }] : ranked;
    const whole = withProfit.reduce((sum, slice) => sum + slice.value, 0);
    let colorIndex = 0;
    return withProfit.map((slice) => ({
      ...slice,
      share: whole ? slice.value / whole : 0,
      color: slice.key === 'profit'
        ? chartColors.success
        : 'other' in slice && slice.other ? chartColors.gray : categoricalColors[colorIndex++],
    }));
  }, [spending, profit, t, te]);
  const sliceTotal = slices.reduce((sum, slice) => sum + slice.value, 0);
  const marginLabel = margin === null ? '—' : formatPercentShare(margin, locale);

  return (
    <Card as="section" aria-labelledby={headingId} className="flex flex-col gap-5">
      <header className="flex items-start gap-3">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100', iconClassName)} aria-hidden="true">
          <Icon size={20} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-sm font-semibold text-gray-950">{title}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{t('glanceDesc')}</p>
        </div>
        {action}
        <RadialMeter value={margin} color={margin !== null && margin < 0 ? chartColors.danger : color} size={56} stroke={6} label={`${t('glanceMargin')}: ${marginLabel}`}>
          <span className="flex flex-col leading-none">
            <span className="text-xs font-bold tabular-nums text-gray-950">{marginLabel}</span>
            <span className="mt-0.5 text-[9px] uppercase tracking-wide text-gray-500">{t('glanceMargin')}</span>
          </span>
        </RadialMeter>
      </header>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <GlanceFact label={t('bestDay')} icon={TrendingUp} tone="success"
          value={extremes ? formatCurrency(extremes.best.value) : '—'}
          note={extremes ? formatDateShort(extremes.best.date, locale) : undefined} currency={currency} />
        <GlanceFact label={t('worstDay')} icon={TrendingDown} tone="muted"
          value={extremes ? formatCurrency(extremes.worst.value) : '—'}
          note={extremes ? formatDateShort(extremes.worst.date, locale) : undefined} currency={currency} />
        <GlanceFact label={t('glanceProfit')} tone={profit < 0 ? 'danger' : 'success'}
          value={formatCurrency(profit)} currency={currency} className="max-sm:col-span-2" />
      </dl>

      <div className="grid gap-5 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h3 className="mb-2 text-xs font-semibold text-gray-700">{t('dayByDay')}</h3>
          <CalendarHeatmap
            yearMonth={yearMonth}
            values={values}
            through={through}
            today={today}
            color={color}
            currency={currency}
            locale={locale}
            legendLow={t('heatmapLess')}
            legendHigh={t('heatmapMore')}
          />
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 text-xs font-semibold text-gray-700">{t('byWeekday')}</h3>
          <WeekdayBars data={weekdays} color={color} currency={currency} locale={locale} averageLabel={t('averagePerDay')} className="h-36" />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs font-semibold text-gray-700">{t('glanceWhereMoneyWent')}</h3>
        {slices.length ? (
          <DonutBreakdown slices={slices} total={sliceTotal} totalLabel={t('glanceIncomeCenter')} currency={currency} locale={locale} size="sm" />
        ) : (
          <EmptyState compact bordered title={t('noExpensesForPeriod')} />
        )}
      </div>
    </Card>
  );
}

function GlanceFact({ label, value, note, currency, icon: Icon, tone, className }: {
  label: string;
  value: string;
  note?: string;
  currency: string;
  icon?: LucideIcon;
  tone: 'success' | 'danger' | 'muted';
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 rounded-xl bg-gray-50 px-3 py-2.5', className)}>
      <dt className="flex items-center gap-1 text-[11px] font-medium text-gray-500">
        {Icon && <Icon size={12} aria-hidden="true" className={tone === 'success' ? 'text-success-600' : 'text-gray-400'} />}
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-1">
        <span className={cn('text-sm font-bold tabular-nums tracking-tight', tone === 'danger' ? 'text-danger-600' : 'text-gray-950')}>{value}</span>
        <span className="ml-1 text-[11px] text-gray-500">{currency}</span>
        {note && <span className="block text-[11px] text-gray-500">{note}</span>}
      </dd>
    </div>
  );
}

/** Placeholder with the glance card's own shape: header and ring, three facts, calendar beside weekday bars, donut. */
export function SideGlanceCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5 rounded-2xl border border-gray-200 bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-start gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-3/4 bg-gray-100" />
        </div>
        <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className={cn('space-y-2 rounded-xl bg-gray-50 px-3 py-2.5', index === 2 && 'max-sm:col-span-2')}>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }, (_, index) => <Skeleton key={index} className="h-8 bg-gray-100" />)}
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <div className="flex h-36 items-end gap-1.5">
            {[55, 70, 45, 80, 60, 95, 75].map((height, index) => (
              <Skeleton key={index} className="flex-1 rounded-b-sm rounded-t bg-gray-100" style={{ height: `${height}%` }} />
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <Skeleton className="h-36 w-36 shrink-0 rounded-full bg-gray-100" />
        <div className="w-full flex-1 space-y-3">
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-6 w-full bg-gray-100" />)}
        </div>
      </div>
    </div>
  );
}
