'use client';

// Shared breakdown page for /bar-money-details and /game-club-money-details.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, RefreshCcw } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Badge,
  Button,
  Card,
  DateRangePicker,
  DetailListSkeleton,
  EmptyState,
  InlineAlert,
  MetricCard,
  Money,
  PageHeader,
  SectionHeading,
} from '@/components/PresentationFoundation';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { cn, todayIso } from '@/lib/utils';

/** Collected-money buckets; translated at render time so language changes never refetch. */
export type MoneyDetailCollectedKey = 'barSales' | 'cash' | 'terminal' | 'card' | 'playstation' | 'debtPayments';

export type MoneyDetailLine =
  | {
      kind: 'purchase';
      /** Product name, or the purchase comment when the product is gone. */
      name: string | null;
      quantity: number;
      amount: number;
    }
  | {
      kind: 'expense';
      /** Stored expense category: a known category key or custom text. */
      category: string;
      comment: string | null;
      amount: number;
    };

export interface MoneyDetailRow {
  date: string;
  /** Positive contributions, shown on the left. */
  collected: Array<{ key: MoneyDetailCollectedKey; amount: number }>;
  collectedTotal: number;
  deductions: MoneyDetailLine[];
  deductionsTotal: number;
  moneyLeft: number;
}

export interface MoneyDetailsPageProps {
  variant: 'bar' | 'gameClub';
  requestedFrom?: string;
  requestedTo?: string;
  /** Loads rows for a club and range; must resolve with rows sorted by date. */
  loadRows: (clubId: string, from: string, to: string) => Promise<MoneyDetailRow[]>;
  labels: {
    title: string;
    resultLabel: string;
    resultDescription: string;
    collectedLabel: string;
    deductionsLabel: string;
    deductionsHint?: string;
    emptyLabel: string;
  };
}

function validDate(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function inRangeQuery<T extends { gte: (column: string, value: string) => T; lte: (column: string, value: string) => T }>(
  query: T,
  from: string,
  to: string,
): T {
  return query.gte('date', from).lte('date', to);
}

export default function MoneyDetailsPage({ variant, requestedFrom, requestedTo, loadRows, labels }: MoneyDetailsPageProps) {
  const pathname = usePathname();
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const te = useTranslations('expenses');
  const { locale } = useAppLocale();
  const { selectedClubId, businessDayStartHour } = useClub();
  const fallbackDate = useMemo(() => todayIso(new Date(), businessDayStartHour), [businessDayStartHour]);
  const requested = useMemo(() => {
    const from = validDate(requestedFrom) ? requestedFrom : fallbackDate;
    const to = validDate(requestedTo) ? requestedTo : fallbackDate;
    return from <= to ? { from, to } : { from: to, to: from };
  }, [fallbackDate, requestedFrom, requestedTo]);
  const [range, setRange] = useState(requested);
  const [rows, setRows] = useState<MoneyDetailRow[]>([]);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    setRange(requested);
  }, [requested]);

  const fetchDetails = useCallback(async (isCurrent: () => boolean) => {
    if (!selectedClubId) {
      setRows([]);
      setError(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(false);
    try {
      const next = await loadRows(selectedClubId, range.from, range.to);
      if (!isCurrent()) return;
      setRows(next);
    } catch {
      if (!isCurrent()) return;
      setError(true);
      setRows([]);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [loadRows, range.from, range.to, selectedClubId]);

  useEffect(() => {
    let cancelled = false;
    void fetchDetails(() => !cancelled);
    return () => { cancelled = true; };
  }, [fetchDetails, reloadToken]);

  function updateRange(next: { from: string; to: string }) {
    setRange(next);
    // Keep the URL shareable without a server round-trip (same as the dashboard).
    const params = new URLSearchParams({ from: next.from, to: next.to });
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
  }

  const backHref = `/?${new URLSearchParams({ from: range.from, to: range.to }).toString()}`;

  const totals = rows.reduce(
    (sum, row) => ({
      collected: sum.collected + row.collectedTotal,
      deductions: sum.deductions + row.deductionsTotal,
      moneyLeft: sum.moneyLeft + row.moneyLeft,
    }),
    { collected: 0, deductions: 0, moneyLeft: 0 },
  );
  const allRowsExpanded = rows.length > 0 && rows.every((row) => expandedDates.has(row.date));

  function toggleDate(date: string) {
    setExpandedDates((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  function toggleAllDates() {
    setExpandedDates(allRowsExpanded ? new Set() : new Set(rows.map((row) => row.date)));
  }

  function collectedLabel(key: MoneyDetailCollectedKey): string {
    switch (key) {
      case 'barSales': return t('barSales');
      case 'cash': return t('cash');
      case 'terminal': return t('terminal');
      case 'card': return t('card');
      case 'playstation': return t('playstation');
      case 'debtPayments': return t('debtPaymentsCollected');
    }
  }

  function expenseCategoryLabel(category: string): string {
    const key = `categories.${category}`;
    return te.has(key) ? te(key as Parameters<typeof te>[0]) : category.replace(/_/g, ' ');
  }

  function deductionLabel(line: MoneyDetailLine): string {
    if (line.kind === 'purchase') return `${line.name ?? '—'} × ${formatNumber(line.quantity)}`;
    const category = expenseCategoryLabel(line.category);
    return line.comment ? `${category}: ${line.comment}` : category;
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        back={backHref}
        backLabel={t('backToDashboard')}
        title={labels.title}
        className="mb-0"
        action={(
          <DateRangePicker
            from={range.from}
            to={range.to}
            fromLabel={t('from')}
            toLabel={t('to')}
            max={fallbackDate}
            onChange={updateRange}
            className="sm:w-80"
          />
        )}
      />

      {error ? (
        <InlineAlert
          variant="danger"
          action={(
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => setReloadToken((token) => token + 1)}
              icon={<RefreshCcw size={15} aria-hidden="true" />}
            >
              {tc('retry')}
            </Button>
          )}
        >
          {t('loadError')}
        </InlineAlert>
      ) : null}

      {loading ? (
        <DetailListSkeleton />
      ) : error ? null : rows.length === 0 ? (
        <Card><EmptyState icon={CalendarDays} title={labels.emptyLabel} /></Card>
      ) : (
        <>
          {/* One headline number, then the two figures it is made of. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Card as="section" className="sm:col-span-2 lg:col-span-1" aria-label={labels.resultLabel}>
              <p className="text-[13px] font-medium text-gray-500">{labels.resultLabel}</p>
              <p className={cn('mt-2 break-words text-3xl font-bold leading-none tracking-tight tabular-nums sm:text-4xl', totals.moneyLeft < 0 ? 'text-danger-600' : 'text-success-600')}>
                <Money amount={totals.moneyLeft} currencyClassName="text-base text-gray-500" />
              </p>
              <p className="mt-3 text-xs leading-5 text-gray-500">
                {labels.resultDescription} · {formatDateShort(range.from, locale)} – {formatDateShort(range.to, locale)}
              </p>
            </Card>
            <MetricCard
              label={labels.collectedLabel}
              tone="success"
              value={<Money amount={totals.collected} currencyClassName="text-sm text-gray-500" />}
            />
            <MetricCard
              label={labels.deductionsLabel}
              tone="danger"
              helper={labels.deductionsHint}
              value={<Money amount={totals.deductions} currencyClassName="text-sm text-gray-500" />}
            />
          </div>

          <section className="space-y-3">
            <SectionHeading
              size="sm"
              title={t('date')}
              className="sm:items-center"
              action={(
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleAllDates}
                  aria-expanded={allRowsExpanded}
                  iconRight={<ChevronDown size={15} className={cn('transition-transform', allRowsExpanded && 'rotate-180')} aria-hidden="true" />}
                >
                  {allRowsExpanded ? t('collapseAll') : t('expandAll')}
                </Button>
              )}
            />

            {rows.map((row) => (
              <details key={row.date} open={expandedDates.has(row.date)} className="group overflow-hidden rounded-2xl border border-gray-200 bg-surface shadow-card">
                <summary
                  onClick={(event) => { event.preventDefault(); toggleDate(row.date); }}
                  className="flex cursor-pointer list-none flex-col gap-2 px-4 py-3 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 sm:flex-row sm:items-center sm:justify-between sm:px-5 [&::-webkit-details-marker]:hidden"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <ChevronDown size={16} className="shrink-0 text-gray-400 transition-transform group-open:rotate-180" aria-hidden="true" />
                    <span className="text-sm font-semibold text-gray-950">{formatDateShort(row.date, locale)}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 sm:justify-end">
                    <span className="text-xs font-medium text-gray-500">{t('moneyLeftForDay')}</span>
                    <Money
                      amount={row.moneyLeft}
                      className={cn('text-base font-bold tracking-tight', row.moneyLeft < 0 ? 'text-danger-600' : 'text-success-600')}
                      currencyClassName="text-xs text-gray-500"
                    />
                  </div>
                </summary>

                <div className={cn('grid border-t border-gray-100', variant === 'bar' ? 'lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]' : 'lg:grid-cols-2')}>
                  <section className="p-4 sm:p-5 lg:border-r lg:border-gray-100">
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{labels.collectedLabel}</h3>
                      <Money amount={row.collectedTotal} showPlus className="text-sm font-semibold text-success-600" currencyClassName="text-xs text-gray-500" />
                    </div>
                    <dl className="divide-y divide-gray-100">
                      {row.collected.map((item) => (
                        <div key={item.key} className="flex items-baseline justify-between gap-3 py-2">
                          <dt className="min-w-0 break-words text-sm text-gray-700">{collectedLabel(item.key)}</dt>
                          <dd className="shrink-0 text-sm font-semibold text-gray-950">
                            <Money amount={item.amount} currencyClassName="text-xs text-gray-500" />
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>

                  <section className="border-t border-gray-100 p-4 sm:p-5 lg:border-t-0">
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{labels.deductionsLabel}</h3>
                      <span className="text-sm font-semibold text-danger-600">− <Money amount={row.deductionsTotal} currencyClassName="text-xs text-gray-500" /></span>
                    </div>
                    {row.deductions.length ? (
                      <ul className="divide-y divide-gray-100">
                        {row.deductions.map((line, index) => (
                          <li key={`${line.kind}-${index}`} className="flex items-baseline justify-between gap-3 py-2">
                            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                              {variant === 'bar' && (
                                <Badge variant="neutral" size="sm">
                                  {line.kind === 'purchase' ? t('stockPurchase') : t('expense')}
                                </Badge>
                              )}
                              <span className="min-w-0 break-words text-sm leading-5 text-gray-700">{deductionLabel(line)}</span>
                            </div>
                            <span className="shrink-0 text-sm font-semibold text-danger-600">− <Money amount={line.amount} currencyClassName="text-xs text-gray-500" /></span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState compact bordered title={t('noDeductionsForDay')} className="border-gray-200 py-5" />
                    )}
                  </section>
                </div>
              </details>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
