import { MetricGridSkeleton, Skeleton, TableSkeleton } from '@/components/PresentationFoundation';
import { SkeletonCard } from '@/components/charts/ChartSkeletons';
import { StockGlanceSkeleton } from './StockGlance';

/**
 * Closing stock while the day loads: the KPI strip, the stock glance, then the
 * products card with its search, category chips and count table. Keep it in
 * step with ClosingStockPage.
 */
export function ClosingStockSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <MetricGridSkeleton count={8} className="grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8" />
      <StockGlanceSkeleton />
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-9 w-full rounded-lg md:w-72" />
        </div>
        <div className="flex gap-2 overflow-hidden border-b border-gray-100 px-4 py-3 sm:px-5">
          {[16, 24, 20, 28, 20].map((width, index) => <Skeleton key={index} className="h-8 shrink-0 rounded-full bg-gray-100" style={{ width: `${width * 4}px` }} />)}
        </div>
        <TableSkeleton rows={8} columns={10} className="rounded-none border-0 shadow-none" />
      </SkeletonCard>
    </div>
  );
}
