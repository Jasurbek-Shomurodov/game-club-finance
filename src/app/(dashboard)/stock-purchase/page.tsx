import { Suspense } from 'react';
import { PageSkeleton } from '@/components/PresentationFoundation';
import StockPurchasePage from './StockPurchasePage';

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StockPurchasePage />
    </Suspense>
  );
}
