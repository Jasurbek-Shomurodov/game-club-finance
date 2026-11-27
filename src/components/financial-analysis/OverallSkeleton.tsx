import { Skeleton } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { AnalysisChartCardSkeleton } from './AnalysisChartCardSkeleton';

/** A card's row of stats (`ProfitStats`): two across on phones, four where they fit. */
function ProfitStatsSkeleton() {
  return (
    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:max-xl:grid-cols-4 2xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="space-y-1.5">
          <Skeleton className="h-3 w-20 max-w-full bg-gray-100" />
          <Skeleton className="h-4 w-24 max-w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * A section heading over a pair of chart cards, the unit the overall view
 * repeats: cards with their stats (the forecast, with PlayStation's card
 * across the row under the two sides, and profit by month) or with one
 * headline figure each (each side's money flow).
 */
function ChartPairSkeleton({ stats = false, headline = false, wide = false, pills }: {
  stats?: boolean;
  headline?: boolean;
  /** A third card across the full row under the pair (the forecast's PlayStation card). */
  wide?: boolean;
  pills: number;
}) {
  return (
    <div className="space-y-3">
      <HeadingSkeleton />
      <div className="grid gap-4 xl:grid-cols-2">
        {(wide ? [0, 1, 2] : [0, 1]).map((index) => (
          <AnalysisChartCardSkeleton key={index} className={index === 2 ? 'xl:col-span-2' : undefined} headlines={headline ? 1 : 0} pills={pills}>
            {stats && <ProfitStatsSkeleton />}
          </AnalysisChartCardSkeleton>
        ))}
      </div>
    </div>
  );
}

/** What the overall view shows under its summary while the history loads: forecast, profit by month, reports. */
export function OverallBodySkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <ChartPairSkeleton stats wide pills={3} />
      <ChartPairSkeleton stats pills={4} />
      <ChartPairSkeleton headline pills={3} />
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
