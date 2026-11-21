import { MetricGridSkeleton, Skeleton, TableSkeleton, metricGridClassName } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';

/**
 * Products while they load: the recent-sales heading over four figures, then the
 * list card with its actions, search, filter chips and table. Keep it in step
 * with the products page.
 */
/** The recent-sales figures: their heading over four metric cards. Also stands in while the sales read is still on its way. */
export function ProductSalesSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <HeadingSkeleton />
      <MetricGridSkeleton count={4} className={cn(metricGridClassName, 'lg:grid-cols-4')} />
    </div>
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
