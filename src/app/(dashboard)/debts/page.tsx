import { Suspense } from 'react';
import { SkeletonStatus } from '@/components/PresentationFoundation';
import { DebtsSkeleton } from './DebtsSkeleton';
import DebtsPage from './DebtsPage';

export default function Page() {
  return (
    <Suspense fallback={<SkeletonStatus><DebtsSkeleton /></SkeletonStatus>}>
      <DebtsPage />
    </Suspense>
  );
}
