import { MetricGridSkeleton, Skeleton } from '@/components/PresentationFoundation';
import { HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { SideGlanceCardSkeleton } from '@/components/dashboard/SideGlanceCard';

/**
 * The five headline cards: one column on phones, two from `sm` (the fifth card
 * takes the full row), three incomes over the profit and the reserve from `xl`,
 * one row from `2xl`.
 */
export const HEADLINE_GRID_CLASS = 'grid gap-3 sm:grid-cols-2 sm:max-xl:[&>*:last-child]:col-span-2 xl:grid-cols-6 xl:max-2xl:[&>*]:col-span-2 xl:max-2xl:[&>*:nth-child(n+4)]:col-span-3 2xl:grid-cols-5';

/** The headline row without the reserve (a member who cannot open it): two by two, one row from `2xl`. */
export const HEADLINE_GRID_FOUR_CLASS = 'grid gap-3 sm:grid-cols-2 2xl:grid-cols-4';

/**
 * The dashboard's loading shape: the headline cards (five, or four without the
 * reserve), the two "at a glance" cards, the two money flows, then the two
 * trend charts. Keep it in step with DashboardPage.
 */
export function DashboardSkeleton({ withReserve = true }: { withReserve?: boolean }) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <MetricGridSkeleton count={withReserve ? 5 : 4} className={withReserve ? HEADLINE_GRID_CLASS : HEADLINE_GRID_FOUR_CLASS} />
      <GlanceSectionSkeleton />
      <div className="grid gap-3 2xl:grid-cols-2" aria-hidden="true">
        <FlowCardSkeleton />
        <FlowCardSkeleton />
      </div>
      <div className="space-y-4" aria-hidden="true">
        <TrendChartSkeleton />
        <TrendChartSkeleton />
      </div>
    </div>
  );
}

/** The "this month at a glance" heading, progress bar and both side cards. */
export function GlanceSectionSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-3 w-40 bg-gray-100" />
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <SideGlanceCardSkeleton />
        <SideGlanceCardSkeleton />
      </div>
    </div>
  );
}

/** One side's money flow card: heading with its details link, the Sankey, then four figures. */
export function FlowCardSkeleton() {
  return (
    <SkeletonCard>
      <HeadingSkeleton action />
      <Skeleton className="mt-4 h-64 w-full rounded-xl bg-gray-100" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="space-y-2 rounded-xl bg-gray-50 px-4 py-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-32 max-w-full" />
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}

/** A trend chart card (daily sales, income trend): heading, legend pills, the plot. */
export function TrendChartSkeleton() {
  return (
    <SkeletonCard>
      <HeadingSkeleton description={false} action />
      <Skeleton className="mt-3 h-64 w-full rounded-xl bg-gray-100 sm:h-72" />
    </SkeletonCard>
  );
}
