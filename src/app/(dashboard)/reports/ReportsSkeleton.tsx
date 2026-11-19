import { MetricGridSkeleton, Skeleton, TableSkeleton, metricGridClassName } from '@/components/PresentationFoundation';
import { DonutCardSkeleton, InOutChartCardSkeleton } from '@/components/charts/ChartSkeletons';
import { cn } from '@/lib/utils';

/**
 * Reports while the route loads: where the money is, the period totals, the
 * payment-method cards, the day-by-day chart beside the spending donut and the
 * closeout table. Keep it
 * in step with ReportsPage's closeout view.
 */
export function ReportsSkeleton() {
  return (
    <div className="space-y-5">
      <MetricGridSkeleton count={3} className={cn(metricGridClassName, 'gap-3 sm:grid-cols-3 xl:grid-cols-3')} />
      <MetricGridSkeleton count={4} className={cn(metricGridClassName, 'gap-3 sm:grid-cols-2 xl:grid-cols-4')} />
      <div className="space-y-3">
        <Skeleton className="h-6 w-64" />
        <PaymentCardsSkeleton />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <InOutChartCardSkeleton />
        <DonutCardSkeleton />
      </div>
      <TableSkeleton rows={8} columns={6} />
    </div>
  );
}

/** One placeholder per payment-method card: the amount left, its split bar and the rows under it. */
export function PaymentCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-2xl border border-gray-200 bg-surface p-4 shadow-card sm:p-5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-3 h-7 w-3/4" />
          <Skeleton className="mt-2 h-3 w-10 bg-gray-100" />
          <Skeleton className="mt-3 h-1.5 w-full rounded-full bg-gray-100" />
          <div className="mt-4 space-y-2.5 border-t border-gray-100 pt-3">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex justify-between gap-3">
                <Skeleton className="h-3 w-20 bg-gray-100" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
