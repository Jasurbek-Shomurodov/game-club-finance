import { TableSkeleton } from '@/components/PresentationFoundation';
import { HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';

/**
 * Promotions while they load: the list card with its heading and table. Keep
 * it in step with PromotionsPage.
 */
export function PromotionsSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <SkeletonCard padded={false} className="overflow-hidden">
        <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
          <HeadingSkeleton />
        </div>
        <TableSkeleton rows={4} columns={6} className="rounded-none border-0 shadow-none" />
      </SkeletonCard>
    </div>
  );
}
