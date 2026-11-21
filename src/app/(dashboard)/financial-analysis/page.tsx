import { SkeletonStatus } from '@/components/PresentationFoundation';
import { Suspense } from 'react';
import { FinancialAnalysisSkeleton } from './FinancialAnalysisSkeleton';
import FinancialAnalysisPage from './FinancialAnalysisPage';

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  // The placeholder takes the shape of the view the link asks for.
  const { view } = await searchParams;
  return (
    <Suspense fallback={<SkeletonStatus><FinancialAnalysisSkeleton view={view === 'overall' ? 'overall' : 'monthly'} /></SkeletonStatus>}>
      <FinancialAnalysisPage />
    </Suspense>
  );
}
