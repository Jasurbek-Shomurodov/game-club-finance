import { FormSkeleton, Skeleton } from '@/components/PresentationFoundation';
import { HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { DailyCashMonthGlanceSkeleton } from './DailyCashMonthGlance';

/**
 * Daily cash while the day loads: the entry form beside the day's summary
 * tiles, then the month at a glance. Keep it in step with DailyCashPage.
 */
export function DailyCashSkeleton({ showSummary = true, showMonth = true }: { showSummary?: boolean; showMonth?: boolean }) {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] xl:items-start">
        <FormSkeleton />
        {showSummary && (
          <SkeletonCard>
            <HeadingSkeleton />
            <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
              {[0, 1, 2].map((index) => <Skeleton key={index} className="h-16 rounded-xl bg-gray-100" />)}
            </div>
          </SkeletonCard>
        )}
      </div>
      {showMonth && <DailyCashMonthGlanceSkeleton />}
    </div>
  );
}
