import type { CSSProperties, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-gray-200/70', className)} style={style} />;
}

/** Announces the placeholder as a translated "Loading…" status. */
function useLoadingStatus() {
  const tc = useTranslations('common');
  return { role: 'status', 'aria-label': tc('loading'), 'aria-busy': true } as const;
}

export function MetricGridSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  const statusProps = useLoadingStatus();
  return (
    <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4', className)} {...statusProps}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-gray-200 bg-surface p-5 shadow-card">
          <div className="flex items-start gap-3">
            <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-7 w-4/5" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="mt-4 h-3 w-full bg-gray-100" />
          <Skeleton className="mt-2 h-3 w-3/4 bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6, columns = 4, className }: { rows?: number; columns?: number; className?: string }) {
  const statusProps = useLoadingStatus();
  const template = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-gray-200 bg-surface shadow-card', className)} {...statusProps}>
      <div className="grid gap-4 border-b border-gray-100 bg-gray-50 px-4 py-4" style={template}>
        {Array.from({ length: columns }).map((_, index) => <Skeleton key={index} className="h-3 w-2/3" />)}
      </div>
      <div className="divide-y divide-gray-100">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="grid gap-4 px-4 py-4" style={template}>
            {Array.from({ length: columns }).map((_, columnIndex) => (
              <Skeleton key={columnIndex} className={cn('h-4 bg-gray-100', columnIndex === 0 ? 'w-4/5' : 'w-2/3')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Placeholder with the footprint of the employee card grid. */
export function EmployeeCardGridSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  const statusProps = useLoadingStatus();
  return (
    <div className={cn('grid gap-5 md:grid-cols-2 xl:grid-cols-3', className)} {...statusProps}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-gray-200 bg-surface p-6 shadow-card">
          <div className="mb-5 flex items-start gap-3">
            <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-3 w-2/5 bg-gray-100" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, row) => (
              <div key={row} className="flex items-center justify-between gap-4">
                <Skeleton className="h-3 w-24 bg-gray-100" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
            <Skeleton className="ml-auto mt-4 h-7 w-32" />
          </div>
          <Skeleton className="mt-5 h-9 w-28 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

export function FormSkeleton({ className }: { className?: string }) {
  const statusProps = useLoadingStatus();
  return (
    <div className={cn('rounded-2xl border border-gray-200 bg-surface p-5 shadow-card', className)} {...statusProps}>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-64 max-w-full bg-gray-100" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-24 bg-gray-100" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-24 w-full bg-gray-100" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function DetailListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  const statusProps = useLoadingStatus();
  return (
    <div className={cn('space-y-3', className)} {...statusProps}>
      <div className="rounded-2xl border border-gray-200 bg-surface p-6 shadow-card">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-56 max-w-full" />
            <Skeleton className="h-3 w-4/5 bg-gray-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-28 rounded-xl bg-gray-100" />
            <Skeleton className="h-28 rounded-xl bg-gray-100" />
          </div>
        </div>
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-gray-200 bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-8 w-28 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Announces a page-shaped placeholder as "Loading…"; its children stay hidden from screen readers. */
export function SkeletonStatus({ children, className }: { children: ReactNode; className?: string }) {
  const statusProps = useLoadingStatus();
  return <div className={className} {...statusProps}>{children}</div>;
}

/** Chart placeholder with the same footprint as a chart card. */
export function ChartSkeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('h-80 animate-pulse rounded-2xl border border-gray-200 bg-gray-100', className)} />;
}

/** Generic page-level placeholder used while the shell or a route is loading. */
export function PageSkeleton() {
  const statusProps = useLoadingStatus();
  return (
    <div className="space-y-6" {...statusProps}>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56 rounded-lg" />
        <Skeleton className="h-4 w-80 max-w-full bg-gray-100" />
      </div>
      <MetricGridSkeleton count={4} className="lg:grid-cols-3 2xl:grid-cols-4" />
      <div className="rounded-2xl border border-gray-200 bg-surface p-4 shadow-card sm:p-5">
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full bg-gray-100" />
          <Skeleton className="h-4 w-5/6 bg-gray-100" />
          <Skeleton className="h-4 w-4/6 bg-gray-100" />
          <Skeleton className="mt-4 h-48 w-full rounded-lg bg-gray-100" />
        </div>
      </div>
    </div>
  );
}
