import { Skeleton, TableSkeleton } from '@/components/PresentationFoundation';
import { HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';

/**
 * Products while they load: the recent-sales card with four tiles, then the
 * list card with its actions, search, filter chips and table. Keep it in step
 * with the products page.
 */
/** The recent-sales card: its heading over four tiles. Also stands in while the sales read is still on its way. */
export function ProductSalesSkeleton() {
  return (
    <SkeletonCard>
      <HeadingSkeleton />
      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-16 rounded-xl bg-gray-100" />)}
      </div>
    </SkeletonCard>
  );
}

export function ProductsSkeleton({ columns = 7 }: { columns?: number }) {
  return (
    <div className="space-y-5" aria-hidden="true">
      <ProductSalesSkeleton />
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
        <TableSkeleton bare rows={8} columns={columns} />
      </SkeletonCard>
    </div>
  );
}
