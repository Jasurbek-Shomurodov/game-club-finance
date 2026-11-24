'use client';

import { useRef } from 'react';
import { ChevronLeft, ChevronRight, ListFilter, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, IconButton, StatTile, type MetricTone } from '@/components/PresentationFoundation';
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

  return (
    <div className="space-y-4">
      {/* The readout: what the selected bucket (or the period) held and moved. */}
      <div className="space-y-3 rounded-xl bg-gray-50 p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="sr-only" aria-live="polite">{announcement}</p>
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-semibold text-gray-950">{selected ? bucketTitle(selected) : periodName}</p>
            <p className="mt-0.5 text-xs leading-5 text-gray-500">{selected ? periodName : `${windowRange} · ${t('explorer.hint', { unit })}`}</p>
          </div>
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
          ) : null}
        </div>
        {/* Plain figures: "Show N entries" below is what opens the records behind them. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {selected ? (
            <>
              <StatTile variant="card" size="sm" className="col-span-2 sm:col-span-1" label={t('explorer.heldAtEnd')} value={formatCurrency(selected.held)} unit={currency} />
              <StatTile variant="card" size="sm" label={t('putIn')} value={formatCurrency(selected.deposited)} unit={currency} tone={selected.deposited > 0 ? 'success' : 'default'} />
              <StatTile variant="card" size="sm" label={t('takenOut')} value={formatCurrency(selected.withdrawn)} unit={currency} tone={selected.withdrawn > 0 ? 'danger' : 'default'} />
            </>
          ) : (
            <>
              <StatTile variant="card" size="sm" label={t('explorer.heldNow')} value={formatCurrency(summary.held)} unit={currency} />
              <StatTile variant="card" size="sm" label={t('explorer.change')} value={signed(summary.change)} unit={currency} tone={changeTone(summary.change)} />
            </>
          )}
        </div>
        {count > 0 ? (
          <Button variant="outline" size="sm" onClick={openEntries} icon={<ListFilter size={15} aria-hidden="true" />}>
            {t('explorer.showEntries', { count })}
          </Button>
        ) : (
          <p className="text-xs text-gray-500">{t('explorer.noEntries')}</p>
        )}
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
