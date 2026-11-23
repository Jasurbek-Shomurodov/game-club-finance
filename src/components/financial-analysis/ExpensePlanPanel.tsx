'use client';

import { Plus, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, CategoryIcon, IconChip, TappableSurface, type Tone } from '@/components/PresentationFoundation';
import { ChartCard } from '@/components/dashboard/ChartCard';
import { formatCurrency, formatDateShort } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ExpensePlanRow, ExpensePlanSide } from '@/lib/calculations/expensePlans';
import type { PlanSuggestion, UpcomingPayment, UpcomingSide } from '@/lib/calculations/upcomingPayments';
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

/**
 * Where a plan stands this month: paid, overdue, due around its usual day, or
 * still to pay when it has no usual day yet (then never overdue).
 */
function DueState({ row, upcoming, locale }: { row: ExpensePlanRow; upcoming: UpcomingPayment; locale: string }) {
  const t = useTranslations('financialAnalysis');
  if (!(row.planned > 0)) return null;
  const [label, tone] = upcoming.remaining === 0
    ? [t('planPaid'), 'text-success-600']
    : upcoming.overdue && upcoming.dueDate
      ? [t('planOverdue', { date: formatDateShort(upcoming.dueDate, locale) }), 'text-danger-600']
      : upcoming.dueDate
        ? [t('planDueAround', { date: formatDateShort(upcoming.dueDate, locale) }), 'text-gray-500']
        : [t('planNotPaidYet'), 'text-gray-500'];
  return <p className={cn('mt-0.5 text-xs font-medium', tone)}>{label}</p>;
}

function PlanRow({ row, upcoming, currency, locale, href }: {
  row: ExpensePlanRow;
  upcoming?: UpcomingPayment;
  currency: string;
  locale: string;
  href?: string;
}) {
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
      {upcoming && <DueState row={row} upcoming={upcoming} locale={locale} />}
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

/**
 * A regular expense with no plan: its records open in Reports, and an owner
 * can turn it into a plan with the plan form, prefilled.
 */
function SuggestionRow({ suggestion, label, currency, href, onAdd }: {
  suggestion: PlanSuggestion;
  label: string;
  currency: string;
  href?: string;
  onAdd?: () => void;
}) {
  const t = useTranslations('financialAnalysis');
  const values = { amount: formatCurrency(suggestion.typicalAmount), currency, months: suggestion.months, day: suggestion.usualDay ?? 0 };
  return (
    <li className="flex items-center gap-2 py-2">
      <TappableSurface href={href} chevron={false} className="-mx-2 min-w-0 flex-1 rounded-lg px-2 py-1.5 hover:bg-gray-50">
        <div className="flex items-center gap-3">
          <CategoryIcon category={suggestion.category} tone={suggestion.side === 'bar' ? 'bar' : 'expense'} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-950">{label}</p>
            <p className="text-xs text-gray-500">
              {suggestion.usualDay === null ? t('planSuggestionLine', values) : t('planSuggestionLineDay', values)}
            </p>
          </div>
        </div>
      </TappableSurface>
      {onAdd && (
        <Button
          size="sm"
          variant="outline"
          icon={<Plus size={15} aria-hidden="true" />}
          aria-label={t('planSuggestionAddLabel', { category: label })}
          onClick={onAdd}
        >
          {t('planSuggestionAdd')}
        </Button>
      )}
    </li>
  );
}

/**
 * Planned against actual spending for one side of the club; never combined
 * with the other side. In the current month each plan shows whether it is
 * paid or when it is due, and the side shows what is still due. Regular
 * expenses without a plan are listed under the plans.
 */
export function ExpensePlanPanel({ title, icon: Icon, accent = 'neutral', side, upcoming, suggestions = [], suggestionLabel, suggestionHref, onSuggest, currency, locale, rowHref }: {
  title: string;
  icon: LucideIcon;
  /** Kept for call-site compatibility; the icon tile takes its colour from `accent`. */
  iconClassName?: string;
  /** Tone of the icon tile: the side's own (`primary` for the game club, `bar`). */
  accent?: Tone;
  side: ExpensePlanSide;
  /** The current business month's due state; absent for a past month. */
  upcoming?: UpcomingSide;
  /** Regular expenses of this side with no plan. */
  suggestions?: PlanSuggestion[];
  suggestionLabel?: (suggestion: PlanSuggestion) => string;
  /** Where a suggestion's records open; absent when the member cannot open them. */
  suggestionHref?: (suggestion: PlanSuggestion) => string | undefined;
  /** Opens the plan form prefilled; absent for a member who cannot add plans. */
  onSuggest?: (suggestion: PlanSuggestion) => void;
  currency: string;
  locale: string;
  /** Where a planned line opens: the expenses paid against it. */
  rowHref?: (row: ExpensePlanRow) => string;
}) {
  const t = useTranslations('financialAnalysis');
  const dueByPreset = new Map(upcoming?.rows.map((row) => [row.preset.id, row]));
  return (
    <ChartCard
      title={title}
      action={<IconChip icon={Icon} tone={accent} size="sm" />}
    >
      {side.rows.length > 0 && (
        <>
          <dl className={cn('mt-3 grid gap-3 rounded-xl bg-gray-50 p-3 text-xs text-gray-500', upcoming ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
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
            {upcoming && (
              <div>
                <dt>{t('planStillDue')}</dt>
                <dd className="mt-0.5 whitespace-nowrap text-sm font-semibold tabular-nums text-gray-950">{formatCurrency(upcoming.remaining)}</dd>
              </div>
            )}
          </dl>
          <ul className="mt-1 divide-y divide-gray-100">
            {side.rows.map((row) => (
              <PlanRow
                key={row.preset.id}
                row={row}
                upcoming={dueByPreset.get(row.preset.id)}
                currency={currency}
                locale={locale}
                href={rowHref?.(row)}
              />
            ))}
          </ul>
        </>
      )}
      {suggestions.length > 0 && (
        <div className={cn(side.rows.length > 0 ? 'mt-2 border-t border-gray-100 pt-3' : 'mt-3')}>
          <p className="text-xs font-medium text-gray-500">{t('planSuggestionsTitle')}</p>
          <ul className="mt-1 divide-y divide-gray-100">
            {suggestions.map((suggestion) => (
              <SuggestionRow
                key={`${suggestion.side}:${suggestion.category}`}
                suggestion={suggestion}
                label={suggestionLabel?.(suggestion) ?? suggestion.category}
                currency={currency}
                href={suggestionHref?.(suggestion)}
                onAdd={onSuggest ? () => onSuggest(suggestion) : undefined}
              />
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}
