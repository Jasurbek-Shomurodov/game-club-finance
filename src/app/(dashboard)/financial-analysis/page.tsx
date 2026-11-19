import { SkeletonStatus } from '@/components/PresentationFoundation';
import { Suspense } from 'react';
import { FinancialAnalysisSkeleton } from './FinancialAnalysisSkeleton';
import FinancialAnalysisPage from './FinancialAnalysisPage';

export default function Page() {
  return (
    <Suspense fallback={<SkeletonStatus><FinancialAnalysisSkeleton /></SkeletonStatus>}>
      <FinancialAnalysisPage />
    </Suspense>
  );
}
