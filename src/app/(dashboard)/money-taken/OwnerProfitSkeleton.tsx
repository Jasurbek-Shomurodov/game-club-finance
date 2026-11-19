import { FormSkeleton, Skeleton, TableSkeleton } from '@/components/PresentationFoundation';
import { OwnerProfitTrendSkeleton } from './OwnerProfitTrend';

/**
 * Owner Profit while the route loads: the "left to take" headline with its
 * split and the two side cards, the six-month trend chart, then the breakdown table beside the
 * withdrawal form. Keep it in step with MoneyTakenPage.
 */
export function OwnerProfitSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="rounded-2xl border border-gray-200 bg-surface p-5 shadow-card sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-12 w-72 max-w-full" />
          </div>
          <Skeleton className="h-16 w-full rounded-2xl bg-gray-100 lg:w-[26rem]" />
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
      </div>
      <OwnerProfitTrendSkeleton />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_32rem] 2xl:grid-cols-[minmax(0,1fr)_42rem] xl:items-start">
        <TableSkeleton rows={6} columns={5} />
        <FormSkeleton />
      </div>
    </div>
  );
}
