import { Skeleton } from '@/components/PresentationFoundation';
import { HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';

/**
 * Team while it loads: the members card (heading, role filter, search, one
 * row per member) and the access card under it. Keep it in step with
 * TeamPageClient.
 */
export function TeamSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="space-y-4 border-b border-gray-100 px-4 py-4 sm:px-5">
          <HeadingSkeleton />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-9 w-full rounded-lg bg-gray-100 sm:w-72" />
            <Skeleton className="h-9 w-full rounded-lg sm:w-64" />
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-3.5 lg:grid-cols-[minmax(0,1.3fr)_110px_minmax(0,1.5fr)_auto]">
              <div className="flex min-w-0 items-center gap-3">
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-36 max-w-full" />
                  <Skeleton className="h-3 w-44 max-w-full bg-gray-100" />
                </div>
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="hidden h-3 w-4/5 bg-gray-100 lg:block" />
              <Skeleton className="hidden h-8 w-8 rounded-lg bg-gray-100 lg:block" />
            </div>
          ))}
        </div>
      </SkeletonCard>
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
          <HeadingSkeleton />
        </div>
        {[0, 1].map((index) => (
          <div key={index} className="grid items-center gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:gap-5">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-56 max-w-full bg-gray-100" />
            <Skeleton className="h-8 w-24 rounded-lg bg-gray-100" />
          </div>
        ))}
      </SkeletonCard>
    </div>
  );
}
