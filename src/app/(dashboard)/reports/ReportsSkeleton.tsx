import { MetricGridSkeleton, Skeleton, TableSkeleton, metricGridClassName } from '@/components/PresentationFoundation';
import { DonutCardSkeleton, HeadingSkeleton, InOutChartCardSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { cn } from '@/lib/utils';
import { CollectedGlanceSkeleton, CollectedSplitSkeleton } from './CollectedGlance';
import type { ReportsView } from './ReportsTabs';

/** Tiles per row from `sm` up follow how many there are, so a row never ends in a lone tile or an empty cell. */
const WIDE_COLUMNS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
  // Five: three to a row then two wider ones until there is room for all five.
  5: 'sm:grid-cols-6 sm:[&>*]:col-span-2 sm:[&>*:nth-last-child(-n+2)]:col-span-3 lg:grid-cols-5 lg:[&>*]:col-span-1 lg:[&>*:nth-last-child(-n+2)]:col-span-1',
};

/** Grid of money tiles: two to a line on phones (an odd last one full width), then by count. */
export function moneyTilesGridClassName(count: number): string {
  return cn(metricGridClassName, WIDE_COLUMNS[Math.min(Math.max(count, 1), 5)]);
}

/** `count` soft stat tiles in the money-tile grid. */
export function MoneyTilesSkeleton({ count, tall = false, className }: { count: number; /** Tiles whose label has a second line. */ tall?: boolean; className?: string }) {
  return (
    <div className={cn(moneyTilesGridClassName(count), className)} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <Skeleton key={index} className={cn('rounded-xl bg-gray-100', tall ? 'h-20' : 'h-16')} />)}
    </div>
  );
}

/** A card with a small heading over a row of money tiles (where the money is, money left by method). */
function MoneyTilesCardSkeleton({ count, description = false, action = false }: { count: number; description?: boolean; /** The heading has a button (the owner's "Put in"). */ action?: boolean }) {
  return (
    <SkeletonCard>
      <HeadingSkeleton description={description} action={action} />
      <MoneyTilesSkeleton count={count} tall={!description} className="mt-3" />
    </SkeletonCard>
  );
}

/** The closeout card: heading with export, the search and filter line, then day-grouped entries. */
export function CloseoutTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-surface shadow-card" aria-hidden="true">
      <div className="space-y-3 p-5">
        <HeadingSkeleton action />
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <Skeleton className="h-10 rounded-xl lg:w-72" />
          <Skeleton className="h-10 rounded-xl lg:w-52" />
          <Skeleton className="h-8 rounded-full lg:ml-auto lg:w-72" />
        </div>
      </div>
      <TableSkeleton bare rows={8} columns={6} />
    </div>
  );
}

/**
 * Reports while the route loads, in the shape of the view being opened.
 * Closeout: the four period totals, where the money is, money left by method,
 * the day-by-day chart beside the spending donut and the closeout table.
 * Collected: where the money is, the four collected totals, the split bar, its
 * two charts and the list. Write-offs: the ledger. Keep it in step with
 * ReportsPage, CollectedTab and StockAdjustmentsLedger.
 */
export function ReportsSkeleton({ view = 'closeout', whereabouts = 3 }: {
  view?: ReportsView;
  /** Places shown in "where the money is": three for an owner (with the reserve and its "Put in"), two for everyone else. */
  whereabouts?: 2 | 3;
}) {
  if (view === 'writeOffs') {
    return (
      <div className="space-y-5">
        <MetricGridSkeleton count={3} className={cn(metricGridClassName, 'sm:grid-cols-3 xl:grid-cols-3')} />
        <TableSkeleton rows={8} columns={6} />
      </div>
    );
  }
  if (view === 'collected') {
    return (
      <div className="space-y-5">
        <MoneyTilesCardSkeleton count={whereabouts} action={whereabouts === 3} />
        <MetricGridSkeleton count={4} className={cn(metricGridClassName, 'sm:grid-cols-2 xl:grid-cols-4')} />
        <CollectedSplitSkeleton />
        <CollectedGlanceSkeleton />
        <TableSkeleton rows={6} columns={6} />
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <MetricGridSkeleton count={4} className={cn(metricGridClassName, 'sm:grid-cols-2 xl:grid-cols-4')} />
      <MoneyTilesCardSkeleton count={whereabouts} action={whereabouts === 3} />
      <MoneyTilesCardSkeleton count={4} description />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <InOutChartCardSkeleton />
        <DonutCardSkeleton />
      </div>
      <CloseoutTableSkeleton />
    </div>
  );
}
