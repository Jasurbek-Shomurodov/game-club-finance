import { EmployeeCardGridSkeleton, FormSkeleton, MetricGridSkeleton, Skeleton, TableSkeleton, metricGridClassName } from '@/components/PresentationFoundation';
import { CalendarSkeleton, HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { cn } from '@/lib/utils';
import { PayrollGlanceSkeleton } from './PayrollGlance';
import type { SalaryView } from './shared';

/** The grids the headline cards sit in; SalaryManager uses the same ones. */
export const salaryMetricGridClassName = cn(metricGridClassName, 'sm:grid-cols-3 sm:gap-4');
export const salaryHistoryMetricGridClassName = cn(metricGridClassName, 'sm:grid-cols-3 xl:grid-cols-5');

/**
 * The history card while salaries load: the month calendar with the rate
 * changes beside it on very wide screens, the transactions, then the monthly
 * breakdown. Keep it in step with HistoryView.
 */
export function SalaryHistoryBodySkeleton() {
  return (
    <SkeletonCard padded={false} className="space-y-6 p-5 sm:p-6">
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <HeadingSkeleton />
          <div className="my-3 flex items-center justify-between gap-2">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-10 rounded-lg" />
          </div>
          <CalendarSkeleton className="md:[&>*:nth-child(n+8)]:h-28" />
        </div>
        <div className="min-w-0 space-y-2 2xl:border-l 2xl:border-gray-200 2xl:pl-6">
          <Skeleton className="mb-3 h-4 w-28" />
          {[0, 1].map((index) => <Skeleton key={index} className="h-20 w-full rounded-xl bg-gray-100" />)}
        </div>
      </div>
      <div className="space-y-2">
        <HeadingSkeleton />
        {[0, 1, 2].map((index) => <Skeleton key={index} className="h-16 w-full rounded-xl bg-gray-100" />)}
      </div>
      <div>
        <HeadingSkeleton className="mb-3" />
        <TableSkeleton bare rows={4} columns={7} />
      </div>
    </SkeletonCard>
  );
}

/**
 * Salaries while a route loads, in the shape of the tab being opened:
 * Employees is the three headline cards, payroll at a glance and the employee
 * cards; Daily operations is the cards, the help toggle and the two forms;
 * History is its five cards, the help toggle and the history card. Keep it in
 * step with SalaryManager.
 */
export function SalariesSkeleton({ view = 'employees' }: { view?: SalaryView }) {
  const help = <Skeleton className="h-9 w-40 rounded-xl bg-gray-100" />;
  if (view === 'history') {
    return (
      <div className="space-y-5" aria-hidden="true">
        <MetricGridSkeleton count={5} className={salaryHistoryMetricGridClassName} />
        {help}
        <SalaryHistoryBodySkeleton />
      </div>
    );
  }
  return (
    <div className="space-y-5" aria-hidden="true">
      <MetricGridSkeleton count={3} className={cn(salaryMetricGridClassName, 'xl:grid-cols-3')} />
      {view === 'operations' ? (
        <>
          {help}
          <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
            <FormSkeleton />
            <FormSkeleton />
          </div>
        </>
      ) : (
        <>
          <PayrollGlanceSkeleton />
          <EmployeeCardGridSkeleton />
        </>
      )}
    </div>
  );
}
