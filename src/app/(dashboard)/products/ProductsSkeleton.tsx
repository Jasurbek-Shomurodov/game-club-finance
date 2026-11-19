import { Skeleton, TableSkeleton } from '@/components/PresentationFoundation';
import { HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';

/**
 * Products while they load: the recent-sales card with four tiles, then the
 * list card with its actions, search, filter chips and table. Keep it in step
 * with the products page.
 */
export function ProductsSkeleton({ columns = 7 }: { columns?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      <SkeletonCard>
        <HeadingSkeleton />
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-16 rounded-xl bg-gray-100" />)}
        </div>
      </SkeletonCard>
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="space-y-4 border-b border-gray-100 px-4 py-4 sm:px-5">
          <HeadingSkeleton action />
          <Skeleton className="h-9 w-full rounded-lg md:w-80" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex gap-2 overflow-hidden">
              {[20, 24, 16, 28].map((width, index) => <Skeleton key={index} className="h-8 shrink-0 rounded-full bg-gray-100" style={{ width: `${width * 4}px` }} />)}
            </div>
          ))}
        </div>
        <TableSkeleton rows={8} columns={columns} className="rounded-none border-0 shadow-none" />
      </SkeletonCard>
    </div>
  );
}
