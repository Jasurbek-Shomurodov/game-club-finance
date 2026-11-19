import { Skeleton } from '@/components/PresentationFoundation';
import { SkeletonCard } from '@/components/charts/ChartSkeletons';

const DAY_BARS = [40, 65, 30, 80, 55, 90, 45, 70, 35, 60, 85, 50, 75, 40];

/**
 * Money details while the period loads (game club and bar share it): the
 * money-left card beside collected and deductions, the day-by-day bars, then
 * one collapsed card per day. Keep it in step with MoneyDetailsPage.
 */
export function MoneyDetailsSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6" aria-hidden="true">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <SkeletonCard className="sm:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-44 max-w-full bg-gray-100" />
            </div>
          </div>
          <Skeleton className="mt-4 h-10 w-64 max-w-full" />
          <Skeleton className="mt-4 h-2 w-full rounded-full bg-gray-100" />
        </SkeletonCard>
        {[0, 1].map((index) => (
          <SkeletonCard key={index}>
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-8 w-8 rounded-lg bg-gray-100" />
            </div>
            <Skeleton className="mt-3 h-8 w-40 max-w-full" />
            <Skeleton className="mt-5 h-3 w-36 max-w-full bg-gray-100" />
          </SkeletonCard>
        ))}
      </div>
      <SkeletonCard>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-56 max-w-full bg-gray-100" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-11 w-36 rounded-xl bg-gray-100" />
            <Skeleton className="h-11 w-36 rounded-xl bg-gray-100" />
          </div>
        </div>
        <div className="mt-4 flex h-40 items-end gap-1.5">
          {DAY_BARS.map((height, index) => <Skeleton key={index} className="flex-1 rounded-b-none rounded-t bg-gray-100" style={{ height: `${height}%` }} />)}
        </div>
      </SkeletonCard>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-28 rounded-lg bg-gray-100" />
        </div>
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonCard key={index}>
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 shrink-0 rounded-xl bg-gray-100" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48 max-w-full bg-gray-100" />
              </div>
              <Skeleton className="h-6 w-28" />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </div>
  );
}
