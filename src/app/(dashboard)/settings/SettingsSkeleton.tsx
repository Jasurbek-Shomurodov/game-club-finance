import type { ReactNode } from 'react';
import { Skeleton } from '@/components/PresentationFoundation';
import { SkeletonCard } from '@/components/charts/ChartSkeletons';
import { OWNER_BOT_USERNAME } from '@/lib/ownerTelegramLink';
import { cn } from '@/lib/utils';
import { OwnerTelegramCardSkeleton } from './OwnerTelegramCard';

/** A `SettingsSection`: its small heading above its card. */
function SectionSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex min-h-8 items-center px-1">
        <Skeleton className="h-3 w-32" />
      </div>
      {children}
    </div>
  );
}

/** A divided settings card: a label on the left and its control on the right of each row. */
function SettingRowsSkeleton({ rows, stacked = [] }: { rows: number; stacked?: number[] }) {
  return (
    <SkeletonCard padded={false} className="divide-y divide-gray-100 overflow-hidden">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={cn('flex flex-col gap-3 px-5 py-4', !stacked.includes(index) && 'sm:flex-row sm:items-center sm:justify-between')}>
          <div className="min-w-0 space-y-2 sm:flex-1">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full bg-gray-100" />
          </div>
          <Skeleton className={cn('h-11 w-full rounded-lg bg-gray-100', !stacked.includes(index) && 'sm:w-36')} />
        </div>
      ))}
    </SkeletonCard>
  );
}

/**
 * Settings while the route loads: the account card, the owner bot link (once
 * the bot is set up), the selected club's settings, the club cards and the
 * expense presets. Keep it in step with SettingsPageClient.
 */
export function SettingsSkeleton() {
  return (
    <div className="w-full max-w-4xl space-y-8" aria-hidden="true">
      <SkeletonCard className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-48 max-w-full" />
            <Skeleton className="h-3 w-56 max-w-full bg-gray-100" />
          </div>
        </div>
        <Skeleton className="h-10 w-28 rounded-lg bg-gray-100" />
      </SkeletonCard>
      {OWNER_BOT_USERNAME && <OwnerTelegramCardSkeleton />}
      {/* Club details and payment methods put their control under the label. */}
      <SectionSkeleton><SettingRowsSkeleton rows={4} stacked={[0, 2]} /></SectionSkeleton>
      <SectionSkeleton>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <SkeletonCard key={index}>
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2 bg-gray-100" />
                </div>
              </div>
            </SkeletonCard>
          ))}
        </div>
      </SectionSkeleton>
      <SectionSkeleton><SettingRowsSkeleton rows={3} /></SectionSkeleton>
    </div>
  );
}
