import { Suspense } from 'react';
import { SkeletonStatus } from '@/components/PresentationFoundation';
import { ClosingStockSkeleton } from './ClosingStockSkeleton';
import ClosingStockPage from './ClosingStockPage';

export default function Page() {
  return (
    <Suspense fallback={<SkeletonStatus><ClosingStockSkeleton /></SkeletonStatus>}>
      <ClosingStockPage />
    </Suspense>
  );
}
