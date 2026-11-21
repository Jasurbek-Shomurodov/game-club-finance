import { ChartSkeleton, Skeleton } from '@/components/PresentationFoundation';
import { DonutCardSkeleton, HeadingSkeleton, InOutChartSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';

/**
 * The reserve overview while it loads: what it holds now (sums, dollars, the
 * three totals and the split bar), the balance chart beside the spending
 * donut, then money in and out. Keep it in step with ReservePage.
 */
export function ReserveOverviewSkeleton({ withSwitch = false }: { withSwitch?: boolean }) {
  return (
    <div className="space-y-6" aria-hidden="true">
      {withSwitch && <Skeleton className="h-10 w-72 max-w-full rounded-xl" />}
      <div className="space-y-3">
      <Skeleton className="h-3 w-28" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((index) => (
          <SkeletonCard key={index} className="space-y-3">
            <Skeleton className="h-4 w-24 bg-gray-100" />
            <Skeleton className="h-8 w-48 max-w-full" />
          </SkeletonCard>
        ))}
      </div>
      <SkeletonCard>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg bg-gray-100" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="space-y-2 rounded-xl bg-gray-50 p-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-28" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-4 h-2.5 w-full rounded-full bg-gray-100" />
        <div className="mt-2 flex gap-5">
          <Skeleton className="h-3 w-28 bg-gray-100" />
          <Skeleton className="h-3 w-20 bg-gray-100" />
        </div>
      </SkeletonCard>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartSkeleton />
        <DonutCardSkeleton />
      </div>
      <SkeletonCard>
        <HeadingSkeleton />
        <InOutChartSkeleton className="mt-4" height={256} />
      </SkeletonCard>
    </div>
  );
}

/** The reserve history while it loads: the kind filter over days of entries. Keep it in step with ReserveHistoryList. */
export function ReserveHistorySkeleton() {
  return (
    <div className="max-w-4xl space-y-3" aria-hidden="true">
      <Skeleton className="h-9 w-80 max-w-full rounded-xl" />
      <SkeletonCard padded={false} className="overflow-hidden">
        {[0, 1].map((day) => (
          <div key={day} className="border-b border-gray-100 last:border-b-0">
            <div className="flex items-center justify-between gap-3 bg-gray-50 px-4 py-2.5 sm:px-5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3 border-t border-gray-100 px-4 py-3 sm:px-5">
                <Skeleton className="h-9 w-9 shrink-0 rounded-xl bg-gray-100" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-3 w-24 bg-gray-100" />
                </div>
                <Skeleton className="h-5 w-24 shrink-0" />
              </div>
            ))}
          </div>
        ))}
      </SkeletonCard>
    </div>
  );
}
