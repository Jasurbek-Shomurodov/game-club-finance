import { Skeleton } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { HeadingSkeleton, InOutChartCardSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';

/** A section heading over a pair of chart cards, the unit the overall view repeats. */
function ChartPairSkeleton() {
  return (
    <div className="space-y-3">
      <HeadingSkeleton />
      <div className="grid gap-4 xl:grid-cols-2">
        <InOutChartCardSkeleton />
        <InOutChartCardSkeleton />
      </div>
    </div>
  );
}

/** What the overall view shows under its summary while the history loads: forecast, profit by month, reports. */
export function OverallBodySkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <ChartPairSkeleton />
      <ChartPairSkeleton />
      <ChartPairSkeleton />
    </div>
  );
}

/** One side's all-time summary card: the margin ring beside its three figures. */
function SideSummarySkeleton() {
  return (
    <SkeletonCard>
      <HeadingSkeleton description={false} />
      <div className="mt-4 flex items-center gap-6">
        <Skeleton className="h-28 w-28 shrink-0 rounded-full sm:h-32 sm:w-32" />
        <div className="flex-1 space-y-3"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      </div>
    </SkeletonCard>
  );
}

/** The whole overall view before it arrives: section chips, the two side summaries, then the chart sections. */
export function OverallAnalysisSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="flex gap-2 overflow-hidden py-2">
        {['w-20', 'w-24', 'w-28', 'w-20', 'w-24', 'w-28'].map((width, index) => (
          <Skeleton key={index} className={cn('h-10 shrink-0 rounded-full sm:h-9', width)} />
        ))}
      </div>
      <div className="space-y-3">
        <HeadingSkeleton />
        <div className="grid gap-4 lg:grid-cols-2">
          <SideSummarySkeleton />
          <SideSummarySkeleton />
        </div>
      </div>
      <OverallBodySkeleton />
    </div>
  );
}
