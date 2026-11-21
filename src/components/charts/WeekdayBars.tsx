'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import type { WeekdayAverage } from '@/lib/calculations/insights';
import { colorWithAlpha, formatAxis } from '@/components/dashboard/ChartCard';
import { weekdayShortNames } from './chartFormat';

/**
 * Average per weekday as seven slim bars; the strongest weekday is drawn in
 * full colour and labelled, the rest recede. Each bar names its exact average.
 */
export function WeekdayBars({ data, color, currency, locale, averageLabel, className }: {
  data: readonly WeekdayAverage[];
  color: string;
  currency: string;
  locale: string;
  /** "Average {day}" style prefix for each bar's accessible name. */
  averageLabel: string;
  className?: string;
}) {
  const names = useMemo(() => weekdayShortNames(locale), [locale]);
  const max = Math.max(0, ...data.map((slot) => slot.average));
  const bestIndex = max > 0 ? data.findIndex((slot) => slot.average === max) : -1;

  return (
    <div className={cn('flex h-28 items-end gap-1.5', className)}>
      {data.map((slot, index) => {
        const height = max > 0 ? Math.max(4, (slot.average / max) * 100) : 4;
        const best = index === bestIndex;
        const label = `${averageLabel} · ${names[slot.weekday]}: ${formatCurrency(Math.round(slot.average))} ${currency}`;
        return (
          <div key={slot.weekday} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={label}>
            <span className={cn('whitespace-nowrap text-xs font-semibold tabular-nums text-gray-950 transition-opacity motion-reduce:transition-none', best ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>
              {formatAxis(slot.average, locale)}
            </span>
            <span
              role="img"
              aria-label={label}
              className="w-full max-w-7 rounded-b-sm rounded-t transition-[height] duration-500 motion-reduce:transition-none"
              style={{ height: `${height}%`, backgroundColor: best ? color : colorWithAlpha(color, 0.38) }}
            />
            <span className={cn('text-xs font-medium', best ? 'text-gray-950' : 'text-gray-500')}>{names[slot.weekday]}</span>
          </div>
        );
      })}
    </div>
  );
}
