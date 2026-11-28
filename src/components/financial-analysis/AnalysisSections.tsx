'use client';

import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Card,
  HelpButton,
  IconChip,
  SectionHeading,
  Skeleton,
  metricToneClassName,
  toneForAmount,
  type MetricTone,
  type Tone,
  TappableSurface,
} from '@/components/PresentationFoundation';
import type { SourceIndicators } from '@/lib/calculations/financialAnalysis';
import { formatCurrency } from '@/lib/formatters';
import { SkeletonCard } from '@/components/charts/ChartSkeletons';
import { chartColors } from '@/components/dashboard/ChartCard';
import { RadialMeter } from '@/components/charts/RadialMeter';
import { formatPercentShare } from '@/components/charts/chartFormat';

export function Section({ id, title, description, icon: Icon, iconClassName, action, help, children }: {
  /** Anchor for in-page navigation. */
  id?: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  /** Control beside the heading, e.g. a grouping switch. */
  action?: ReactNode;
  /** Explanation behind a "?" beside the title. */
  help?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-28 space-y-3">
      <SectionHeading
        title={title}
        description={description}
        icon={Icon ? <Icon size={18} aria-hidden="true" /> : undefined}
        iconClassName={iconClassName}
        badge={help ? <HelpButton title={title} body={help} className="-my-1.5" /> : undefined}
        action={action}
      />
      {children}
    </section>
  );
}

// A figure tile is a row (label left, amount right) in a narrow card and a column where three fit side by side.
const FIGURE_GRID = 'mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3';
const FIGURE_TILE = 'min-w-0 rounded-xl bg-gray-50 px-3 py-2.5 max-sm:flex max-sm:items-center max-sm:justify-between max-sm:gap-3 lg:max-xl:flex lg:max-xl:items-center lg:max-xl:justify-between lg:max-xl:gap-3';

/**
 * One side's month on one card: money in, spent and profit with their change,
 * a bar splitting the income into what was spent and what was kept, the
 * margin ring and the daily average. The game club and the bar each get one;
 * the two are never added together.
 */
export function SideScorecard({ title, icon: Icon, accent = 'neutral', color, incomeLabel, now, compareNow = now, before, compare, loading, currency, locale, detailsHref, spentHref, labels }: {
  title: string;
  icon: LucideIcon;
  /** Kept for call-site compatibility; the icon tile takes its colour from `accent`. */
  iconClassName?: string;
  /** Tone of the icon tile: the side's own (`primary` for the game club, `bar`). */
  accent?: Tone;
  color: string;
  incomeLabel: string;
  now: SourceIndicators;
  /** The figures `before` is compared with, when the compared stretch is shorter than `now`'s; defaults to `now`. */
  compareNow?: SourceIndicators;
  before?: SourceIndicators;
  compare?: (now: number, before: number) => { value: number | null; label: string };
  loading: boolean;
  currency: string;
  locale: string;
  detailsHref?: string;
  spentHref?: string;
  labels: { spent: string; profit: string; margin: string; perDay: string; kept: string };
}) {
  if (loading) return <SideScorecardSkeleton />;
  const margin = now.marginPct === null ? null : now.marginPct / 100;
  const marginText = margin === null ? '—' : formatPercentShare(margin, locale, 1);
  // Without income there is nothing to split: the bar stays empty and the shares read "—".
  const hasIncome = now.income > 0;
  const spentShare = hasIncome ? Math.min(1, now.spent / now.income) : 0;
  const keptShare = hasIncome ? Math.max(0, 1 - spentShare) : 0;
  const spentText = hasIncome ? formatPercentShare(spentShare, locale) : '—';
  const keptText = hasIncome ? formatPercentShare(keptShare, locale) : '—';
  const figures: Array<{ key: string; label: string; amount: number; tone: MetricTone; href?: string; goodWhen: 'up' | 'down'; compared: number; previous?: number }> = [
    { key: 'in', label: incomeLabel, amount: now.income, tone: 'default', href: detailsHref, goodWhen: 'up', compared: compareNow.income, previous: before?.income },
    { key: 'spent', label: labels.spent, amount: now.spent, tone: 'danger', href: spentHref, goodWhen: 'down', compared: compareNow.spent, previous: before?.spent },
    { key: 'profit', label: labels.profit, amount: now.left, tone: toneForAmount(now.left), href: detailsHref, goodWhen: 'up', compared: compareNow.left, previous: before?.left },
  ];
  return (
    <Card as="section" aria-label={title}>
      <header className="flex items-center gap-3">
        <IconChip icon={Icon} tone={accent} />
        <h2 className="min-w-0 flex-1 text-base font-semibold tracking-tight text-gray-950">{title}</h2>
        <RadialMeter value={margin} color={margin !== null && margin < 0 ? chartColors.danger : color} size={56} stroke={6} label={`${labels.margin}: ${marginText}`}>
          <span className="text-xs font-bold tabular-nums text-gray-950">{marginText}</span>
        </RadialMeter>
      </header>

      {/* Three across only where each figure has room for a whole amount; otherwise one row per figure. */}
      <div className={FIGURE_GRID}>
        {figures.map((figure) => {
          const change = compare && figure.previous !== undefined ? compare(figure.compared, figure.previous) : null;
          const good = change?.value !== null && change?.value !== undefined
            ? (figure.goodWhen === 'up' ? change.value >= 0 : change.value <= 0)
            : null;
          const body = (
            <>
              <span className="block min-w-0 text-xs font-medium text-gray-500">{figure.label}</span>
              <span className="block min-w-0 max-sm:text-right lg:max-xl:text-right">
                <span className={cn('mt-1 block text-base font-bold tabular-nums tracking-tight max-sm:mt-0 lg:max-xl:mt-0', metricToneClassName[figure.tone])}>
                  <span className="whitespace-nowrap">{formatCurrency(figure.amount)}</span>{' '}
                  <span className="text-xs font-medium tracking-normal text-gray-500">{currency}</span>
                </span>
                {change && (
                  <span className={cn('mt-0.5 flex items-center gap-0.5 text-xs font-semibold tabular-nums max-sm:justify-end lg:max-xl:justify-end', good === null ? 'text-gray-500' : good ? 'text-success-600' : 'text-danger-600')} title={change.label}>
                    {change.value === null ? '—' : (
                      <>
                        {change.value >= 0 ? <ArrowUpRight size={12} aria-hidden="true" /> : <ArrowDownRight size={12} aria-hidden="true" />}
                        {/* The sign is text, so the direction does not rest on the arrow and colour alone. */}
                        {change.value >= 0 ? '+' : '−'}{formatPercentShare(Math.abs(change.value) / 100, locale)}
                      </>
                    )}
                  </span>
                )}
              </span>
            </>
          );
          return figure.href ? (
            <TappableSurface key={figure.key} href={figure.href} chevron={false} className={cn(FIGURE_TILE, 'hover:bg-gray-100')}>
              {body}
            </TappableSurface>
          ) : (
            <div key={figure.key} className={FIGURE_TILE}>{body}</div>
          );
        })}
      </div>

      <div className="mt-4">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`${labels.spent} ${spentText}, ${labels.kept} ${keptText}`}>
          {hasIncome && <span className="grow-x h-full bg-danger-500/80 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${spentShare * 100}%` }} />}
          {keptShare > 0 && <span className="grow-x ml-0.5 h-full rounded-r-full transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${keptShare * 100}%`, backgroundColor: color }} />}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-danger-500/80" aria-hidden="true" />{labels.spent} · {spentText}</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />{labels.kept} · {keptText}</span>
          <span className="ml-auto tabular-nums">{labels.perDay}: <span className="font-semibold text-gray-950">{formatCurrency(now.averageDailyIncome)}</span> {currency}</span>
        </div>
      </div>
    </Card>
  );
}

/** Placeholder in the scorecard's shape: header and ring, three figures, the spent/kept bar and its legend. */
export function SideScorecardSkeleton() {
  return (
    <SkeletonCard>
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        <Skeleton className="h-5 w-28" />
        <Skeleton className="ml-auto h-14 w-14 shrink-0 rounded-full" />
      </div>
      <div className={FIGURE_GRID}>
        {[0, 1, 2].map((index) => (
          <div key={index} className={FIGURE_TILE}>
            <Skeleton className="h-3 w-14" />
            <div className="space-y-2 max-sm:flex max-sm:flex-col max-sm:items-end lg:max-xl:flex lg:max-xl:flex-col lg:max-xl:items-end sm:max-lg:mt-2 xl:mt-2">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-3 w-8 bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="mt-4 h-2.5 w-full rounded-full bg-gray-100" />
      <div className="mt-2 flex flex-wrap justify-between gap-3">
        <Skeleton className="h-3 w-20 bg-gray-100" />
        <Skeleton className="h-3 w-24 bg-gray-100" />
        <Skeleton className="h-3 w-28 bg-gray-100" />
      </div>
    </SkeletonCard>
  );
}
