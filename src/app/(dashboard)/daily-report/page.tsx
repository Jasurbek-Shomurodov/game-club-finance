import { Suspense } from 'react';
import { SkeletonStatus } from '@/components/PresentationFoundation';
import { DailyReportSkeleton } from './DailyReportSkeleton';
import DailyReportPage from './DailyReportPage';

export default function Page() {
  return (
    <Suspense fallback={<SkeletonStatus><DailyReportSkeleton /></SkeletonStatus>}>
      <DailyReportPage />
    </Suspense>
  );
}
