import { FormSkeleton, Skeleton, TableSkeleton } from '@/components/PresentationFoundation';
import { SkeletonCard } from '@/components/charts/ChartSkeletons';
import { OwnerProfitTrendSkeleton } from './OwnerProfitTrend';
import { ReserveSectionSkeleton } from './ReserveSection';

/**
 * Owner Profit while the route loads: the "left to take" headline with its
 * two figures, the split and the two side cards, the six-month trend chart,
 * then the withdrawal form (first on small screens, a side column on wide
 * ones) beside the breakdown table, the reserve, shortages and write-off
 * cards and the history. Keep it in step with MoneyTakenPage.
 */
export function OwnerProfitSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <SkeletonCard className="p-5 sm:p-6" padded={false}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-12 w-72 max-w-full" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:min-w-96">
            <Skeleton className="h-16 rounded-xl bg-gray-100" />
            <Skeleton className="h-16 rounded-xl bg-gray-100" />
          </div>
        </div>
        <Skeleton className="mt-5 h-2 w-full rounded-full bg-gray-100" />
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {[0, 1].map((index) => (
            <div key={index} className="rounded-2xl border border-gray-100 bg-gray-50/40 p-4">
              <div className="flex items-center gap-2.5">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-16 bg-gray-100" />
                </div>
              </div>
              <Skeleton className="mt-4 h-8 w-44 max-w-full" />
              <Skeleton className="mt-4 h-2 w-full rounded-full bg-gray-100" />
              <div className="mt-4 space-y-3">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex justify-between">
                    <Skeleton className="h-3 w-24 bg-gray-100" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SkeletonCard>
      <OwnerProfitTrendSkeleton />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_32rem] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_42rem]">
        <FormSkeleton className="xl:col-start-2 xl:row-start-1" />
        <div className="min-w-0 space-y-5 xl:col-start-1 xl:row-start-1">
          <TableSkeleton rows={6} columns={5} />
          <ReserveSectionSkeleton />
          <TableSkeleton rows={2} columns={3} />
          <TableSkeleton rows={1} columns={3} />
          <TableSkeleton rows={5} columns={4} />
        </div>
      </div>
    </div>
  );
}
