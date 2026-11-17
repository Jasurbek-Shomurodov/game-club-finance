import { Suspense } from 'react';
import { PageSkeleton } from '@/components/PresentationFoundation';
import ClosingStockPage from './ClosingStockPage';

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ClosingStockPage />
    </Suspense>
  );
}
