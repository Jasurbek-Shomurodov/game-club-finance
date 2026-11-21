import { Skeleton, TableSkeleton } from '@/components/PresentationFoundation';
import { ReportTotalsSkeleton } from '@/components/reports/ReportTotals';
import { SkeletonCard } from '@/components/charts/ChartSkeletons';

/**
 * The daily report while it loads: the game club's four and the bar's six
 * figures (ReportTotals), the cash entry tiles, the
 * stock table and the expenses list. Keep it in step with DailyReportPage.
 */
export function DailyReportSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <ReportTotalsSkeleton gameClubCount={4} />
      <SkeletonCard>
        <Skeleton className="h-4 w-32" />
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-16 rounded-xl bg-gray-100" />)}
        </div>
      </SkeletonCard>
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="px-4 pt-4 sm:px-5 sm:pt-5">
          <Skeleton className="h-4 w-36" />
        </div>
        <TableSkeleton bare rows={4} columns={5} className="mt-3" />
      </SkeletonCard>
      <SkeletonCard>
        <Skeleton className="h-4 w-28" />
        <div className="mt-3 space-y-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-40 max-w-full bg-gray-100" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </SkeletonCard>
    </div>
  );
}
