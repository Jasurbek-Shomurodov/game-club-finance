import { ChartSkeleton, MetricGridSkeleton, Skeleton } from '@/components/PresentationFoundation';
import { SideGlanceCardSkeleton } from '@/components/dashboard/SideGlanceCard';

/**
 * The dashboard's loading shape: the five headline cards, the two "at a
 * glance" cards, then the two money flows. Keep it in step with DashboardPage.
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-5">
      <MetricGridSkeleton count={5} className="gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5" />
      <GlanceSectionSkeleton />
      <div className="grid gap-3 2xl:grid-cols-2" aria-hidden="true">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>
    </div>
  );
}

/** The "this month at a glance" heading, progress bar and both side cards. */
export function GlanceSectionSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="flex items-center justify-between gap-4">
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
