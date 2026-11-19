import { EmployeeCardGridSkeleton, MetricGridSkeleton, metricGridClassName } from '@/components/PresentationFoundation';
import { cn } from '@/lib/utils';
import { PayrollGlanceSkeleton } from './PayrollGlance';

/**
 * Salaries while the route loads (every /salaries page shares it): the three
 * headline cards, payroll at a glance, then the employee cards. Keep it in
 * step with SalaryManager.
 */
export function SalariesSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <MetricGridSkeleton count={3} className={cn(metricGridClassName, 'sm:grid-cols-3 sm:gap-4 xl:grid-cols-3')} />
      <PayrollGlanceSkeleton />
      <EmployeeCardGridSkeleton />
    </div>
  );
}
