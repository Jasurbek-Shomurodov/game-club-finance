import { Skeleton, TableSkeleton } from '@/components/PresentationFoundation';
import { SkeletonCard } from '@/components/charts/ChartSkeletons';

/**
 * Stock purchase while the route loads: the purchase form with its totals
 * strip, then the purchases card with search, the period chips and three
 * filters, the spending tiles, the table and its paging footer. Keep it in
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
            <Skeleton className="h-11 w-full" />
          </div>
        </div>
        <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <Skeleton className="h-3 w-32" />
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-28" />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 flex justify-between gap-2">
          <Skeleton className="h-11 w-24 rounded-lg bg-gray-100" />
          <Skeleton className="h-11 w-40 rounded-lg" />
        </div>
        <Skeleton className="mt-4 h-4 w-32 bg-gray-100" />
      </SkeletonCard>
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 sm:px-5 md:flex-row md:items-center md:justify-between">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-9 w-full rounded-lg md:w-72" />
        </div>
        <div className="space-y-3 border-b border-gray-100 px-4 py-4 sm:px-5">
          <div className="flex gap-2 overflow-hidden">
            {['w-16', 'w-20', 'w-20', 'w-24'].map((width, index) => <Skeleton key={index} className={`h-9 shrink-0 rounded-full bg-gray-100 ${width}`} />)}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-3 w-20 bg-gray-100" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 border-b border-gray-100 px-4 py-4 sm:grid-cols-3 sm:px-5">
          {[0, 1, 2].map((index) => <Skeleton key={index} className="h-16 rounded-xl" />)}
        </div>
        <TableSkeleton bare rows={6} columns={8} />
        <div className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <Skeleton className="h-4 w-40 bg-gray-100" />
          <Skeleton className="h-9 w-64 max-w-full rounded-lg bg-gray-100" />
        </div>
      </SkeletonCard>
    </div>
  );
}
