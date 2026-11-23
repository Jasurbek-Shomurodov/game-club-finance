import { Skeleton } from '@/components/PresentationFoundation';
import { HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { cn } from '@/lib/utils';

/**
 * Placeholders for the four Public page tabs, each in the shape of its page.
 * All are silent; wrap them in `SkeletonStatus`. Keep them in step with
 * ShowcasePage, GameLibraryPage, GoogleBusinessPage and BrandSettingsCard.
 */

/** A `Field`: its label over its control. */
function FieldSkeleton({ className, tall = false }: { className?: string; tall?: boolean }) {
  return (
    <div className={cn('space-y-2', className)}>
      <Skeleton className="h-3 w-24 bg-gray-100" />
      <Skeleton className={cn('w-full', tall ? 'h-24' : 'h-11')} />
    </div>
  );
}

/** A card header (`CardHeader` + `SectionHeading`). */
function CardHeadSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
      <HeadingSkeleton action={action} />
    </div>
  );
}

/** List rows: a thumbnail, two lines of text and a small action. */
export function ShowcaseRowsSkeleton({ rows = 3, thumbnail = true }: { rows?: number; thumbnail?: boolean }) {
  return (
    <div className="divide-y divide-gray-100" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
          {thumbnail && <Skeleton className="aspect-video w-24 shrink-0 rounded-lg" />}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-72 max-w-full bg-gray-100" />
          </div>
          <Skeleton className="h-8 w-8 shrink-0 rounded-lg bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

/** A grid of game covers, as on the Page tab and in the library. */
export function GameCoverGridSkeleton({ count = 12, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10', className)} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="aspect-[3/4] w-full rounded-xl" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-1/2 bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

/** A settings form: text fields, an image picker and the save button; `extras` adds the club page's branch, amenities and photos. */
export function ShowcaseFormSkeleton({ fields = 6, extras = false }: { fields?: number; extras?: boolean }) {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FieldSkeleton />
        <FieldSkeleton />
      </div>
      <FieldSkeleton tall />
      {extras && (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <FieldSkeleton />
            <FieldSkeleton />
          </div>
          <FieldSkeleton />
        </>
      )}
      <div className="flex gap-3">
        <Skeleton className="aspect-video w-44 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-9 w-36 rounded-lg" />
          <Skeleton className="h-9 w-full bg-gray-100" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: fields }, (_, index) => <FieldSkeleton key={index} />)}
      </div>
      {extras && (
        <>
          <div className="space-y-2">
            <Skeleton className="h-3 w-32 bg-gray-100" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 12 }, (_, index) => <Skeleton key={index} className="h-11 w-full rounded-xl bg-gray-100" />)}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-3 w-28 bg-gray-100" />
              <Skeleton className="h-9 w-32 rounded-lg" />
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="aspect-[4/3] w-full rounded-xl" />)}
            </div>
          </div>
        </>
      )}
      <Skeleton className="h-16 w-full rounded-xl bg-gray-100" />
      <div className="flex justify-end">
        <Skeleton className="h-11 w-28 rounded-lg" />
      </div>
    </div>
  );
}

/** /showcase: page settings, then zones, offers and games. */
export function ShowcaseSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <SkeletonCard padded={false}>
        <CardHeadSkeleton />
        <div className="p-4 sm:p-5"><ShowcaseFormSkeleton fields={9} extras /></div>
      </SkeletonCard>
      {[true, false].map((thumbnail, index) => (
        <SkeletonCard key={index} padded={false}>
          <CardHeadSkeleton action />
          <div className="p-4 sm:p-5"><ShowcaseRowsSkeleton rows={2} thumbnail={thumbnail} /></div>
        </SkeletonCard>
      ))}
      <SkeletonCard padded={false}>
        <CardHeadSkeleton action />
        <div className="p-4 sm:p-5"><GameCoverGridSkeleton count={8} className="grid-cols-2" /></div>
      </SkeletonCard>
    </div>
  );
}

/** /showcase/games: search and genre filters over the cover grid. */
export function GameLibrarySkeleton() {
  return (
    <SkeletonCard padded={false}>
      <div className="space-y-3 border-b border-gray-100 p-4 sm:p-5">
        <Skeleton className="h-3 w-80 max-w-full bg-gray-100" />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-11 w-full sm:max-w-xs" />
          <Skeleton className="h-9 w-48 max-w-full rounded-lg bg-gray-100" />
        </div>
        <div className="flex gap-2">
          {['w-16', 'w-20', 'w-24', 'w-16'].map((width, index) => <Skeleton key={index} className={cn('h-9 rounded-full bg-gray-100', width)} />)}
        </div>
      </div>
      <div className="p-4 sm:p-5"><GameCoverGridSkeleton count={18} className="grid-cols-3" /></div>
    </SkeletonCard>
  );
}

/** The Google listing form inside its card: description, phone, website and the week of hours. */
export function GoogleListingSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <FieldSkeleton tall />
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldSkeleton />
        <FieldSkeleton />
      </div>
      <div className="divide-y divide-gray-100">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-32 bg-gray-100" />
            <Skeleton className="h-11 w-52 max-w-full bg-gray-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** /showcase/google: the connection card, then the listing, the post composer and the lists. */
export function GoogleBusinessSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <SkeletonCard className="space-y-4">
        <HeadingSkeleton description={false} action />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-24 bg-gray-100" />
              <Skeleton className="h-4 w-40 max-w-full" />
            </div>
          ))}
        </div>
      </SkeletonCard>
      <SkeletonCard className="space-y-5">
        <HeadingSkeleton />
        <GoogleListingSkeleton />
      </SkeletonCard>
      <SkeletonCard className="space-y-4">
        <HeadingSkeleton />
        <Skeleton className="h-11 w-full max-w-sm rounded-lg bg-gray-100" />
        <FieldSkeleton tall />
        <div className="flex justify-end"><Skeleton className="h-11 w-32 rounded-lg" /></div>
      </SkeletonCard>
      <SkeletonCard className="space-y-4">
        <HeadingSkeleton />
        <ShowcaseRowsSkeleton rows={3} />
      </SkeletonCard>
    </div>
  );
}

/** /showcase/brand: the one brand settings card. */
export function BrandSkeleton() {
  return (
    <SkeletonCard padded={false}>
      <CardHeadSkeleton action />
      <div className="p-4 sm:p-5"><ShowcaseFormSkeleton fields={5} /></div>
    </SkeletonCard>
  );
}
