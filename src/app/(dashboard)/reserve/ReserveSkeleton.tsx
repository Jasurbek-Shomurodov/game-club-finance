import { Skeleton } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { BalanceFlowChartSkeleton, DonutCardSkeleton, HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';

/**
 * The reserve overview while it loads: what it holds now (sums, dollars, the
 * three totals and the split bar), then the period control over the balance
 * and in/out card (two thirds) beside the spending donut. Keep it in step with
 * ReservePage.
 */
export function ReserveOverviewSkeleton({ withSwitch = false }: { withSwitch?: boolean }) {
  return (
    <div className="space-y-6" aria-hidden="true">
      {withSwitch && <Skeleton className="h-10 w-72 max-w-full rounded-xl" />}
      <div className="space-y-3">
      <Skeleton className="h-3 w-28" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1].map((index) => (
          <SkeletonCard key={index} className="space-y-3">
            <Skeleton className="h-4 w-24 bg-gray-100" />
            <Skeleton className="h-8 w-48 max-w-full" />
          </SkeletonCard>
        ))}
      </div>
      <SkeletonCard>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg bg-gray-100" />
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
      </SkeletonCard>
      </div>
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-56 max-w-full rounded-xl" />
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <SkeletonCard className="xl:col-span-2">
            <HeadingSkeleton />
            <ReserveExplorerSkeleton className="mt-4" />
          </SkeletonCard>
          <DonutCardSkeleton stacked />
        </div>
      </div>
    </div>
  );
}

/**
 * `ReserveExplorer` while its chart code loads: the readout (title row with the
 * hint, the sub line, three figures as short lines on a phone and tiles from
 * `sm`, the entries button) over the chart.
 */
export function ReserveExplorerSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('space-y-4', className)}>
      <div className="space-y-2 rounded-xl bg-gray-50 p-3 sm:space-y-3 sm:p-4">
        <div>
          <div className="flex min-h-9 items-center justify-between gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24 bg-gray-100" />
          </div>
          <div className="mt-0.5 space-y-1 max-sm:min-h-8 sm:flex sm:items-center">
            <Skeleton className="h-3 w-64 max-w-full bg-gray-100" />
            <Skeleton className="h-3 w-40 bg-gray-100 sm:hidden" />
          </div>
        </div>
        <div className="sm:hidden">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex h-5 items-center justify-between gap-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3.5 w-28" />
            </div>
          ))}
        </div>
        <div className="hidden gap-2 sm:grid sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="space-y-2 rounded-xl border border-gray-200 bg-surface px-4 py-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
        <div className="flex min-h-9 items-center">
          <Skeleton className="h-9 w-36 rounded-xl" />
        </div>
      </div>
      <BalanceFlowChartSkeleton />
    </div>
  );
}

/** The reserve history while it loads: the kind filter over days of entries. Keep it in step with ReserveHistoryList. */
export function ReserveHistorySkeleton() {
  return (
    <div className="max-w-4xl space-y-3" aria-hidden="true">
      <Skeleton className="h-9 w-80 max-w-full rounded-xl" />
      <SkeletonCard padded={false} className="overflow-hidden">
        {[0, 1].map((day) => (
          <div key={day} className="border-b border-gray-100 last:border-b-0">
            {/* A phone puts the day's totals under the date. */}
            <div className="flex flex-col gap-1.5 bg-gray-50 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3 border-t border-gray-100 px-4 py-3 sm:px-5">
                <Skeleton className="h-9 w-9 shrink-0 rounded-xl bg-gray-100" />
                {/* A phone has the amount under the name, a wider screen in a column beside it. */}
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <div className="flex items-center justify-between gap-3">
                    <Skeleton className="h-3 w-24 bg-gray-100" />
                    <Skeleton className="h-5 w-24 shrink-0 sm:hidden" />
                  </div>
                </div>
                <Skeleton className="hidden h-5 w-24 shrink-0 sm:block" />
              </div>
            ))}
          </div>
        ))}
      </SkeletonCard>
    </div>
  );
}
