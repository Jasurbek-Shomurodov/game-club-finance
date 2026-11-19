import { MetricGridSkeleton, Skeleton, TableSkeleton, metricGridClassName } from '@/components/PresentationFoundation';
import { SkeletonCard } from '@/components/charts/ChartSkeletons';
import { cn } from '@/lib/utils';

/**
 * The daily report while it loads: ten figures, the cash entry tiles, the
 * stock table and the expenses list. Keep it in step with DailyReportPage.
 */
export function DailyReportSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <MetricGridSkeleton count={10} className={cn(metricGridClassName, 'sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 xl:grid-cols-4')} />
      <SkeletonCard>
        <Skeleton className="h-4 w-32" />
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-16 rounded-xl bg-gray-100" />)}
        </div>
      </SkeletonCard>
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
          <Skeleton className="h-4 w-36" />
        </div>
        <TableSkeleton rows={4} columns={5} className="rounded-none border-0 shadow-none" />
      </SkeletonCard>
      <SkeletonCard>
        <Skeleton className="h-4 w-28" />
        <div className="mt-3 space-y-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-40 max-w-full bg-gray-100" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </SkeletonCard>
    </div>
  );
}
