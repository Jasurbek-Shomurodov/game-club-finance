'use client';

import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import { colorWithAlpha } from '@/components/dashboard/ChartCard';
import { formatPercentShare } from './chartFormat';

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  /** Share of the donut's total, 0-1. */
  share: number;
  color: string;
  /** Opens the records behind the slice. */
  onSelect?: () => void;
}

/**
 * A donut with its total in the middle and a ranked legend beside it: every
 * slice is named with its amount and share, so colour never carries identity
 * alone. Hovering a slice or a legend row spotlights the other.
 */
export function DonutBreakdown({ slices, total, totalLabel, currency, locale, size = 'md', rowFrom = 'sm', formatShare }: {
  slices: readonly DonutSlice[];
  total: number;
  totalLabel: string;
  currency: string;
  locale: string;
  size?: 'sm' | 'md';
  /** Where the legend moves beside the ring; `xl` for a donut in a half-width card. */
  rowFrom?: 'sm' | 'xl';
  /** How a 0-1 share is written; whole percents in the app language by default. */
  formatShare?: (share: number) => string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const activeSlice = slices.find((slice) => slice.key === active) ?? null;
  const diameter = size === 'sm' ? 'h-36 w-36' : 'h-44 w-44';
  const shareText = (share: number) => (formatShare ? formatShare(share) : formatPercentShare(share, locale));

  return (
    <div className={cn('flex flex-col items-center gap-4', rowFrom === 'xl' ? 'xl:flex-row xl:items-center' : 'sm:flex-row sm:items-center')}>
      <div className={cn('relative shrink-0', diameter)} onMouseLeave={() => setActive(null)}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices as DonutSlice[]}
              dataKey="value"
              nameKey="label"
              innerRadius="70%"
              outerRadius="100%"
              paddingAngle={slices.length > 1 ? 2 : 0}
              cornerRadius={4}
              stroke="none"
              isAnimationActive={false}
              onMouseEnter={(_, index) => setActive(slices[index]?.key ?? null)}
              onClick={(_, index) => slices[index]?.onSelect?.()}
            >
              {slices.map((slice) => (
                <Cell
                  key={slice.key}
                  fill={slice.color}
                  fillOpacity={active && active !== slice.key ? 0.25 : 1}
                  className={cn('outline-none transition-[fill-opacity] motion-reduce:transition-none', slice.onSelect && 'cursor-pointer')}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center" aria-live="polite">
          <span className="line-clamp-2 text-xs font-medium leading-4 text-gray-500">{activeSlice ? activeSlice.label : totalLabel}</span>
          <span className="mt-0.5 text-base font-bold tabular-nums tracking-tight text-gray-950">
            {formatCurrency(activeSlice ? activeSlice.value : total)}
          </span>
          <span className="text-xs text-gray-500">
            {activeSlice ? shareText(activeSlice.share) : currency}
          </span>
        </div>
      </div>

      <ul className="w-full min-w-0 flex-1 space-y-1" onMouseLeave={() => setActive(null)}>
        {slices.map((slice) => {
          const row = (
            <>
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: slice.color }} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium text-gray-700">{slice.label}</span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-950">{formatCurrency(slice.value)}</span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <span
                      className="grow-x block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                      style={{ width: `${Math.max(2, slice.share * 100)}%`, backgroundColor: colorWithAlpha(slice.color, 0.85) }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right text-xs tabular-nums text-gray-500">{shareText(slice.share)}</span>
                </span>
              </span>
              {slice.onSelect && <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-gray-400" />}
            </>
          );
          const rowClass = cn(
            'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
            active && active !== slice.key && 'opacity-50',
          );
          return (
            <li key={slice.key} onMouseEnter={() => setActive(slice.key)}>
              {slice.onSelect ? (
                <button
                  type="button"
                  onClick={slice.onSelect}
                  onFocus={() => setActive(slice.key)}
                  onBlur={() => setActive(null)}
                  aria-label={`${slice.label}: ${formatCurrency(slice.value)} ${currency}, ${shareText(slice.share)}`}
                  className={cn(rowClass, 'hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500')}
                >
                  {row}
                </button>
              ) : (
                <div className={rowClass}>{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
