import { Skeleton } from '@/components/PresentationFoundation';
import { HeadingSkeleton, InOutChartSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';

/**
 * Money details while the period loads (game club and bar share it): the
 * money-left card beside collected and deductions, the day-by-day card (three
 * stat tiles over the in/out chart), then one collapsed card per day. Keep it
 * in step with MoneyDetailsPage.
 */
export function MoneyDetailsSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6" aria-hidden="true">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <SkeletonCard key={index} className={index === 0 ? 'sm:col-span-2 lg:col-span-1' : undefined}>
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-7 shrink-0 rounded-lg bg-gray-100" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="mt-3 h-7 w-40 max-w-full" />
            <Skeleton className="mt-3 h-3 w-36 max-w-full bg-gray-100" />
            {index === 0 && <Skeleton className="mt-3 h-1.5 w-full rounded-full bg-gray-100" />}
          </SkeletonCard>
        ))}
      </div>
      <SkeletonCard>
        <HeadingSkeleton />
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {[0, 1, 2].map((index) => <Skeleton key={index} className="h-16 rounded-xl bg-gray-100" />)}
        </div>
        <InOutChartSkeleton className="mt-4" height={200} />
      </SkeletonCard>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-28 rounded-lg bg-gray-100" />
        </div>
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonCard key={index} padded={false} className="px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 shrink-0 rounded-xl bg-gray-100" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48 max-w-full bg-gray-100" />
              </div>
              <Skeleton className="h-5 w-28" />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}
