import { SkeletonStatus } from '@/components/PresentationFoundation';
import { Suspense } from 'react';
import { ReserveOverviewSkeleton } from './ReserveSkeleton';
import ReservePage from './ReservePage';

export default function Page() {
  return (
    <Suspense fallback={<SkeletonStatus><ReserveOverviewSkeleton withSwitch /></SkeletonStatus>}>
      <ReservePage />
    </Suspense>
  );
}
