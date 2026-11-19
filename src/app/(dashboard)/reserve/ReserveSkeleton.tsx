import { ChartSkeleton, Skeleton } from '@/components/PresentationFoundation';

/**
 * The reserve overview while it loads: what it holds now (sums, dollars, the
 * three totals and the split bar), the balance chart beside the spending
 * donut, then money in and out. Keep it in step with ReservePage.
 */
export function ReserveOverviewSkeleton({ withSwitch = false }: { withSwitch?: boolean }) {
  return (
    <div className="space-y-6" aria-hidden="true">
      {withSwitch && <Skeleton className="h-10 w-72 max-w-full rounded-xl" />}
      <div className="rounded-2xl border border-gray-200 bg-surface p-4 shadow-card sm:p-5">
        <Skeleton className="h-3 w-28" />
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {[0, 1].map((index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-16 bg-gray-100" />
              <Skeleton className="h-9 w-48 max-w-full" />
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-8 w-28 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg bg-gray-100" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="space-y-2 rounded-xl bg-gray-50 p-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-28" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-4 h-2.5 w-full rounded-full bg-gray-100" />
        <div className="mt-2 flex gap-5">
          <Skeleton className="h-3 w-28 bg-gray-100" />
          <Skeleton className="h-3 w-20 bg-gray-100" />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartSkeleton />
        <div className="flex h-80 items-center gap-6 rounded-2xl border border-gray-200 bg-surface p-5 shadow-card">
          <Skeleton className="h-44 w-44 shrink-0 rounded-full bg-gray-100" />
          <div className="flex-1 space-y-3">
            {[0, 1, 2].map((index) => <Skeleton key={index} className="h-6 w-full bg-gray-100" />)}
          </div>
        </div>
      </div>
      <ChartSkeleton />
    </div>
  );
}
