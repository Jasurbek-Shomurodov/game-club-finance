import { Skeleton } from '@/components/PresentationFoundation';
import { SkeletonCard } from '@/components/charts/ChartSkeletons';

const SUGGESTION_WIDTHS = ['w-44', 'w-56', 'w-40', 'w-52', 'w-36', 'w-48', 'w-56', 'w-44', 'w-48'];

/**
 * The assistant before it arrives: the empty-chat card (icon, title, a line of
 * explanation, the suggested questions an owner sees) over the question box and its send
 * button. Keep it in step with AssistantPage.
 */
export function AssistantSkeleton() {
  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col gap-4" aria-hidden="true">
      <div className="flex-1">
        <SkeletonCard>
          <div className="flex flex-col items-center px-4 py-8">
            <Skeleton className="h-12 w-12 rounded-2xl" />
            <Skeleton className="mt-3 h-4 w-48 max-w-full" />
            <Skeleton className="mt-2 h-3 w-72 max-w-full bg-gray-100" />
            <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
              {SUGGESTION_WIDTHS.map((width, index) => <Skeleton key={index} className={`h-9 max-w-full rounded-lg bg-gray-100 ${width}`} />)}
            </div>
          </div>
        </SkeletonCard>
      </div>
      <div className="space-y-2 pb-2 pt-1">
        <div className="flex items-end gap-2">
          <Skeleton className="h-20 flex-1 rounded-xl bg-gray-100" />
          <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
        </div>
        <Skeleton className="mx-auto h-3 w-64 max-w-full bg-gray-100" />
      </div>
    </div>
  );
}
