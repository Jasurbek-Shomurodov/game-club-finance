import { MetricGridSkeleton, Skeleton, metricGridClassName } from '@/components/PresentationFoundation';
import { HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { cn } from '@/lib/utils';

/** One debt row: avatar, name over its date line, the amount and the pay button. */
function DebtRowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-gray-100">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-40 max-w-full" />
              <Skeleton className="h-3 w-56 max-w-full bg-gray-100" />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-8 w-24 rounded-lg bg-gray-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Debts while they load: the three totals, the search box, the unpaid list
 * with its sort chips, then the paid list. Keep it in step with DebtsPage.
 */
export function DebtsSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <MetricGridSkeleton count={3} className={cn(metricGridClassName, 'sm:grid-cols-3 xl:grid-cols-3')} />
      <Skeleton className="h-10 w-full rounded-lg sm:max-w-sm" />
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
          <HeadingSkeleton action />
        </div>
        <DebtRowsSkeleton rows={5} />
      </SkeletonCard>
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="px-4 py-4 sm:px-5">
          <HeadingSkeleton description={false} action />
        </div>
      </SkeletonCard>
    </div>
  );
}
