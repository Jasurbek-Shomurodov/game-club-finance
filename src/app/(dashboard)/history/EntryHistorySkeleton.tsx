import { Skeleton } from '@/components/PresentationFoundation';
import { SkeletonCard } from '@/components/charts/ChartSkeletons';

/** The change log itself: one card per edit or deletion. */
export function EntryHistoryListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <SkeletonCard key={index} className="space-y-3 !p-3 sm:!p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24 bg-gray-100" />
            <Skeleton className="ml-auto h-4 w-24 bg-gray-100" />
          </div>
          <Skeleton className="h-3 w-72 max-w-full bg-gray-100" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full bg-gray-100" />
            <Skeleton className="h-4 w-4/5 bg-gray-100" />
          </div>
        </SkeletonCard>
      ))}
    </div>
  );
}

/**
 * Entry history while the route loads: the two filters over the change log.
 * Keep it in step with EntryHistoryPage.
 */
export function EntryHistorySkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        {[0, 1].map((index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-24 bg-gray-100" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
      </div>
      <EntryHistoryListSkeleton />
    </div>
  );
}
