import { Suspense } from 'react';
import { PageSkeleton } from '@/components/PresentationFoundation';
import FinancialAnalysisPage from './FinancialAnalysisPage';

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FinancialAnalysisPage />
    </Suspense>
  );
}
