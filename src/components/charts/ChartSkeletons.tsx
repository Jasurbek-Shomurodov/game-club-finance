import type { ReactNode } from 'react';
import { Skeleton } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';

/**
 * Small placeholder parts shared by the page skeletons and the at-a-glance
 * panels: each has the footprint of the chart or block it stands in for.
 * All are hidden from screen readers; wrap the page in `SkeletonStatus`.
 */

/** The `Card` shell (default tone, `md` padding) with nothing in it. */
export function SkeletonCard({ className, padded = true, padding = 'md', children }: {
  className?: string;
  padded?: boolean;
  /** Matches `Card padding`: `sm` for a card that uses `padding="sm"`. */
  padding?: 'sm' | 'md';
  children?: ReactNode;
}) {
  return (
    <div aria-hidden="true" className={cn('min-w-0 rounded-2xl border border-gray-200 bg-surface shadow-card', padded && (padding === 'sm' ? 'p-3 sm:p-4' : 'p-4 sm:p-5'), className)}>
      {children}
    </div>
  );
}

/** A section or chart-card heading: title, with an optional description line and action. */
export function HeadingSkeleton({ description = true, action = false, className }: { description?: boolean; action?: boolean; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-40 max-w-full" />
        {description && <Skeleton className="h-3 w-64 max-w-full bg-gray-100" />}
      </div>
      {action && <Skeleton className="h-8 w-28 shrink-0 rounded-lg" />}
    </div>
  );
}

/** One `GlanceStat`: label, bold figure, hint. */
export function GlanceStatSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('min-w-0 space-y-1.5', className)}>
      <Skeleton className="h-3 w-20 max-w-full bg-gray-100" />
      <Skeleton className="h-6 w-28 max-w-full" />
      <Skeleton className="h-3 w-24 max-w-full bg-gray-100" />
    </div>
  );
}

/** `DonutBreakdown`: the ring above (phones) or beside its ranked rows; `stacked` keeps the rows under it (`rowFrom="never"`). */
export function DonutSkeleton({ rows = 4, size = 'sm', stacked = false, className }: { rows?: number; size?: 'sm' | 'md'; stacked?: boolean; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col items-center gap-4', !stacked && 'sm:flex-row sm:items-center', className)}>
      <Skeleton className={cn('shrink-0 rounded-full bg-gray-100', size === 'sm' ? 'h-36 w-36' : 'h-44 w-44')} />
      <div className="w-full min-w-0 flex-1 space-y-1">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-2.5 px-2 py-1.5">
            <Skeleton className="h-2.5 w-2.5 shrink-0 rounded-sm" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex justify-between gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-1 w-full rounded-full bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const BAR_HEIGHTS = [45, 70, 55, 85, 60, 95, 50, 75, 65, 90, 40, 80];

/** `DailyInOutChart`: the two-key legend over paired bars of the given plot height. */
export function InOutChartSkeleton({ height = 220, bars = 12, className }: { height?: number; bars?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('space-y-3', className)}>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex items-end gap-2" style={{ height }}>
        {Array.from({ length: bars }, (_, index) => (
          <Skeleton
            key={index}
            className="flex-1 rounded-b-none rounded-t bg-gray-100"
            style={{ height: `${BAR_HEIGHTS[index % BAR_HEIGHTS.length]}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** A `ChartCard` holding a `DailyInOutChart`, with optional stats above it. */
export function InOutChartCardSkeleton({ height = 220, bars, action = false, children, className }: {
  height?: number;
  bars?: number;
  action?: boolean;
  /** Placeholders between the heading and the chart (stat rows, split bars). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <SkeletonCard className={className}>
      <HeadingSkeleton action={action} />
      {children}
      <InOutChartSkeleton className="mt-4" height={height} bars={bars} />
    </SkeletonCard>
  );
}

/** `BalanceFlowChart`: the two-key legend, the balance plot and the short in/out bars under it. */
export function BalanceFlowChartSkeleton({ balanceHeight = 200, flowHeight = 96, bars = 18, className }: { balanceHeight?: number; flowHeight?: number; bars?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('space-y-3', className)}>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div>
        <Skeleton className="w-full rounded-xl bg-gray-100" style={{ height: balanceHeight }} />
        <div className="flex items-end gap-1 pl-[60px]" style={{ height: flowHeight }}>
          {Array.from({ length: bars }, (_, index) => (
            <Skeleton
              key={index}
              className="flex-1 rounded-b-none rounded-t bg-gray-100"
              style={{ height: `${BAR_HEIGHTS[index % BAR_HEIGHTS.length] * 0.7}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** A card with a small heading over a `DonutBreakdown`. */
export function DonutCardSkeleton({ rows, description = true, stacked, className }: { rows?: number; description?: boolean; stacked?: boolean; className?: string }) {
  return (
    <SkeletonCard className={className}>
      <HeadingSkeleton description={description} />
      <DonutSkeleton className="mt-4" rows={rows} stacked={stacked} />
    </SkeletonCard>
  );
}

/** `CalendarHeatmap`: weekday initials over five weeks of day cells. */
export function CalendarSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('grid grid-cols-7 gap-1', className)}>
      {Array.from({ length: 7 }, (_, index) => <Skeleton key={`head-${index}`} className="mx-auto h-3 w-5 bg-gray-100" />)}
      {Array.from({ length: 35 }, (_, index) => <Skeleton key={index} className="h-9 bg-gray-100" />)}
    </div>
  );
}
