import { Suspense } from 'react';
import { PageSkeleton } from '@/components/PresentationFoundation';
import DebtsPage from './DebtsPage';

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DebtsPage />
    </Suspense>
  );
}
