import type { ReactNode } from 'react';
import { Skeleton } from '@/components/PresentationFoundation';
import { ChartHeadlineSkeleton } from '@/components/charts/ChartHeadline';
import { HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';

/**
 * `AnalysisChartCard` while it loads: heading with the full-screen button,
 * `headlines` figures side by side (none where the card has its own stats,
 * passed as `children`), the legend pills and the plot.
 */
export function AnalysisChartCardSkeleton({ headlines = 0, change = false, pills = 2, height = 256, className, children }: {
  headlines?: number;
  /** The headlines carry a change line. */
  change?: boolean;
  pills?: number;
  /** The plot's height in pixels. */
  height?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <SkeletonCard className={className}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <HeadingSkeleton />
          {headlines > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-8 gap-y-3">
              {Array.from({ length: headlines }, (_, index) => <ChartHeadlineSkeleton key={index} change={change} />)}
            </div>
          )}
        </div>
        <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
      </div>
      {children}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Array.from({ length: pills }, (_, index) => <Skeleton key={index} className="h-10 w-28 rounded-full sm:h-9" />)}
      </div>
      <Skeleton className="mt-3 w-full rounded-xl bg-gray-100" style={{ height }} />
    </SkeletonCard>
  );
}
