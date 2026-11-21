'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { IconChip, type Tone } from '@/components/PresentationFoundation';
import { ChartCard } from '@/components/dashboard/ChartCard';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ExpensePlanRow, ExpensePlanSide } from '@/lib/calculations/expensePlans';
import { formatShare } from './analysisFormat';

/**
 * "+500 000 UZS over" in red, "100 000 UZS under" in green, or "on plan".
 * `signed` shows only "+500 000" / "−100 000", for narrow totals.
 */
function Difference({ difference, currency, signed = false, className }: {
  difference: number;
  currency: string;
  signed?: boolean;
  className?: string;
}) {
  const t = useTranslations('financialAnalysis');
  if (difference === 0) return <span className={cn('text-gray-500', className)}>{signed ? '0' : t('planOnTarget')}</span>;
  const over = difference > 0;
  const amount = formatCurrency(Math.abs(difference));
  return (
    <span className={cn('whitespace-nowrap tabular-nums', over ? 'text-danger-600' : 'text-success-600', className)}>
      {signed ? `${over ? '+' : '−'}${amount}` : t(over ? 'planOver' : 'planUnder', { amount, currency })}
    </span>
  );
}

function PlanRow({ row, currency, locale, href }: { row: ExpensePlanRow; currency: string; locale: string; href?: string }) {
  const t = useTranslations('financialAnalysis');
  const used = row.usedPct ?? (row.actual > 0 ? 100 : 0);
  const over = row.difference > 0;
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold text-gray-950">
          {row.preset.name}
          {row.preset.archived_at && <span className="ml-1.5 text-xs font-normal text-gray-500">{t('planArchived')}</span>}
        </span>
        <Difference difference={row.difference} currency={currency} className="text-xs font-semibold" />
      </div>
      <div
        className="my-1.5 h-2 overflow-hidden rounded-full bg-gray-100"
        role="meter"
        aria-label={row.preset.name}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.round(used))}
        aria-valuetext={formatShare(row.usedPct, locale)}
      >
        <div
          className={cn('h-full rounded-full', over ? 'bg-danger-500' : 'bg-primary-600')}
          style={{ width: `${Math.min(100, Math.max(0, used))}%` }}
        />
      </div>
      <p className="flex justify-between gap-3 text-xs text-gray-500">
        <span className="tabular-nums">
          {t('planSpentOf', { actual: formatCurrency(row.actual), planned: formatCurrency(row.planned), currency })}
        </span>
        <span className="tabular-nums">{formatShare(row.usedPct, locale)}</span>
      </p>
    </>
  );
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="-mx-2 block rounded-lg px-2 py-3 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 motion-reduce:transition-none"
        >
          {body}
        </Link>
      ) : (
        <div className="py-3">{body}</div>
      )}
    </li>
  );
}

/** Planned against actual spending for one side of the club; never combined with the other side. */
export function ExpensePlanPanel({ title, icon: Icon, accent = 'neutral', side, currency, locale, rowHref }: {
  title: string;
  icon: LucideIcon;
  /** Kept for call-site compatibility; the icon tile takes its colour from `accent`. */
  iconClassName?: string;
  /** Tone of the icon tile: the side's own (`primary` for the game club, `bar`). */
  accent?: Tone;
  side: ExpensePlanSide;
  currency: string;
  locale: string;
  /** Where a planned line opens: the expenses paid against it. */
  rowHref?: (row: ExpensePlanRow) => string;
}) {
  const t = useTranslations('financialAnalysis');
  return (
    <ChartCard
      title={title}
      action={<IconChip icon={Icon} tone={accent} size="sm" />}
    >
      <dl className="mt-3 grid grid-cols-3 gap-3 rounded-xl bg-gray-50 p-3 text-xs text-gray-500">
        <div>
          <dt>{t('planPlanned')}</dt>
          <dd className="mt-0.5 whitespace-nowrap text-sm font-semibold tabular-nums text-gray-950">{formatCurrency(side.planned)}</dd>
        </div>
        <div>
          <dt>{t('planActual')}</dt>
          <dd className="mt-0.5 whitespace-nowrap text-sm font-semibold tabular-nums text-gray-950">{formatCurrency(side.actual)}</dd>
        </div>
        <div>
          <dt>{t('planDifference')}</dt>
          <dd className="mt-0.5 text-sm font-semibold">
            <Difference difference={side.difference} currency={currency} signed />
          </dd>
        </div>
      </dl>
      <ul className="mt-1 divide-y divide-gray-100">
        {side.rows.map((row) => <PlanRow key={row.preset.id} row={row} currency={currency} locale={locale} href={rowHref?.(row)} />)}
      </ul>
    </ChartCard>
  );
}
