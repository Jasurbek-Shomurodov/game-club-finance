import { MetricGridSkeleton, Skeleton, TableSkeleton, metricGridClassName } from '@/components/PresentationFoundation';
import { DonutCardSkeleton, InOutChartCardSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
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

const PAYMENT_GRID_WIDE: Record<number, string> = {
  2: 'xl:grid-cols-2',
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  // Five cards: three to a row, then two wider ones, so no cell stays empty.
  5: 'xl:grid-cols-6 xl:[&>*]:col-span-2 xl:[&>*:nth-last-child(-n+2)]:col-span-3',
};

/**
 * The payment-method cards' grid for `count` cards: the columns follow the
 * count, so a row never ends in a lone card or an empty column.
 */
export function paymentCardsGridClassName(count: number): string {
  return cn(
    'grid grid-cols-1 gap-3 sm:grid-cols-2 sm:max-xl:[&>*:last-child:nth-child(odd)]:col-span-2',
    PAYMENT_GRID_WIDE[Math.min(Math.max(count, 1), 5)],
  );
}

/** One placeholder per payment-method card: the amount left, its split bar and the rows under it. */
export function PaymentCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={paymentCardsGridClassName(count)} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonCard key={index}>
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
        </SkeletonCard>
      ))}
    </div>
  );
}
