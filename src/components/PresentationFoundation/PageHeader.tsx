'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTopBarSlot } from './TopBarSlot';

export interface PageHeaderProps {
  title: ReactNode;
  /** Actions rendered on the right (or full width on phones). */
  action?: ReactNode;
  /** View switcher shown right after the title (a `SegmentedControl` with `variant="tabs"`). */
  tabs?: ReactNode;
  /** Accepted for compatibility; the header no longer draws an icon tile so every page opens the same way. */
  icon?: ReactNode;
  /** Small chip beside the title, for a date range or status. */
  meta?: ReactNode;
  /** Renders a back link. Pass an href to link, or `true` to use browser history. */
  back?: string | true;
  backLabel?: string;
  className?: string;
}

/**
 * Page title block. Every page starts with one of these. Inside the dashboard
 * shell the title moves up into the top bar, and the tabs (right after the
 * title) and actions join it while the bar has room; meta sits beside the
 * title. The back link stays on the page.
 */
export function PageHeader({ title, tabs, action, meta, back, backLabel, className }: PageHeaderProps) {
  const router = useRouter();
  const slot = useTopBarSlot();
  const inTopBar = Boolean(slot?.title);
  const actionsInTopBar = Boolean(slot?.actions);
  const backClassName =
    'mb-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  const topBarTitle = slot?.title && createPortal(
    <>
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="truncate text-base font-semibold leading-tight text-gray-950">{title}</h1>
        {meta && <div className="shrink-0">{meta}</div>}
      </div>
      {tabs && actionsInTopBar && <div data-page-tabs className="shrink-0">{tabs}</div>}
    </>,
    slot.title,
  );

  // Marked so the top bar can measure the actions wherever they currently are.
  const topBarActions = action && slot?.actions && createPortal(
    <div data-page-actions className="flex items-center gap-2 [&>*]:shrink-0">{action}</div>,
    slot.actions,
  );

  if (inTopBar && !back && (actionsInTopBar || (!action && !tabs))) return <>{topBarTitle}{topBarActions}</>;

  return (
    <>
    {topBarTitle}
    {topBarActions}
    {/* Wraps instead of squeezing: the title keeps at least ~16rem and the
        actions drop to their own row when they don't fit beside it. */}
    <div className={cn('mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0 flex-1 basis-64">
        {back && (
          back === true ? (
            <button type="button" onClick={() => router.back()} className={backClassName}>
              <ArrowLeft size={15} />
              {backLabel}
            </button>
          ) : (
            <Link href={back} className={backClassName}>
              <ArrowLeft size={15} />
              {backLabel}
            </Link>
          )
        )}
        {!inTopBar && <h1 className="break-words text-2xl font-bold tracking-tight text-gray-950">{title}</h1>}
        {tabs && !actionsInTopBar && <div data-page-tabs className={cn(!inTopBar && 'mt-2')}>{tabs}</div>}
        {meta && !inTopBar && <div className="mt-3">{meta}</div>}
      </div>
      {action && !actionsInTopBar && (
        <div data-page-actions className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">
          {action}
        </div>
      )}
    </div>
    </>
  );
}
