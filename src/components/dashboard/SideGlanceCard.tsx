'use client';

import { useId, useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Card, EmptyState, IconChip, Skeleton, TappableSurface, type Tone } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateShort } from '@/lib/formatters';
import { averageByWeekday, bestAndWorstDays, rankShares, safeRatio } from '@/lib/calculations/insights';
import { CalendarHeatmap } from '@/components/charts/CalendarHeatmap';
import { DonutBreakdown, type DonutSlice } from '@/components/charts/DonutBreakdown';
import { RadialMeter } from '@/components/charts/RadialMeter';
import { WeekdayBars } from '@/components/charts/WeekdayBars';
import { formatPercentShare } from '@/components/charts/chartFormat';
import { dailyReportHref, moneyDetailsHref, reportsHref, type MoneySide } from '@/lib/detailLinks';
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
  accent = 'neutral',
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
  side,
  links = {},
}: {
  title: string;
  icon: LucideIcon;
  /** Kept for call-site compatibility; the icon tile takes its colour from `accent`. */
  iconClassName?: string;
  /** Tone of the icon tile: the side's own (`primary` for the game club, `bar`). */
  accent?: Tone;
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
  side: MoneySide;
  /** Which pages the viewer may open; a part whose page is closed to them stays plain. */
  links?: { moneyDetails?: boolean; dailyReport?: boolean; reports?: boolean };
}) {
  const router = useRouter();
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

  const expenseKeys = useMemo(
    () => new Set(spending.filter((item) => item.key !== 'barCost').map((item) => item.key)),
    [spending],
  );
  const slices: DonutSlice[] = useMemo(() => {
    const ranked = rankShares(spending, categoricalColors.length, { key: 'other', label: te('categories.other') });
    // Profit closes the ring, so the donut reads as "where each sum of income went".
    const withProfit = profit > 0 ? [...ranked.map((slice) => ({ ...slice })), { key: 'profit', label: t('glanceProfitSlice'), value: profit, share: 0 }] : ranked;
    // Shares are of the income in the centre. In a loss month the spending is
    // more than the income, so its shares rightly add up to over 100%.
    const whole = income > 0 ? income : withProfit.reduce((sum, slice) => sum + slice.value, 0);
    let colorIndex = 0;
    return withProfit.map((slice) => ({
      ...slice,
      share: whole ? slice.value / whole : 0,
      // An expense category opens its entries in Reports; profit, goods cost and the folded tail have no list of their own.
      onSelect: links.reports && expenseKeys.has(slice.key) && !('other' in slice && slice.other)
        ? () => router.push(reportsHref(range, { category: `expense:${slice.key}`, source: side }))
        : undefined,
      color: slice.key === 'profit'
        ? chartColors.success
        : 'other' in slice && slice.other ? chartColors.gray : categoricalColors[colorIndex++],
    }));
  }, [spending, income, profit, t, te, links.reports, expenseKeys, range, side, router]);
  const marginLabel = margin === null ? '—' : formatPercentShare(margin, locale);

  return (
    <Card as="section" aria-labelledby={headingId} className="flex flex-col gap-5">
      <header className="flex items-start gap-3">
        <IconChip icon={Icon} tone={accent} />
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-sm font-semibold text-gray-950">
            {links.moneyDetails ? (
              <Link
                href={moneyDetailsHref(side, range)}
                className="group inline-flex items-center gap-1 rounded hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                {title}
                <ChevronRight size={14} aria-hidden="true" className="text-gray-300 transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-primary-600 motion-reduce:transition-none" />
              </Link>
            ) : title}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">{t('glanceDesc')}</p>
        </div>
        {/* The caption sits under the ring: at a readable size it does not fit inside it. */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <RadialMeter value={margin} color={margin !== null && margin < 0 ? chartColors.danger : color} size={56} stroke={6} label={`${t('glanceMargin')}: ${marginLabel}`}>
            <span className="text-xs font-bold tabular-nums text-gray-950">{marginLabel}</span>
          </RadialMeter>
          <span className="text-xs leading-none text-gray-500" aria-hidden="true">{t('glanceMargin')}</span>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <GlanceFact label={t('bestDay')} icon={TrendingUp} tone="success"
          value={extremes ? formatCurrency(extremes.best.value) : '—'}
          note={extremes ? formatDateShort(extremes.best.date, locale) : undefined} currency={currency}
          href={extremes && links.dailyReport ? dailyReportHref(extremes.best.date) : undefined} />
        <GlanceFact label={t('worstDay')} icon={TrendingDown} tone="muted"
          value={extremes ? formatCurrency(extremes.worst.value) : '—'}
          note={extremes ? formatDateShort(extremes.worst.date, locale) : undefined} currency={currency}
          href={extremes && links.dailyReport ? dailyReportHref(extremes.worst.date) : undefined} />
        <GlanceFact label={t('glanceProfit')} tone={profit < 0 ? 'danger' : 'success'}
          value={formatCurrency(profit)} currency={currency} className="max-sm:col-span-2"
          href={links.moneyDetails ? moneyDetailsHref(side, range) : undefined} />
      </div>

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
            onSelectDay={links.dailyReport ? (date) => router.push(dailyReportHref(date)) : undefined}
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
          <DonutBreakdown slices={slices} total={income} totalLabel={t('glanceIncomeCenter')} currency={currency} locale={locale} size="sm" />
        ) : (
          <EmptyState compact bordered title={t('noExpensesForPeriod')} />
        )}
      </div>
    </Card>
  );
}

/** One fact of the month; with `href` the whole tile opens the day or the records behind it. */
function GlanceFact({ label, value, note, currency, icon: Icon, tone, className, href }: {
  label: string;
  value: string;
  note?: string;
  currency: string;
  icon?: LucideIcon;
  tone: 'success' | 'danger' | 'muted';
  className?: string;
  href?: string;
}) {
  return (
    <TappableSurface href={href} chevron={false} className={cn('min-w-0 rounded-xl bg-gray-50 px-3 py-2.5', href && 'hover:bg-gray-100', className)}>
      <p className="flex items-center gap-1 text-xs font-medium text-gray-500">
        {Icon && <Icon size={12} aria-hidden="true" className={tone === 'success' ? 'text-success-600' : 'text-gray-400'} />}
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-1">
        <span className={cn('whitespace-nowrap text-sm font-bold tabular-nums tracking-tight', tone === 'danger' ? 'text-danger-600' : 'text-gray-950')}>{value}</span>{' '}
        <span className="text-xs text-gray-500">{currency}</span>
        {note && <span className="block text-xs text-gray-500">{note}</span>}
      </p>
    </TappableSurface>
  );
}

/** Placeholder with the glance card's own shape: header and ring, three facts, calendar beside weekday bars, donut. */
export function SideGlanceCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5 rounded-2xl border border-gray-200 bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-start gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-3/4 bg-gray-100" />
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <Skeleton className="h-14 w-14 rounded-full" />
          <Skeleton className="h-3 w-10 bg-gray-100" />
        </div>
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
