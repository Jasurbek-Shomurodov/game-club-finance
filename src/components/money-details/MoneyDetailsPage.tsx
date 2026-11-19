'use client';

// Shared breakdown page for /bar-money-details and /game-club-money-details.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Gamepad2,
  HandCoins,
  Package,
  PiggyBank,
  Receipt,
  Sigma,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wallet,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Button,
  Card,
  DateRangePicker,
  DetailListSkeleton,
  EmptyState,
  LoadErrorAlert,
  Money,
  PageHeader,
  SectionHeading,
} from '@/components/PresentationFoundation';
import { SIDE_ICONS } from '@/components/sideIcons';
import { formatDateShort, formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { moneyDetailLineHref } from '@/lib/detailLinks';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useClubQuery } from '@/lib/useClubQuery';
import { sharePercent, summarizeMoneyDetailRows } from '@/lib/calculations/moneyDetailsSummary';
import type { MoneyDetailCollectedKey, MoneyDetailLine, MoneyDetailRow } from '@/lib/calculations/moneyDetails';
import { DASHBOARD_PATH } from '@/lib/routes';

export type { MoneyDetailCollectedKey, MoneyDetailLine, MoneyDetailRow } from '@/lib/calculations/moneyDetails';

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

const COLLECTED_ICONS: Record<MoneyDetailCollectedKey, LucideIcon> = {
  barSales: SIDE_ICONS.bar,
  cash: Banknote,
  terminal: CreditCard,
  card: WalletCards,
  playstation: Gamepad2,
  debtPayments: HandCoins,
};

const DEDUCTION_ICONS: Record<MoneyDetailLine['kind'], LucideIcon> = {
  purchase: Package,
  expense: Receipt,
  reserve: PiggyBank,
};

// Indexed by Date.getDay() (Sunday = 0); labels come from `calendar.weekdays`.
const WEEKDAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

function weekdayKey(isoDate: string) {
  return WEEKDAY_KEYS[new Date(`${isoDate}T00:00:00`).getDay()];
}

function dayAnchorId(date: string) {
  return `money-day-${date}`;
}

type ChipTone = 'success' | 'danger' | 'primary' | 'neutral';

const chipToneClassName: Record<ChipTone, string> = {
  success: 'bg-success-50 text-success-600 ring-success-100',
  danger: 'bg-danger-50 text-danger-600 ring-danger-100',
  primary: 'bg-primary-50 text-primary-700 ring-primary-100',
  neutral: 'bg-gray-100 text-gray-600 ring-gray-200',
};

/** Tinted rounded square holding an icon; colour carries the money direction. */
function IconChip({ icon: Icon, tone, size = 'md' }: { icon: LucideIcon; tone: ChipTone; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center ring-1 ring-inset',
        size === 'md' ? 'h-9 w-9 rounded-xl' : 'h-7 w-7 rounded-lg',
        chipToneClassName[tone],
      )}
    >
      <Icon size={size === 'md' ? 17 : 14} strokeWidth={2.2} />
    </span>
  );
}

export default function MoneyDetailsPage({ variant, requestedFrom, requestedTo, loadRows, labels }: MoneyDetailsPageProps) {
  const pathname = usePathname();
  const side = variant === 'bar' ? 'bar' as const : 'game_club' as const;
  const t = useTranslations('dashboard');
  const te = useTranslations('expenses');
  const tcal = useTranslations('calendar');
  const { locale } = useAppLocale();
  const { selectedClubId, businessDayStartHour } = useClub();
  const fallbackDate = useBusinessToday(businessDayStartHour);
  const requested = useMemo(() => {
    const from = validDate(requestedFrom) ? requestedFrom : fallbackDate;
    const to = validDate(requestedTo) ? requestedTo : fallbackDate;
    return from <= to ? { from, to } : { from: to, to: from };
  }, [fallbackDate, requestedFrom, requestedTo]);
  // A range the user picked here wins until the URL props change; an untouched
  // page follows the requested range (and the business day as it rolls over).
  const [pickedRange, setPickedRange] = useState<{ from: string; to: string } | null>(null);
  const range = pickedRange ?? requested;
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => new Set());
  // The day just jumped to from the chart, briefly outlined so the eye finds it.
  const [highlightedDate, setHighlightedDate] = useState<string | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setPickedRange(null);
  }, [requestedFrom, requestedTo]);

  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  const fetchDetails = useCallback(async () => {
    if (!selectedClubId) return [];
    return loadRows(selectedClubId, range.from, range.to);
  }, [loadRows, range.from, range.to, selectedClubId]);
  const details = useClubQuery<MoneyDetailRow[]>(fetchDetails, []);
  const rows = details.data;
  const loading = details.loading;
  const error = details.error;

  function updateRange(next: { from: string; to: string }) {
    setPickedRange(next);
    // Keep the URL shareable without a server round-trip (same as the dashboard).
    const params = new URLSearchParams({ from: next.from, to: next.to });
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
  }

  // The dashboard always shows the current business month, so it takes no range.
  const backHref = DASHBOARD_PATH;

  const summary = useMemo(() => summarizeMoneyDetailRows(rows), [rows]);
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

  /** Opens a day from the chart or a stat, scrolls it into view and outlines it. */
  function jumpToDate(date: string) {
    setExpandedDates((current) => new Set(current).add(date));
    setHighlightedDate(date);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightedDate(null), 1600);
    requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.getElementById(dayAnchorId(date))?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
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

  function deductionKindLabel(line: MoneyDetailLine): string {
    return line.kind === 'purchase' ? t('stockPurchase') : line.kind === 'reserve' ? t('reserve') : t('expense');
  }

  function deductionLabel(line: MoneyDetailLine): string {
    if (line.kind === 'purchase') return `${line.name ?? '—'} × ${formatNumber(line.quantity)}`;
    if (line.kind === 'reserve') return t('intoReserve');
    const category = expenseCategoryLabel(line.category);
    return line.comment ? `${category}: ${line.comment}` : category;
  }

  const SideIcon = variant === 'bar' ? SIDE_ICONS.bar : SIDE_ICONS.gameClub;
  const negativeTotal = summary.moneyLeft < 0;
  const keptWidth = sharePercent(summary.moneyLeft, summary.collected);

  // Chart scale: the zero line sits where positive and negative days fit together.
  const maxPositive = Math.max(0, ...rows.map((row) => row.moneyLeft));
  const maxNegative = Math.max(0, ...rows.map((row) => -row.moneyLeft));
  const chartSpan = maxPositive + maxNegative || 1;
  const positiveArea = (maxPositive / chartSpan) * 100;

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
        <LoadErrorAlert retrying={loading} onRetry={() => void details.reload()}>
          {t('loadError')}
        </LoadErrorAlert>
      ) : null}

      {loading ? (
        <DetailListSkeleton />
      ) : error ? null : rows.length === 0 ? (
        <Card><EmptyState icon={CalendarDays} title={labels.emptyLabel} /></Card>
      ) : (
        <>
          {/* One headline number, then the two figures it is made of. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <Card
              as="section"
              className="relative overflow-hidden sm:col-span-2 lg:col-span-1"
              aria-label={labels.resultLabel}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage: `radial-gradient(circle at 100% 0%, rgb(var(${negativeTotal ? '--c-danger-500' : '--c-success-500'}) / 0.12), transparent 55%)`,
                }}
              />
              <div className="relative flex items-center gap-3">
                <IconChip icon={Wallet} tone={negativeTotal ? 'danger' : 'success'} />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-gray-500">{labels.resultLabel}</p>
                  <p className="text-xs text-gray-400">
                    {formatDateShort(range.from, locale)} – {formatDateShort(range.to, locale)} · {t('daysCount', { count: rows.length })}
                  </p>
                </div>
              </div>
              <p className={cn('relative mt-4 break-words text-3xl font-bold leading-none tracking-tight tabular-nums sm:text-4xl', negativeTotal ? 'text-danger-600' : 'text-success-600')}>
                <Money amount={summary.moneyLeft} currencyClassName="text-base text-gray-500" />
              </p>
              <p className="relative mt-2 text-xs leading-5 text-gray-500">{labels.resultDescription}</p>

              {summary.keptPercent !== null && (
                <div className="relative mt-4">
                  <div className="flex h-2 overflow-hidden rounded-full bg-danger-500/25" aria-hidden="true">
                    <div className="h-full rounded-full bg-success-500 transition-[width] duration-700 ease-out" style={{ width: `${keptWidth}%` }} />
                  </div>
                  <div className="mt-2 flex justify-between gap-3 text-xs font-medium">
                    <span className="flex items-center gap-1.5 text-success-600">
                      <span className="h-2 w-2 rounded-full bg-success-500" aria-hidden="true" />
                      {t('keptShare', { percent: summary.keptPercent })}
                    </span>
                    <span className="flex items-center gap-1.5 text-danger-600">
                      <span className="h-2 w-2 rounded-full bg-danger-500/60" aria-hidden="true" />
                      {t('spentShare', { percent: Math.round(sharePercent(summary.deductions, summary.collected)) })}
                    </span>
                  </div>
                </div>
              )}
            </Card>

            <Card as="section" aria-label={labels.collectedLabel} className="flex flex-col">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-medium text-gray-500">{labels.collectedLabel}</p>
                <IconChip icon={SideIcon} tone="success" size="sm" />
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-2xl font-bold tracking-tight tabular-nums text-success-600">
                <ArrowDownLeft size={20} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />
                <Money amount={summary.collected} currencyClassName="text-sm text-gray-500" />
              </p>
              <p className="mt-auto pt-3 text-xs text-gray-500">
                {t('averagePerDay')}: <Money amount={Math.round(summary.collected / rows.length)} className="font-semibold text-gray-700" currencyClassName="text-gray-500" />
              </p>
            </Card>

            <Card as="section" aria-label={labels.deductionsLabel} className="flex flex-col">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-medium text-gray-500">{labels.deductionsLabel}</p>
                <IconChip icon={Receipt} tone="danger" size="sm" />
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-2xl font-bold tracking-tight tabular-nums text-danger-600">
                <ArrowUpRight size={20} strokeWidth={2.4} aria-hidden="true" className="shrink-0" />
                <Money amount={summary.deductions} currencyClassName="text-sm text-gray-500" />
              </p>
              {labels.deductionsHint && <p className="mt-auto pt-3 text-xs text-gray-500">{labels.deductionsHint}</p>}
            </Card>
          </div>

          {/* Day-by-day bars: green above the line, red below; tap one to open that day. */}
          <Card as="section" aria-label={t('dayByDay')}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-950">{t('dayByDay')}</h2>
                <p className="mt-0.5 text-xs text-gray-500">{t('dayByDayHint')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {summary.best && (
                  <button
                    type="button"
                    onClick={() => jumpToDate(summary.best!.date)}
                    className="flex items-center gap-2 rounded-xl border border-gray-200 px-2.5 py-1.5 text-left transition hover:border-success-500/50 hover:bg-success-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <Trophy size={14} className="text-success-600" aria-hidden="true" />
                    <span className="text-xs">
                      <span className="block text-gray-500">{t('bestDay')} · {formatDateShort(summary.best.date, locale)}</span>
                      <Money amount={summary.best.moneyLeft} className="font-semibold text-success-600" currencyClassName="text-gray-500" />
                    </span>
                  </button>
                )}
                {summary.worst && summary.worst.date !== summary.best?.date && (
                  <button
                    type="button"
                    onClick={() => jumpToDate(summary.worst!.date)}
                    className="flex items-center gap-2 rounded-xl border border-gray-200 px-2.5 py-1.5 text-left transition hover:border-danger-500/50 hover:bg-danger-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <TrendingDown size={14} className="text-danger-600" aria-hidden="true" />
                    <span className="text-xs">
                      <span className="block text-gray-500">{t('worstDay')} · {formatDateShort(summary.worst.date, locale)}</span>
                      <Money amount={summary.worst.moneyLeft} className={cn('font-semibold', summary.worst.moneyLeft < 0 ? 'text-danger-600' : 'text-gray-800')} currencyClassName="text-gray-500" />
                    </span>
                  </button>
                )}
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-2.5 py-1.5">
                  <Sigma size={14} className="text-primary-600" aria-hidden="true" />
                  <span className="text-xs">
                    <span className="block text-gray-500">{t('averagePerDay')}</span>
                    <Money amount={summary.averagePerDay} className="font-semibold text-gray-800" currencyClassName="text-gray-500" />
                  </span>
                </div>
              </div>
            </div>

            <div className="-mx-1 overflow-x-auto px-1 pb-1 pt-9">
              <div className="relative flex h-40 min-w-full items-stretch gap-[3px] sm:h-48" style={{ minWidth: `${rows.length * 9}px` }}>
                {/* Zero line */}
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 border-t border-dashed border-gray-300" style={{ top: `${positiveArea}%` }} />
                {rows.map((row) => {
                  const negative = row.moneyLeft < 0;
                  const height = (Math.abs(row.moneyLeft) / chartSpan) * 100;
                  const open = expandedDates.has(row.date);
                  return (
                    <button
                      key={row.date}
                      type="button"
                      onClick={() => jumpToDate(row.date)}
                      aria-label={`${formatDateShort(row.date, locale)}: ${formatNumber(row.moneyLeft)}`}
                      className="group/bar relative min-w-[6px] flex-1 rounded-md transition-colors hover:bg-gray-100 focus-visible:bg-gray-100 focus-visible:outline-none"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute inset-x-[15%] transition-[opacity,transform] duration-200 group-hover/bar:opacity-100',
                          negative ? 'rounded-b-[4px] bg-danger-500' : 'rounded-t-[4px] bg-success-500',
                          open ? 'opacity-100' : 'opacity-75',
                        )}
                        style={negative
                          ? { top: `${positiveArea}%`, height: `${Math.max(height, 1)}%` }
                          : { bottom: `${100 - positiveArea}%`, height: `${Math.max(height, 1)}%` }}
                      />
                      {/* Hover tooltip */}
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-lg bg-gray-950 px-2 py-1 text-[11px] font-medium text-gray-50 opacity-0 shadow-pop transition duration-150 group-hover/bar:translate-y-0 group-hover/bar:opacity-100 group-focus-visible/bar:translate-y-0 group-focus-visible/bar:opacity-100"
                      >
                        {formatDateShort(row.date, locale)} · <span className={negative ? 'text-danger-400' : 'text-success-500'}>{formatNumber(row.moneyLeft)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-gray-400" aria-hidden="true">
                <span>{formatDateShort(rows[0].date, locale)}</span>
                <span>{formatDateShort(rows[rows.length - 1].date, locale)}</span>
              </div>
            </div>
          </Card>

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

            {rows.map((row) => {
              const open = expandedDates.has(row.date);
              const negative = row.moneyLeft < 0;
              const dayNumber = Number(row.date.slice(8, 10));
              const panelId = `${dayAnchorId(row.date)}-panel`;
              return (
                <div
                  key={row.date}
                  id={dayAnchorId(row.date)}
                  className={cn(
                    'scroll-mt-24 overflow-hidden rounded-2xl border bg-surface shadow-card transition-[border-color,box-shadow] duration-300',
                    open ? 'border-gray-300' : 'border-gray-200 hover:border-gray-300',
                    highlightedDate === row.date && 'ring-2 ring-primary-500 ring-offset-2',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleDate(row.date)}
                    aria-expanded={open}
                    aria-controls={panelId}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 sm:px-4"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl leading-none ring-1 ring-inset',
                        negative ? 'bg-danger-50 ring-danger-100' : 'bg-gray-50 ring-gray-200',
                      )}
                    >
                      <span className={cn('text-base font-bold tabular-nums', negative ? 'text-danger-600' : 'text-gray-900')}>{dayNumber}</span>
                      <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-400">{tcal(`weekdays.${weekdayKey(row.date)}`)}</span>
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-gray-950">{formatDateShort(row.date, locale)}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs tabular-nums">
                        <span className="flex items-center gap-0.5 text-success-600">
                          <ArrowDownLeft size={12} aria-hidden="true" />
                          {formatNumber(row.collectedTotal)}
                        </span>
                        <span className="flex items-center gap-0.5 text-danger-600">
                          <ArrowUpRight size={12} aria-hidden="true" />
                          {formatNumber(row.deductionsTotal)}
                        </span>
                      </span>
                    </span>

                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="hidden text-[11px] font-medium text-gray-400 sm:block">{t('moneyLeftForDay')}</span>
                      <span
                        className={cn(
                          'flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-bold tracking-tight ring-1 ring-inset',
                          negative ? 'bg-danger-50 text-danger-600 ring-danger-100' : 'bg-success-50 text-success-600 ring-success-100',
                        )}
                      >
                        {negative ? <TrendingDown size={14} aria-hidden="true" /> : <TrendingUp size={14} aria-hidden="true" />}
                        <Money amount={row.moneyLeft} currencyClassName="text-[11px] text-gray-500" />
                      </span>
                    </span>

                    <ChevronDown
                      size={18}
                      aria-hidden="true"
                      className={cn('shrink-0 text-gray-400 transition-transform duration-300', open && 'rotate-180 text-gray-600')}
                    />
                  </button>

                  {open && (
                    <div id={panelId} className="presence" data-presence="enter">
                      <div className={cn('grid border-t border-gray-100', variant === 'bar' ? 'lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]' : 'lg:grid-cols-2')}>
                        <section className="p-4 sm:p-5 lg:border-r lg:border-gray-100">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                              <ArrowDownLeft size={13} className="text-success-600" aria-hidden="true" />
                              {labels.collectedLabel}
                            </h3>
                            <Money amount={row.collectedTotal} showPlus className="text-sm font-semibold text-success-600" currencyClassName="text-xs text-gray-500" />
                          </div>
                          <ul className="space-y-0.5">
                            {row.collected.map((item) => (
                              <li key={item.key}>
                                <Link href={moneyDetailLineHref(side, row.date, { kind: 'collected', key: item.key })} className="group/line -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-gray-50 focus-visible:bg-primary-50 focus-visible:outline-none">
                                  <IconChip icon={COLLECTED_ICONS[item.key]} tone="success" size="sm" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block break-words text-sm text-gray-700">{collectedLabel(item.key)}</span>
                                    <span className="mt-1 block h-1 max-w-[220px] overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                                      <span className="block h-full rounded-full bg-success-500/70" style={{ width: `${sharePercent(item.amount, row.collectedTotal)}%` }} />
                                    </span>
                                  </span>
                                  <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-gray-950">
                                    <Money amount={item.amount} currencyClassName="text-xs text-gray-500" />
                                    <ChevronRight size={14} aria-hidden="true" className="text-gray-300 transition-transform group-hover/line:translate-x-0.5 group-hover/line:text-gray-500" />
                                  </span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </section>

                        <section className="border-t border-gray-100 p-4 sm:p-5 lg:border-t-0">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                              <ArrowUpRight size={13} className="text-danger-600" aria-hidden="true" />
                              {labels.deductionsLabel}
                            </h3>
                            <span className="text-sm font-semibold text-danger-600">− <Money amount={row.deductionsTotal} currencyClassName="text-xs text-gray-500" /></span>
                          </div>
                          {row.deductions.length ? (
                            <ul className="space-y-0.5">
                              {row.deductions.map((line, index) => (
                                <li key={`${line.kind}-${index}`}>
                                  <Link href={moneyDetailLineHref(side, row.date, line)} className="group/line -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-gray-50 focus-visible:bg-primary-50 focus-visible:outline-none">
                                    <span title={deductionKindLabel(line)}>
                                      <IconChip icon={DEDUCTION_ICONS[line.kind]} tone={line.kind === 'purchase' ? 'primary' : line.kind === 'reserve' ? 'neutral' : 'danger'} size="sm" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block break-words text-sm leading-5 text-gray-700">{deductionLabel(line)}</span>
                                      <span className="mt-0.5 flex items-center gap-2">
                                        {variant === 'bar' && (
                                          <span className="text-[11px] font-medium text-gray-400">{deductionKindLabel(line)}</span>
                                        )}
                                        <span className="block h-1 max-w-[220px] flex-1 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                                          <span className="block h-full rounded-full bg-danger-500/60" style={{ width: `${sharePercent(line.amount, row.deductionsTotal)}%` }} />
                                        </span>
                                      </span>
                                    </span>
                                    <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-danger-600">
                                      − <Money amount={line.amount} currencyClassName="text-xs text-gray-500" />
                                      <ChevronRight size={14} aria-hidden="true" className="text-gray-300 transition-transform group-hover/line:translate-x-0.5 group-hover/line:text-gray-500" />
                                    </span>
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <EmptyState compact bordered title={t('noDeductionsForDay')} className="border-gray-200 py-5" />
                          )}
                        </section>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
