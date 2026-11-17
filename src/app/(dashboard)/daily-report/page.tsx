import { Suspense } from 'react';
import { PageSkeleton } from '@/components/PresentationFoundation';
import DailyReportPage from './DailyReportPage';

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DailyReportPage />
    </Suspense>
  );
}
