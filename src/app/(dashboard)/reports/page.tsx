import { Suspense } from 'react';
import { SkeletonStatus } from '@/components/PresentationFoundation';
import { openingBalanceSpan } from '@/lib/calculations/moneyReport';
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
  // A linked period that does not start on the 1st of its last month has the tiles' second line.
  // Without one the page opens the current month, which starts on the 1st and has none.
  const linkedRange = from && to ? (from <= to ? { from, to } : { from: to, to: from }) : null;
  const tallMethodTiles = linkedRange !== null && openingBalanceSpan(linkedRange) !== null;
  return (
    <Suspense fallback={<SkeletonStatus><ReportsSkeleton view={skeletonView} tallMethodTiles={tallMethodTiles} /></SkeletonStatus>}>
      <ReportsPage requestedFrom={from} requestedTo={to} requestedCategory={category} requestedSource={source} requestedView={view} />
    </Suspense>
  );
}
