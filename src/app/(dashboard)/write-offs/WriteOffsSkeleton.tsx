import { MetricGridSkeleton, Skeleton, TableSkeleton, metricGridClassName } from '@/components/PresentationFoundation';
import { HeadingSkeleton, InOutChartSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { cn } from '@/lib/utils';

/**
 * Write-offs while the route loads: today's card, then the month ledger
 * (heading with the month picker, four figures, the day chart beside the
 * product list, and the table). Keep it in step with WriteOffsPage and
 * StockAdjustmentsLedger.
 */
export function WriteOffsSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
          <HeadingSkeleton />
        </div>
        <TableSkeleton rows={2} columns={5} className="rounded-none border-0 shadow-none" />
      </SkeletonCard>

      <HeadingSkeleton action />
      <MetricGridSkeleton count={4} className={cn(metricGridClassName, 'lg:grid-cols-4')} />
      <div className="grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <SkeletonCard>
          <HeadingSkeleton />
          <InOutChartSkeleton height={280} className="mt-3" />
        </SkeletonCard>
        <SkeletonCard>
          <HeadingSkeleton />
          <div className="mt-3 space-y-3">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-10 w-full rounded-lg bg-gray-100" />)}
          </div>
        </SkeletonCard>
      </div>
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
          <HeadingSkeleton />
        </div>
        <TableSkeleton rows={6} columns={6} className="rounded-none border-0 shadow-none" />
      </SkeletonCard>
    </div>
  );
}
