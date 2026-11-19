import { Suspense } from 'react';
import { SkeletonStatus } from '@/components/PresentationFoundation';
import { StockPurchaseSkeleton } from './StockPurchaseSkeleton';
import StockPurchasePage from './StockPurchasePage';

export default function Page() {
  return (
    <Suspense fallback={<SkeletonStatus><StockPurchaseSkeleton /></SkeletonStatus>}>
      <StockPurchasePage />
    </Suspense>
  );
}
