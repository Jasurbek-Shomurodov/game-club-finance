import { Skeleton } from '@/components/PresentationFoundation';
import { SkeletonCard } from '@/components/charts/ChartSkeletons';

/**
 * System checks while the server runs them: the club line, the summary banner
 * and one card per check. Keep it in step with TestChecklistPage.
 */
export function TestChecklistSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6" aria-hidden="true">
      <Skeleton className="h-4 w-64 max-w-full bg-gray-100" />
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="space-y-3">
        {Array.from({ length: 7 }, (_, index) => (
          <SkeletonCard key={index}>
            <div className="flex items-start gap-3">
              <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-64 max-w-full" />
                <Skeleton className="h-3 w-full bg-gray-100" />
                <Skeleton className="h-8 w-28 rounded-lg bg-gray-100" />
              </div>
            </div>
          </SkeletonCard>
        ))}
      </div>
      <Skeleton className="h-12 w-full rounded-xl bg-gray-100" />
    </div>
  );
}
