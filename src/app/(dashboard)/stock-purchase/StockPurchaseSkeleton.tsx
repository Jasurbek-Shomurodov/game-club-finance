import { Skeleton, TableSkeleton } from '@/components/PresentationFoundation';
import { SkeletonCard } from '@/components/charts/ChartSkeletons';

/**
 * Stock purchase while the route loads: the purchase form with its totals
 * strip, then the purchases card with search, filters and table. Keep it in
 * step with StockPurchasePage.
 */
export function StockPurchaseSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <SkeletonCard>
        <Skeleton className="mb-5 h-5 w-48" />
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-24 bg-gray-100" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
          <div className="space-y-2 md:col-span-2">
            <Skeleton className="h-3 w-24 bg-gray-100" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-1 gap-3 rounded-2xl border border-gray-200 bg-gray-50 p-3 sm:grid-cols-3 sm:p-4">
          {[0, 1, 2].map((index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-28" />
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Skeleton className="h-10 w-24 rounded-lg bg-gray-100" />
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
      </SkeletonCard>
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-9 w-full rounded-lg md:w-72" />
        </div>
        <div className="flex flex-wrap gap-2 border-b border-gray-100 px-4 py-3 sm:px-5">
          {[0, 1, 2].map((index) => <Skeleton key={index} className="h-10 w-full rounded-lg bg-gray-100 sm:w-44" />)}
        </div>
        <TableSkeleton rows={6} columns={8} className="rounded-none border-0 shadow-none" />
      </SkeletonCard>
    </div>
  );
}
