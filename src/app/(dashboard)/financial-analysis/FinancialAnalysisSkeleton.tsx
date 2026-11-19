import { ChartSkeleton, Skeleton } from '@/components/PresentationFoundation';
import { SideScorecardSkeleton } from '@/components/financial-analysis/AnalysisSections';

/**
 * Financial analysis while it loads: the two side scorecards, the planned
 * expenses block and the money flow chart. Keep it in step with the page.
 */
export function FinancialAnalysisSkeleton() {
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

/** What sits under the scorecards: section headings over a plan card and a chart. */
export function AnalysisBodySkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="space-y-3">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-3 w-96 max-w-full bg-gray-100" />
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-gray-200 bg-surface p-4 shadow-card sm:p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-14 w-full rounded-xl bg-gray-100" />
            {[0, 1, 2].map((index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-1.5 w-full rounded-full bg-gray-100" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <ChartSkeleton />
      </div>
    </div>
  );
}
