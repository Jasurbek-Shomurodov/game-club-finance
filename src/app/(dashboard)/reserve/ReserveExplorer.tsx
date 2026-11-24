'use client';

import { useRef } from 'react';
import { ChevronLeft, ChevronRight, ListFilter, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, IconButton, StatTile, metricToneClassName, type MetricTone } from '@/components/PresentationFoundation';
import { BalanceFlowChart, type BalanceFlowRow } from '@/components/charts/BalanceFlowChart';
import {
  reserveWindowSummary,
  type ReserveBucket,
  type ReserveExplorerSeries,
  type ReservePeriod,
} from '@/lib/calculations/reserveExplorer';
import {
  capitalizeFirst,
  formatCurrency,
  formatDateOnly,
  formatDateRange,
  formatDateShort,
  formatMonthShort,
  formatYearMonth,
} from '@/lib/formatters';
import { cn } from '@/lib/utils';

/** A signed amount: "+200 000", "−50 000" (the formatter carries the minus), "0". */
const signed = (amount: number) => (amount > 0 ? `+${formatCurrency(amount)}` : formatCurrency(amount));
const changeTone = (amount: number): MetricTone => (amount > 0 ? 'success' : amount < 0 ? 'danger' : 'default');

/**
 * The reserve over a chosen period: a readout of the selected day, week or
 * month (or of the whole period when nothing is selected) over the balance and
 * in/out chart. The readout opens the history narrowed to those dates.
 */
export function ReserveExplorer({ series, period, selectedKey, onSelect, onOpenEntries, currency, locale }: {
  series: ReserveExplorerSeries;
  period: ReservePeriod;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** Opens the history for these dates; null for all of it. */
  onOpenEntries: (range: { from: string; to: string } | null) => void;
  currency: string;
  locale: string;
}) {
  const t = useTranslations('reservePage');
  const { unit, buckets } = series;
  const summary = reserveWindowSummary(series);
  const index = buckets.findIndex((bucket) => bucket.key === selectedKey);
  const selected = index === -1 ? null : buckets[index];
  const plotRef = useRef<HTMLDivElement>(null);
  const atFirst = index <= 0;
  const atLast = index >= buckets.length - 1;

  const bucketTitle = (bucket: ReserveBucket) => (
    unit === 'day'
      ? formatDateOnly(bucket.from, locale)
      : unit === 'week'
        ? formatDateRange(bucket.from, bucket.to, locale, { year: true })
        : capitalizeFirst(formatYearMonth(bucket.from.slice(0, 7), locale), locale)
  );
  const rows: BalanceFlowRow[] = buckets.map((bucket) => ({
    key: bucket.key,
    label: unit === 'month' ? formatMonthShort(bucket.from, locale) : formatDateShort(bucket.from, locale),
    tooltipLabel: bucketTitle(bucket),
    held: bucket.held,
    income: bucket.deposited,
    expenses: bucket.withdrawn,
  }));

  const money = (amount: number) => `${formatCurrency(amount)} ${currency}`;
  const periodName = t(`periodName.${period}`);
  const windowRange = series.from ? formatDateRange(series.from, series.to, locale, { year: true }) : '';
  const count = selected ? selected.count : summary.count;
  const periodSummary = t('explorer.summary', { period: periodName, held: money(summary.held), change: `${signed(summary.change)} ${currency}` });
  // What a screen reader hears as the selection steps: the bucket and its figures.
  const announcement = selected
    ? t('explorer.selectedSummary', { title: bucketTitle(selected), held: money(selected.held), putIn: money(selected.deposited), takenOut: money(selected.withdrawn) })
    : periodSummary;
  const openEntries = () => {
    if (selected) onOpenEntries({ from: selected.from, to: selected.to });
    else onOpenEntries(period === 'all' || !series.from ? null : { from: series.from, to: series.to });
  };

  // The same three figures in both states: the bucket's, or the whole period's.
  const shown = selected ?? summary;
  const figures: Array<{ key: string; label: string; amount: number; tone: MetricTone }> = [
    { key: 'held', label: selected ? t('explorer.heldAtEnd') : t('explorer.heldNow'), amount: shown.held, tone: 'default' },
    { key: 'in', label: t('putIn'), amount: shown.deposited, tone: shown.deposited > 0 ? 'success' : 'default' },
    { key: 'out', label: t('takenOut'), amount: shown.withdrawn, tone: shown.withdrawn > 0 ? 'danger' : 'default' },
  ];

  // One structure with fixed heights in both states, so selecting, stepping or
  // clearing never moves the chart under the finger: a 36px title row (the
  // step buttons, or the hint in their place), a sub line held at two lines on
  // a phone, three figures, and a 36px row for the entries button or its empty text.
  return (
    <div className="space-y-4">
      {/* The readout: what the selected bucket (or the period) held and moved. */}
      <div className="space-y-2 rounded-xl bg-gray-50 p-3 sm:space-y-3 sm:p-4">
        <div>
          <div className="flex min-h-9 items-center gap-2">
            <p className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-semibold leading-tight text-gray-950">{selected ? bucketTitle(selected) : periodName}</p>
            {selected ? (
              <div className="-my-1 flex shrink-0 items-center">
                <IconButton
                  variant="ghost"
                  size="lg"
                  label={t('explorer.previous')}
                  icon={<ChevronLeft size={18} aria-hidden="true" />}
                  // Stays focusable at the ends, so focus is not lost mid-step.
                  aria-disabled={atFirst || undefined}
                  onClick={() => { if (!atFirst) onSelect(buckets[index - 1].key); }}
                />
                <IconButton
                  variant="ghost"
                  size="lg"
                  label={t('explorer.next')}
                  icon={<ChevronRight size={18} aria-hidden="true" />}
                  aria-disabled={atLast || undefined}
                  onClick={() => { if (!atLast) onSelect(buckets[index + 1].key); }}
                />
                <IconButton
                  variant="ghost"
                  size="lg"
                  label={t('explorer.clear')}
                  icon={<X size={18} aria-hidden="true" />}
                  onClick={() => {
                    // This button goes with the selection; focus returns to the chart it came from.
                    plotRef.current?.focus();
                    onSelect(null);
                  }}
                />
              </div>
            ) : (
              // Where the step buttons go once a column is picked: no extra line in either state.
              <p className="line-clamp-2 max-w-[50%] shrink-0 text-right text-xs leading-4 text-gray-500">{t('explorer.hint', { unit })}</p>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-gray-500 max-sm:min-h-8">
            {selected ? `${periodName} · ${windowRange}` : (
              <>
                {windowRange} ·{' '}
                <span className="whitespace-nowrap">
                  {t('explorer.change')}{' '}
                  <span className={cn('font-semibold tabular-nums', metricToneClassName[changeTone(summary.change)])}>{signed(summary.change)} {currency}</span>
                </span>
              </>
            )}
          </p>
        </div>
        {/* Plain figures: "Show N entries" below is what opens the records behind them. */}
        {/* A phone reads them as three short lines; a wider screen as three tiles in a row. */}
        <dl className="sm:hidden">
          {figures.map((figure) => (
            <div key={figure.key} className="flex items-baseline justify-between gap-3 leading-5">
              <dt className="min-w-0 truncate text-xs font-medium text-gray-500">{figure.label}</dt>
              <dd className={cn('shrink-0 whitespace-nowrap text-sm font-bold tabular-nums', metricToneClassName[figure.tone])}>
                {formatCurrency(figure.amount)}
                <span className="ml-1 text-xs font-medium text-gray-500">{currency}</span>
              </dd>
            </div>
          ))}
        </dl>
        <div className="hidden gap-2 sm:grid sm:grid-cols-3">
          {figures.map((figure) => (
            <StatTile key={figure.key} variant="card" size="sm" label={figure.label} value={formatCurrency(figure.amount)} unit={currency} tone={figure.tone} />
          ))}
        </div>
        <div className="flex min-h-9 items-center">
          {count > 0 ? (
            <Button variant="outline" size="sm" onClick={openEntries} icon={<ListFilter size={15} aria-hidden="true" />}>
              {t('explorer.showEntries', { count })}
            </Button>
          ) : (
            <p className="text-xs text-gray-500">{t('explorer.noEntries')}</p>
          )}
        </div>
        <p className="sr-only" aria-live="polite">{announcement}</p>
      </div>
      <BalanceFlowChart
        rows={rows}
        selectedKey={selected?.key ?? null}
        onSelect={onSelect}
        heldLabel={t('explorer.heldAtEnd')}
        incomeLabel={t('putIn')}
        expensesLabel={t('takenOut')}
        legendLabel={t('flowTitle')}
        summary={periodSummary}
        plotRef={plotRef}
        currency={currency}
        locale={locale}
      />
    </div>
  );
}
