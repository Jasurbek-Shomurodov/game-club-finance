import { Suspense } from 'react';
import { PageSkeleton } from '@/components/PresentationFoundation';
import ReservePage from './ReservePage';

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReservePage />
    </Suspense>
  );
}
