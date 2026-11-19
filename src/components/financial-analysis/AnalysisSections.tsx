'use client';

import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  HelpButton,
  Skeleton,
  metricToneClassName,
  toneForAmount,
  type MetricTone,
  TappableSurface,
} from '@/components/PresentationFoundation';
import type { SourceIndicators } from '@/lib/calculations/financialAnalysis';
import { formatCurrency } from '@/lib/formatters';
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
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex items-center gap-1">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-950">
              {Icon && <Icon size={18} className={cn('shrink-0', iconClassName)} aria-hidden="true" />}
              {title}
            </h2>
            {help && <HelpButton title={title} body={help} className="-my-1.5" />}
          </div>
          {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * One side's month on one card: money in, spent and profit with their change,
 * a bar splitting the income into what was spent and what was kept, the
 * margin ring and the daily average. The game club and the bar each get one;
 * the two are never added together.
 */
export function SideScorecard({ title, icon: Icon, iconClassName, color, incomeLabel, now, before, compare, loading, currency, locale, detailsHref, spentHref, labels }: {
  title: string;
  icon: LucideIcon;
  iconClassName: string;
  color: string;
  incomeLabel: string;
  now: SourceIndicators;
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
  const figures: Array<{ key: string; label: string; amount: number; tone: MetricTone; href?: string; goodWhen: 'up' | 'down'; previous?: number }> = [
    { key: 'in', label: incomeLabel, amount: now.income, tone: 'default', href: detailsHref, goodWhen: 'up', previous: before?.income },
    { key: 'spent', label: labels.spent, amount: now.spent, tone: 'danger', href: spentHref, goodWhen: 'down', previous: before?.spent },
    { key: 'profit', label: labels.profit, amount: now.left, tone: toneForAmount(now.left), href: detailsHref, goodWhen: 'up', previous: before?.left },
  ];
  return (
    <section aria-label={title} className="min-w-0 rounded-2xl border border-gray-200 bg-surface p-4 shadow-card sm:p-5">
      <header className="flex items-center gap-3">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100', iconClassName)} aria-hidden="true">
          <Icon size={18} strokeWidth={2.2} />
        </span>
        <h2 className="min-w-0 flex-1 text-base font-semibold tracking-tight text-gray-950">{title}</h2>
        <RadialMeter value={margin} color={margin !== null && margin < 0 ? 'rgb(var(--c-danger-500))' : color} size={52} stroke={6} label={`${labels.margin}: ${marginText}`}>
          <span className="text-[11px] font-bold tabular-nums text-gray-950">{marginText}</span>
        </RadialMeter>
      </header>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {figures.map((figure) => {
          const change = compare && figure.previous !== undefined ? compare(figure.amount, figure.previous) : null;
          const good = change?.value !== null && change?.value !== undefined
            ? (figure.goodWhen === 'up' ? change.value >= 0 : change.value <= 0)
            : null;
          const body = (
            <>
              <span className="block truncate text-[11px] font-medium text-gray-500">{figure.label}</span>
              <span className={cn('mt-1 block truncate text-base font-bold tabular-nums tracking-tight sm:text-lg', metricToneClassName[figure.tone])}>
                {formatCurrency(figure.amount)}
              </span>
              {change && (
                <span className={cn('mt-0.5 flex items-center gap-0.5 text-[11px] font-semibold tabular-nums', good === null ? 'text-gray-400' : good ? 'text-success-600' : 'text-danger-600')} title={change.label}>
                  {change.value === null ? '—' : (
                    <>
                      {change.value >= 0 ? <ArrowUpRight size={12} aria-hidden="true" /> : <ArrowDownRight size={12} aria-hidden="true" />}
                      {/* The sign is text, so the direction does not rest on the arrow and colour alone. */}
                      {change.value >= 0 ? '+' : '−'}{formatPercentShare(Math.abs(change.value) / 100, locale)}
                    </>
                  )}
                </span>
              )}
            </>
          );
          const className = 'min-w-0 rounded-xl bg-gray-50 px-3 py-2.5';
          return figure.href ? (
            <TappableSurface key={figure.key} href={figure.href} chevron={false} className={cn(className, 'hover:bg-gray-100')}>
              {body}
            </TappableSurface>
          ) : (
            <div key={figure.key} className={className}>{body}</div>
          );
        })}
      </div>

      <div className="mt-4">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100" role="img" aria-label={`${labels.spent} ${spentText}, ${labels.kept} ${keptText}`}>
          {hasIncome && <span className="grow-x h-full bg-danger-500/80 transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${spentShare * 100}%` }} />}
          {keptShare > 0 && <span className="grow-x ml-0.5 h-full rounded-r-full transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${keptShare * 100}%`, backgroundColor: color }} />}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-gray-500">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-danger-500/80" aria-hidden="true" />{labels.spent} · {spentText}</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />{labels.kept} · {keptText}</span>
          <span className="ml-auto tabular-nums">{labels.perDay}: <span className="font-semibold text-gray-950">{formatCurrency(now.averageDailyIncome)}</span> {currency}</span>
        </div>
      </div>
    </section>
  );
}

/** Placeholder in the scorecard's shape: header and ring, three figures, the spent/kept bar and its legend. */
export function SideScorecardSkeleton() {
  return (
    <div aria-hidden="true" className="min-w-0 rounded-2xl border border-gray-200 bg-surface p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        <Skeleton className="h-5 w-28" />
        <Skeleton className="ml-auto h-[52px] w-[52px] shrink-0 rounded-full" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[0, 1, 2].map((index) => (
          <div key={index} className="space-y-2 rounded-xl bg-gray-50 px-3 py-2.5">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-3 w-8 bg-gray-100" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-4 h-2.5 w-full rounded-full bg-gray-100" />
      <div className="mt-2 flex justify-between gap-3">
        <Skeleton className="h-3 w-20 bg-gray-100" />
        <Skeleton className="h-3 w-24 bg-gray-100" />
        <Skeleton className="h-3 w-28 bg-gray-100" />
      </div>
    </div>
  );
}
