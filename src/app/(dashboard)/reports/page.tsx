import { Suspense } from 'react';
import { SkeletonStatus } from '@/components/PresentationFoundation';
import ReportsPage from './ReportsPage';
import { ReportsSkeleton } from './ReportsSkeleton';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; category?: string; source?: string; view?: string }>;
}) {
  const { from, to, category, source, view } = await searchParams;
  // The fallback has the shape of the tab the link opens.
  const skeletonView = view === 'collected' || view === 'writeOffs' ? view : 'closeout';
  return (
    <Suspense fallback={<SkeletonStatus><ReportsSkeleton view={skeletonView} /></SkeletonStatus>}>
      <ReportsPage requestedFrom={from} requestedTo={to} requestedCategory={category} requestedSource={source} requestedView={view} />
    </Suspense>
  );
}
