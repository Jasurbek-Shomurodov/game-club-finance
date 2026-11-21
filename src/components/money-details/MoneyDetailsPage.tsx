'use client';

// Shared breakdown page for /bar-money-details and /game-club-money-details.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Button,
  Card,
  CategoryIcon,
  DateRangePicker,
  EmptyState,
  IconChip,
  LoadErrorAlert,
  MetricCard,
  MetricMoney,
  Money,
  PageHeader,
  SectionHeading,
  SkeletonStatus,
  StatTile,
} from '@/components/PresentationFoundation';
import { InOutChartSkeleton } from '@/components/charts/ChartSkeletons';
import { ShareBar } from '@/components/charts/ShareBar';
import { chartColors } from '@/components/dashboard/ChartCard';
import { MoneyDetailsSkeleton } from './MoneyDetailsSkeleton';
import { SIDE_ICONS } from '@/components/sideIcons';
import { formatCurrency, formatDateShort, formatNumber } from '@/lib/formatters';
import { canAccessPath } from '@/lib/permissions';
import { scrollBehavior } from '@/lib/scroll';
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

// The recharts chunk loads beside the rows, not with the page shell.
const DailyInOutChart = dynamic(
  () => import('@/components/charts/DailyInOutChart').then((module) => module.DailyInOutChart),
  { ssr: false, loading: () => <InOutChartSkeleton height={200} /> },
);

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

const lineClassName = '-mx-2 flex items-center gap-3 rounded-xl px-2 py-2';

/** One collected or deducted line of a day: a link to its records when the viewer may open them, otherwise a plain row. */
function LineRow({ href, children }: { href?: string; children: ReactNode }) {
  if (!href) return <div className={lineClassName}>{children}</div>;
  return (
    <Link href={href} className={cn(lineClassName, 'tappable group hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500')}>
      {children}
      <ChevronRight size={14} aria-hidden="true" className="shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-500 motion-reduce:transition-none" />
    </Link>
  );
}

export default function MoneyDetailsPage({ variant, requestedFrom, requestedTo, loadRows, labels }: MoneyDetailsPageProps) {
  const pathname = usePathname();
  const side = variant === 'bar' ? 'bar' as const : 'game_club' as const;
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const te = useTranslations('expenses');
  const tcal = useTranslations('calendar');
  const { locale } = useAppLocale();
  const { selectedClubId, businessDayStartHour, role, featureAccess } = useClub();
  /** A line opens its records only on a page this member may open. */
  const linkIfAllowed = (href: string) => (role && canAccessPath(role, featureAccess, href.split('?')[0]) ? href : undefined);
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
  // The day just jumped to from a stat, briefly outlined so the eye finds it.
  const [highlightedDate, setHighlightedDate] = useState<string | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  // This page is only reached by tapping a figure (reports, daily cash, the day
  // and month reports, the dashboard): Back returns there. Opened directly
  // (a shared link), there is nothing to go back to, so it leads to the dashboard.
  const [hasHistory, setHasHistory] = useState(false);
  useEffect(() => {
    setHasHistory(window.history.length > 1);
  }, []);

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

  const summary = useMemo(() => summarizeMoneyDetailRows(rows), [rows]);
  const allRowsExpanded = rows.length > 0 && rows.every((row) => expandedDates.has(row.date));
  // Collected against deducted per day, oldest first, for the shared in/out chart.
  const dailyFlow = useMemo(
    () => rows.map((row) => ({ date: row.date, label: formatDateShort(row.date, locale), income: row.collectedTotal, expenses: row.deductionsTotal })),
    [rows, locale],
  );

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

  /** Opens a day from a stat, scrolls it into view and outlines it. */
  function jumpToDate(date: string) {
    setExpandedDates((current) => new Set(current).add(date));
    setHighlightedDate(date);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightedDate(null), 1600);
    requestAnimationFrame(() => {
      document.getElementById(dayAnchorId(date))?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
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
  const currency = tc('currency');

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        back={hasHistory ? true : DASHBOARD_PATH}
        backLabel={hasHistory ? tc('back') : t('backToDashboard')}
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
        <SkeletonStatus><MoneyDetailsSkeleton /></SkeletonStatus>
      ) : error ? null : rows.length === 0 ? (
        <Card><EmptyState icon={CalendarDays} title={labels.emptyLabel} /></Card>
      ) : (
        <>
          {/* One headline number, then the two figures it is made of. They sum the days listed below, so they stay plain. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card as="section" className="sm:col-span-2 lg:col-span-1" aria-label={labels.resultLabel}>
              <div className="flex items-center gap-2">
                <IconChip icon={Wallet} tone={negativeTotal ? 'danger' : 'success'} size="sm" />
                <p className="min-w-0 break-words text-sm font-medium text-gray-500">{labels.resultLabel}</p>
              </div>
              <p className={cn('mt-2 break-words text-2xl font-bold leading-none tracking-tight tabular-nums sm:text-3xl', negativeTotal ? 'text-danger-600' : 'text-success-600')}>
                <Money amount={summary.moneyLeft} currencyClassName="text-sm tracking-normal text-gray-500" />
              </p>
              <p className="mt-1.5 text-xs leading-5 text-gray-500">
                {formatDateShort(range.from, locale)} – {formatDateShort(range.to, locale)} · {t('daysCount', { count: rows.length })}
              </p>
              <ShareBar
                className="mt-3"
                size="sm"
                label={labels.collectedLabel}
                locale={locale}
                parts={[
                  { key: 'left', label: labels.resultLabel, value: summary.moneyLeft, color: chartColors.success },
                  { key: 'deductions', label: labels.deductionsLabel, value: summary.deductions, color: chartColors.danger },
                ]}
              />
            </Card>
            <MetricCard
              label={labels.collectedLabel}
              value={<MetricMoney amount={summary.collected} currency={currency} />}
              tone="success"
              icon={SideIcon}
              helper={<>{t('averagePerDay')}: <Money amount={Math.round(summary.collected / rows.length)} className="font-semibold text-gray-700" currencyClassName="text-gray-500" /></>}
            />
            <MetricCard
              label={labels.deductionsLabel}
              value={<MetricMoney amount={summary.deductions} currency={currency} />}
              tone="danger"
              icon={Receipt}
              helper={labels.deductionsHint}
            />
          </div>

          {/* Day by day: the best, weakest and average day, then money in against money out. */}
          <Card as="section" aria-label={t('dayByDay')}>
            <SectionHeading size="sm" title={t('dayByDay')} description={t('dayByDayHint')} />
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {summary.best && (
                <StatTile
                  size="sm"
                  icon={Trophy}
                  label={`${t('bestDay')} · ${formatDateShort(summary.best.date, locale)}`}
                  value={formatCurrency(summary.best.moneyLeft)}
                  unit={currency}
                  tone={summary.best.moneyLeft < 0 ? 'danger' : 'success'}
                  onClick={() => jumpToDate(summary.best!.date)}
                />
              )}
              {summary.worst && summary.worst.date !== summary.best?.date && (
                <StatTile
                  size="sm"
                  icon={TrendingDown}
                  label={`${t('worstDay')} · ${formatDateShort(summary.worst.date, locale)}`}
                  value={formatCurrency(summary.worst.moneyLeft)}
                  unit={currency}
                  tone={summary.worst.moneyLeft < 0 ? 'danger' : 'default'}
                  onClick={() => jumpToDate(summary.worst!.date)}
                />
              )}
              <StatTile size="sm" icon={Sigma} label={t('averagePerDay')} value={formatCurrency(summary.averagePerDay)} unit={currency} tone={summary.averagePerDay < 0 ? 'danger' : 'default'} />
            </div>
            {dailyFlow.length > 1 && (
              <div className="mt-4">
                <DailyInOutChart
                  data={dailyFlow}
                  incomeLabel={labels.collectedLabel}
                  expensesLabel={labels.deductionsLabel}
                  legendLabel={t('dayByDay')}
                  currency={currency}
                  locale={locale}
                  height={200}
                  onSelectDay={jumpToDate}
                />
              </div>
            )}
          </Card>

          <section className="space-y-3">
            <SectionHeading
              size="sm"
              title={t('daysListTitle')}
              className="sm:items-center"
              action={(
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleAllDates}
                  aria-expanded={allRowsExpanded}
                  iconRight={<ChevronDown size={15} className={cn('transition-transform motion-reduce:transition-none', allRowsExpanded && 'rotate-180')} aria-hidden="true" />}
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
                <Card
                  key={row.date}
                  id={dayAnchorId(row.date)}
                  padding="none"
                  className={cn('scroll-mt-24 overflow-hidden', highlightedDate === row.date && 'ring-2 ring-primary-500 ring-offset-2')}
                >
                  {/* A disclosure header (aria-expanded), so it stays a button with the shared focus ring. */}
                  <button
                    type="button"
                    onClick={() => toggleDate(row.date)}
                    aria-expanded={open}
                    aria-controls={panelId}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 motion-reduce:transition-none sm:px-4"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl leading-none ring-1 ring-inset',
                        negative ? 'bg-danger-50 ring-danger-100' : 'bg-gray-50 ring-gray-200',
                      )}
                    >
                      <span className={cn('text-base font-bold tabular-nums', negative ? 'text-danger-600' : 'text-gray-900')}>{dayNumber}</span>
                      <span className="mt-0.5 text-xs font-medium text-gray-500">{tcal(`weekdays.${weekdayKey(row.date)}`)}</span>
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
                      <span className="hidden text-xs font-medium text-gray-500 sm:block">{t('moneyLeftForDay')}</span>
                      <span className={cn('flex items-center gap-1 text-sm font-bold tracking-tight', negative ? 'text-danger-600' : 'text-success-600')}>
                        {negative ? <TrendingDown size={14} aria-hidden="true" /> : <TrendingUp size={14} aria-hidden="true" />}
                        <Money amount={row.moneyLeft} currencyClassName="text-xs text-gray-500" />
                      </span>
                    </span>

                    <ChevronDown
                      size={18}
                      aria-hidden="true"
                      className={cn('shrink-0 text-gray-500 transition-transform duration-300 motion-reduce:transition-none', open && 'rotate-180 text-gray-600')}
                    />
                  </button>

                  {open && (
                    <div id={panelId} className="presence" data-presence="enter">
                      <div className={cn('grid border-t border-gray-100', variant === 'bar' ? 'lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]' : 'lg:grid-cols-2')}>
                        <section className="p-4 sm:p-5 lg:border-r lg:border-gray-100">
                          <SectionHeading
                            as="h3"
                            size="sm"
                            className="mb-2 flex-row items-center justify-between sm:items-center"
                            title={labels.collectedLabel}
                            action={<Money amount={row.collectedTotal} showPlus className="text-sm font-semibold text-success-600" currencyClassName="text-xs text-gray-500" />}
                          />
                          <ul className="space-y-0.5">
                            {row.collected.map((item) => (
                              <li key={item.key}>
                                <LineRow href={linkIfAllowed(moneyDetailLineHref(side, row.date, { kind: 'collected', key: item.key }))}>
                                  <IconChip icon={COLLECTED_ICONS[item.key]} tone="success" size="sm" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block break-words text-sm text-gray-700">{collectedLabel(item.key)}</span>
                                    <span className="mt-1 block h-1 max-w-56 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                                      <span className="block h-full rounded-full bg-success-500" style={{ width: `${sharePercent(item.amount, row.collectedTotal)}%` }} />
                                    </span>
                                  </span>
                                  <Money amount={item.amount} className="shrink-0 text-sm font-semibold text-gray-950" currencyClassName="text-xs text-gray-500" />
                                </LineRow>
                              </li>
                            ))}
                          </ul>
                        </section>

                        <section className="border-t border-gray-100 p-4 sm:p-5 lg:border-t-0">
                          <SectionHeading
                            as="h3"
                            size="sm"
                            className="mb-2 flex-row items-center justify-between sm:items-center"
                            title={labels.deductionsLabel}
                            action={<span className="text-sm font-semibold text-danger-600">− <Money amount={row.deductionsTotal} currencyClassName="text-xs text-gray-500" /></span>}
                          />
                          {row.deductions.length ? (
                            <ul className="space-y-0.5">
                              {row.deductions.map((line, index) => (
                                <li key={`${line.kind}-${index}`}>
                                  <LineRow href={linkIfAllowed(moneyDetailLineHref(side, row.date, line))}>
                                    <span title={deductionKindLabel(line)}>
                                      {line.kind === 'expense'
                                        ? <CategoryIcon category={line.category} size="sm" />
                                        : <IconChip icon={DEDUCTION_ICONS[line.kind]} tone={line.kind === 'purchase' ? 'primary' : 'reserve'} size="sm" />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block break-words text-sm leading-5 text-gray-700">{deductionLabel(line)}</span>
                                      <span className="mt-0.5 flex items-center gap-2">
                                        {variant === 'bar' && (
                                          <span className="text-xs font-medium text-gray-500">{deductionKindLabel(line)}</span>
                                        )}
                                        <span className="block h-1 max-w-56 flex-1 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                                          <span className="block h-full rounded-full bg-danger-500" style={{ width: `${sharePercent(line.amount, row.deductionsTotal)}%` }} />
                                        </span>
                                      </span>
                                    </span>
                                    <span className="shrink-0 text-sm font-semibold text-danger-600">
                                      − <Money amount={line.amount} currencyClassName="text-xs text-gray-500" />
                                    </span>
                                  </LineRow>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <EmptyState compact bordered title={t('noDeductionsForDay')} />
                          )}
                        </section>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
