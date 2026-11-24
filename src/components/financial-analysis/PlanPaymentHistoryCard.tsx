'use client';

import { History } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  DataTable,
  IconChip,
  Skeleton,
  TappableSurface,
  toneClasses,
  type DataTableColumn,
  type Tone,
} from '@/components/PresentationFoundation';
import { HeadingSkeleton, SkeletonCard } from '@/components/charts/ChartSkeletons';
import { ChartCard } from '@/components/dashboard/ChartCard';
import { capitalizeFirst, formatCurrency, formatMonthShort, formatYearMonth } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import {
  PLAN_HISTORY_MONTHS,
  type PlanHistoryCell,
  type PlanHistoryRow,
  type PlanPaymentHistory,
} from '@/lib/calculations/planPaymentHistory';
import { formatCompactAmount } from './analysisFormat';

/** The table bleeds to the card's edges, so its outer cells take the card's padding. */
const FIRST_CELL = 'pl-4 sm:pl-5';
const LAST_CELL = 'pr-4 sm:pr-5';
const MONTH_CELL = 'w-px whitespace-nowrap px-1 sm:px-1.5';
const PILL = 'ml-auto whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums';

const sideTone = (row: PlanHistoryRow): Tone => (row.preset.payment_source === 'bar' ? 'bar' : 'primary');

/**
 * What was paid against one plan in one month: a short amount in the side's
 * tone that opens the month's payments, or a muted dash when nothing was paid
 * (never red: a plan may simply be newer than the month).
 */
function PaidCell({ row, cell, href, currency, locale }: {
  row: PlanHistoryRow;
  cell: PlanHistoryCell;
  href?: string;
  currency: string;
  locale: string;
}) {
  const t = useTranslations('financialAnalysis');
  const name = row.preset.name;
  const month = formatYearMonth(cell.month, locale);
  if (!(cell.paid > 0)) {
    return (
      <>
        <span aria-hidden="true" className="text-gray-300">—</span>
        <span className="sr-only">{t('planHistoryNothingPaid', { name, month })}</span>
      </>
    );
  }
  const compact = formatCompactAmount(cell.paid, locale, {
    thousand: (value) => t('planHistoryThousand', { value }),
    million: (value) => t('planHistoryMillion', { value }),
  });
  const label = t('planHistoryCellLabel', { name, month, amount: formatCurrency(cell.paid), currency });
  const className = cn(PILL, toneClasses[sideTone(row)].chip);
  if (href) {
    return (
      <TappableSurface href={href} fit chevron={false} label={label} className={className}>
        {compact}
      </TappableSurface>
    );
  }
  return (
    <span className={cn('inline-block', className)}>
      <span aria-hidden="true">{compact}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Payment history of the planned expenses: one row per plan, one column per
 * month of the last six (the selected month last), each cell what was paid
 * against the plan that month. Game club and bar plans sit under their own
 * subheading when both have plans; they are never added together.
 */
export function PlanPaymentHistoryCard({ history, sideTitles, cellHref, currency, locale, className }: {
  history: PlanPaymentHistory;
  /** Subheadings used when both sides have plans. */
  sideTitles: { gameClub: string; bar: string };
  /** Where a paid cell opens: the month's payments of the plan's category and side. Absent when the member cannot open them. */
  cellHref?: (row: PlanHistoryRow, cell: PlanHistoryCell) => string | undefined;
  currency: string;
  locale: string;
  className?: string;
}) {
  const t = useTranslations('financialAnalysis');
  const selectedMonth = history.months[history.months.length - 1];
  const rows = [...history.gameClub.rows, ...history.bar.rows];
  const bothSides = history.gameClub.rows.length > 0 && history.bar.rows.length > 0;

  const columns: DataTableColumn<PlanHistoryRow>[] = [
    {
      key: 'plan',
      header: t('planHistoryPlan'),
      sticky: true,
      className: FIRST_CELL,
      render: (row) => (
        <div className="max-w-[7rem] sm:max-w-[14rem]">
          <p className="truncate text-sm font-semibold text-gray-950" title={row.preset.name}>
            {row.preset.name}
            {row.preset.archived_at && <span className="ml-1.5 text-xs font-normal text-gray-500">{t('planArchived')}</span>}
          </p>
          <p className="whitespace-nowrap text-xs text-gray-500">
            {t('planHistoryPaidMonths', { paid: row.paidMonths, total: PLAN_HISTORY_MONTHS })}
          </p>
        </div>
      ),
    },
    ...history.months.map((month, index): DataTableColumn<PlanHistoryRow> => ({
      key: month,
      align: 'right',
      className: cn(MONTH_CELL, index === history.months.length - 1 && LAST_CELL),
      header: (
        <span className={cn(month === selectedMonth && 'font-semibold text-gray-950')}>
          {capitalizeFirst(formatMonthShort(month, locale), locale)}
        </span>
      ),
      render: (row) => {
        const cell = row.cells[index];
        return (
          <PaidCell
            row={row}
            cell={cell}
            href={cell.paid > 0 ? cellHref?.(row, cell) : undefined}
            currency={currency}
            locale={locale}
          />
        );
      },
    })),
  ];

  return (
    <ChartCard
      title={t('planHistoryTitle')}
      description={t('planHistoryDesc')}
      action={<IconChip icon={History} tone="neutral" size="sm" />}
      className={className}
    >
      <DataTable
        className="-mx-4 mt-3 sm:-mx-5"
        columns={columns}
        data={rows}
        keyExtractor={(row) => row.preset.id}
        groups={bothSides ? [
          { key: 'game_club', header: sideTitles.gameClub, rows: history.gameClub.rows, className: cn(FIRST_CELL, LAST_CELL) },
          { key: 'bar', header: sideTitles.bar, rows: history.bar.rows, className: cn(FIRST_CELL, LAST_CELL) },
        ] : undefined}
        minWidth={0}
        label={t('planHistoryTitle')}
        bare
        dense
      />
    </ChartCard>
  );
}

/** The payment history card while it loads: heading, the month header and a few plan rows. */
export function PlanPaymentHistoryCardSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  const cells = Array.from({ length: PLAN_HISTORY_MONTHS }, (_, index) => index);
  return (
    <SkeletonCard className={className}>
      <div className="flex items-start gap-4">
        <HeadingSkeleton className="flex-1" />
        <Skeleton className="h-7 w-7 shrink-0 rounded-lg" />
      </div>
      <div className="mt-4 space-y-3" aria-hidden="true">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-3 w-12 bg-gray-100" />
          <div className="flex gap-2">
            {cells.map((cell) => <Skeleton key={cell} className="h-3 w-7 bg-gray-100" />)}
          </div>
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <Skeleton className="h-3 w-24 max-w-full" />
              <Skeleton className="h-3 w-20 max-w-full bg-gray-100" />
            </div>
            <div className="flex gap-2">
              {cells.map((cell) => <Skeleton key={cell} className="h-5 w-7 rounded-md" />)}
            </div>
          </div>
        ))}
      </div>
    </SkeletonCard>
  );
}
