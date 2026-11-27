'use client';

import type { ReactNode } from 'react';
import { Minus, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { RollingText, Skeleton, metricToneClassName, type MetricTone } from '@/components/PresentationFoundation';
import type { HeadlineChange } from '@/lib/calculations/chartHeadline';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { formatPercentShare } from './chartFormat';

const MINUS = '−';

/**
 * The change line as text and meaning: `+1 200 000 · +12%`, green when it is
 * good news, red when it is bad, grey when nothing moved. A rise is good news
 * unless `risingIsBad` (a cost, a debt).
 */
export function headlineChangeParts(change: HeadlineChange, locale: string, risingIsBad = false): { text: string; tone: MetricTone; icon: LucideIcon } {
  const sign = change.amount > 0 ? '+' : change.amount < 0 ? MINUS : '';
  const amount = `${sign}${formatCurrency(Math.abs(change.amount))}`;
  const percent = change.percent === null || change.amount === 0
    ? null
    : `${sign}${formatPercentShare(Math.abs(change.percent), locale, 1)}`;
  if (change.amount === 0) return { text: amount, tone: 'muted', icon: Minus };
  const good = change.amount > 0 !== risingIsBad;
  return {
    text: percent ? `${amount} · ${percent}` : amount,
    tone: good ? 'success' : 'danger',
    icon: change.amount > 0 ? TrendingUp : TrendingDown,
  };
}

export interface ChartHeadlineProps {
  /** What the figure is ("Total for the period", "Latest balance"). */
  label?: string;
  /** The figure, already formatted (the caller chooses: a period total, or a running series' latest value). */
  figure: string;
  /** Shown small after the figure, usually the currency. */
  unit?: string;
  /** How the series moved over the period; no change line without it. */
  change?: HeadlineChange | null;
  /** Says what the change covers; defaults to "Change in period". */
  changeLabel?: string;
  risingIsBad?: boolean;
  locale: string;
  /** A note under the change line. */
  caption?: ReactNode;
  className?: string;
}

/**
 * The figure over a chart, as a banking app shows it: the big number rolls to
 * its value, and under it how much it moved in the period shown, with a trend
 * arrow in the tone of the news.
 */
export function ChartHeadline({ label, figure, unit, change, changeLabel, risingIsBad = false, locale, caption, className }: ChartHeadlineProps) {
  const t = useTranslations('charts');
  const parts = change ? headlineChangeParts(change, locale, risingIsBad) : null;
  const Icon = parts?.icon;
  return (
    <div className={cn('min-w-0', className)}>
      {label && <p className="text-xs font-medium text-gray-500">{label}</p>}
      <p className={cn('break-words text-2xl font-bold leading-tight tracking-tight tabular-nums sm:text-3xl', metricToneClassName.default)}>
        <RollingText text={figure} />
        {unit && <span className="ml-1.5 text-sm font-medium tracking-normal text-gray-500">{unit}</span>}
      </p>
      {parts && Icon && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className={cn('inline-flex items-center gap-1 font-semibold tabular-nums', metricToneClassName[parts.tone])}>
            <Icon size={14} aria-hidden="true" />
            {parts.text}
          </span>
          <span className="text-gray-500">{changeLabel ?? t('changeInPeriod')}</span>
        </p>
      )}
      {caption && <div className="mt-1 text-xs text-gray-500">{caption}</div>}
    </div>
  );
}

/** `ChartHeadline`'s footprint: label, figure, change line. */
export function ChartHeadlineSkeleton({ label = true, change = true, className }: { label?: boolean; change?: boolean; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('min-w-0 space-y-2', className)}>
      {label && <Skeleton className="h-3 w-24 bg-gray-100" />}
      <Skeleton className="h-8 w-44 max-w-full sm:h-9" />
      {change && <Skeleton className="h-3 w-40 max-w-full bg-gray-100" />}
    </div>
  );
}
