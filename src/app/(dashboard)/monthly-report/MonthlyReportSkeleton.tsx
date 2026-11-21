import { TableSkeleton } from '@/components/PresentationFoundation';
import { ReportTotalsSkeleton } from '@/components/reports/ReportTotals';

/**
 * The monthly report while it loads: the game club's three and the bar's six
 * month totals over the day-by-day table. Keep it in step with MonthlyReportPage.
 */
export function MonthlyReportSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <ReportTotalsSkeleton gameClubCount={3} />
      <TableSkeleton rows={8} columns={11} />
    </div>
  );
}
