import { MetricGridSkeleton, TableSkeleton, metricGridClassName } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';

/**
 * The monthly report while it loads: nine month totals over the day-by-day
 * table. Keep it in step with MonthlyReportPage.
 */
export function MonthlyReportSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <MetricGridSkeleton count={9} className={cn(metricGridClassName, 'sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 xl:grid-cols-4')} />
      <TableSkeleton rows={8} columns={11} />
    </div>
  );
}
