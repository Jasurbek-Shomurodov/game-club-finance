import { Skeleton } from '@/components/PresentationFoundation';
import { DonutCardSkeleton, HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { AnalysisChartCardSkeleton } from '@/components/financial-analysis/AnalysisChartCardSkeleton';
import { SideScorecardSkeleton } from '@/components/financial-analysis/AnalysisSections';
import { OverallAnalysisSkeleton } from '@/components/financial-analysis/OverallSkeleton';
import { MoneyChecksPanelSkeleton } from '@/components/financial-analysis/MoneyChecksPanel';

/**
 * Financial analysis while it loads. The monthly view: the two side scorecards
 * over the "Worth a look" checks and the money flow, trends and details sections. The overall view has its
 * own shape (`OverallAnalysisSkeleton`). Keep both in step with the page.
 */
export function FinancialAnalysisSkeleton({ view = 'monthly' }: { view?: 'monthly' | 'overall' }) {
  if (view === 'overall') return <OverallAnalysisSkeleton />;
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="grid gap-3 lg:grid-cols-2">
        <SideScorecardSkeleton />
        <SideScorecardSkeleton />
      </div>
      <AnalysisBodySkeleton />
    </div>
  );
}

/** A card holding a list: heading, then rows of a label and an amount. */
function ListCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <SkeletonCard>
      <HeadingSkeleton />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="space-y-1.5">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-3 w-32 max-w-full" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-2 w-full rounded-full bg-gray-100" />
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

/** One side's money-flow card: heading over the Sankey. */
function FlowCardSkeleton() {
  return (
    <SkeletonCard>
      <HeadingSkeleton />
      <Skeleton className="mt-4 h-64 w-full rounded-xl bg-gray-100" />
    </SkeletonCard>
  );
}

/**
 * What sits under the scorecards: the "Worth a look" checks, the money flow (two flow cards, then the
 * category donut beside the comparison), the three trend charts (daily and
 * monthly with each side's headline figure, PlayStation with its own three
 * figures) and the two detail lists. The planned-expenses block is optional, so it has no placeholder.
 */
export function AnalysisBodySkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <MoneyChecksPanelSkeleton />
      <div className="space-y-3">
        <HeadingSkeleton />
        <FlowCardSkeleton />
        <FlowCardSkeleton />
        <div className="grid gap-4 lg:grid-cols-2">
          <DonutCardSkeleton rows={5} />
          <ListCardSkeleton />
        </div>
      </div>
      <div className="space-y-3">
        <HeadingSkeleton />
        <AnalysisChartCardSkeleton headlines={2} pills={5} height={288} />
        <AnalysisChartCardSkeleton height={256}>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="space-y-1.5">
                <Skeleton className="h-3 w-24 bg-gray-100" />
                <Skeleton className="h-5 w-28" />
              </div>
            ))}
          </div>
        </AnalysisChartCardSkeleton>
        <AnalysisChartCardSkeleton headlines={2} pills={4} height={288} />
      </div>
      <div className="space-y-3">
        <HeadingSkeleton description={false} />
        <div className="grid gap-4 lg:grid-cols-2">
          <ListCardSkeleton />
          <ListCardSkeleton rows={3} />
        </div>
      </div>
    </div>
  );
}
