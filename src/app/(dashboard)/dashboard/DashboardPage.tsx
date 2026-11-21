'use client';

// Route: /

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
} from 'lucide-react';
import { SIDE_ICONS } from '@/components/sideIcons';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { cn } from '@/lib/utils';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { capitalizeFirst, formatDateShort, formatYearMonth } from '@/lib/formatters';
import { useClub } from '@/components/layout/DashboardShell';
import {
  AmountCard,
  ButtonLink,
  Field,
  HelpButton,
  LoadErrorAlert,
  MetricMoney,
  MonthPicker,
  PageHeader,
  SectionHeading,
  StatTile,
  toneForAmount,
  type MetricTone,
} from '@/components/PresentationFoundation';
import { canAccessPath } from '@/lib/permissions';
import { MoneyFlowSankeys } from '@/components/financial-analysis/MoneyFlowSankeys';
import { formatCurrency } from '@/lib/formatters';
import {
  calculateAverageDailyIncome,
  calculateAverageWeeklyIncome,
  buildDailySalesLines,
  countDashboardRangeDays,
  countDashboardRangeDaysThroughDate,
  percentChange,
  projectRangeIncome,
  withRunningDailyAverages,
} from '@/lib/calculations/dashboardMetrics';
import {
  buildDashboardDataFromSnapshot,
  emptyDashboardData,
  getDashboardSnapshotRanges,
  type DashboardData,
  type DashboardSnapshotPayload,
} from '@/lib/calculations/dashboardSnapshot';
import { fetchDashboardSnapshot, fetchDashboardSnapshotFromTables } from '@/lib/supabase/dashboardSnapshot';
import {
  markPerformanceRpcAvailable,
  markPerformanceRpcMissing,
  shouldTryPerformanceRpc,
} from '@/lib/supabase/performanceRpc';
import { closingStockHref, dailyReportHref, financialAnalysisHref, moneyDetailsHref, reportsHref } from '@/lib/detailLinks';
import { expenseTotalsByCategory, periodProgress, valuesByDate } from '@/lib/calculations/insights';
import { SideGlanceCard, SideGlanceCardSkeleton } from '@/components/dashboard/SideGlanceCard';
import { chartColors } from '@/components/dashboard/ChartCard';
import { FlowCardSkeleton, HEADLINE_GRID_CLASS, TrendChartSkeleton } from './DashboardSkeleton';

function ChartLoading() {
  return <TrendChartSkeleton />;
}

const IncomeTrendChart = dynamic(
  () => import('@/components/dashboard/IncomeTrendChart').then((module) => module.IncomeTrendChart),
  { ssr: false, loading: ChartLoading },
);
const DailySalesLineChart = dynamic(
  () => import('@/components/dashboard/DailySalesLineChart').then((module) => module.DailySalesLineChart),
  { ssr: false, loading: ChartLoading },
);

/** A few figures for one side, under its money-flow Sankey; each opens the records behind it. */
function FlowFigures({ items, loading }: {
  items: Array<{ label: string; amount: number; currency: string; tone?: MetricTone; helper?: string; href?: string }>;
  loading: boolean;
}) {
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        // The "?" sits beside the tile, not inside its link: a button cannot live in a link.
        <div key={item.label} className="relative">
          <StatTile
            variant="soft"
            size="sm"
            href={loading ? undefined : item.href}
            label={<span className={cn(item.helper && 'pr-7')}>{item.label}</span>}
            tone={loading ? 'muted' : item.tone}
            value={loading ? '—' : <MetricMoney amount={item.amount} currency={item.currency} />}
            className="h-full"
          />
          {item.helper && (
            <HelpButton title={item.label} body={item.helper} className={cn('absolute top-1', item.href && !loading ? 'right-7' : 'right-1')} />
          )}
        </div>
      ))}
    </div>
  );
}

export interface InitialDashboardSnapshot {
  clubId: string;
  data: DashboardData;
  range: { from: string; to: string };
  /** Server time (ms) the snapshot was built. Older snapshots are shown but refetched. */
  generatedAt?: number;
}

// Browser Back can replay an old server payload from the router cache. Only a
// snapshot younger than this is trusted without a silent client refetch.
const INITIAL_SNAPSHOT_MAX_AGE_MS = 15_000;

function isInitialSnapshotFresh(snapshot: InitialDashboardSnapshot): boolean {
  if (typeof snapshot.generatedAt !== 'number') return false;
  return Date.now() - snapshot.generatedAt < INITIAL_SNAPSHOT_MAX_AGE_MS;
}

export default function DashboardPage({
  initialSnapshot = null,
}: {
  initialSnapshot?: InitialDashboardSnapshot | null;
}) {
  const { selectedClubId, businessDayStartHour, role, featureAccess } = useClub();
  const router = useRouter();
  const { locale } = useAppLocale();
  const businessToday = useBusinessToday(businessDayStartHour);
  // The club's current business month unless an earlier one is picked ('' = current,
  // so the page follows the calendar into a new month by itself).
  const currentMonth = businessToday.slice(0, 7);
  const [pickedMonth, setPickedMonth] = useState('');
  const month = pickedMonth && pickedMonth < currentMonth ? pickedMonth : currentMonth;
  const isCurrentMonth = month === currentMonth;
  const snapshotRanges = useMemo(() => getDashboardSnapshotRanges(businessToday, month), [businessToday, month]);
  const { range } = snapshotRanges;
  const initialSnapshotMatches = initialSnapshot?.clubId === selectedClubId
    && initialSnapshot.range.from === range.from
    && initialSnapshot.range.to === range.to;
  const [data, setData] = useState<DashboardData>(() => (
    initialSnapshotMatches ? initialSnapshot.data : emptyDashboardData
  ));
  const [loading, setLoading] = useState(!initialSnapshotMatches);
  const [error, setError] = useState(false);
  const [renderCharts, setRenderCharts] = useState(false);
  const requestSequence = useRef(0);
  const chartsAnchorRef = useRef<HTMLDivElement>(null);
  // Freshness only decides whether to refetch; the matching snapshot is always
  // rendered first, so server and client markup stay identical.
  const [initialSnapshotFresh] = useState(() => (
    initialSnapshotMatches && initialSnapshot ? isInitialSnapshotFresh(initialSnapshot) : false
  ));
  const initialRequestKey = `${selectedClubId}:${range.from}:${range.to}`;
  /** Key of the data currently on screen; a refetch for the same key is silent. */
  const displayedRequestKey = useRef(initialSnapshotMatches ? initialRequestKey : '');
  const loadedRequestKey = useRef(initialSnapshotFresh ? initialRequestKey : '');
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const tf = useTranslations('financialAnalysis');
  const te = useTranslations('expenses');
  const currency = tc('currency');

  const fetchDashboard = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const requestId = ++requestSequence.current;
    const requestKey = `${selectedClubId}:${range.from}:${range.to}`;
    const isStale = () => requestId !== requestSequence.current;

    if (!selectedClubId) {
      setData(emptyDashboardData);
      displayedRequestKey.current = '';
      setError(false);
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    setError(false);

    try {
      const supabase = createClient();
      let payload: DashboardSnapshotPayload | null = null;

      if (shouldTryPerformanceRpc()) {
        const snapshot = await fetchDashboardSnapshot(supabase, selectedClubId, snapshotRanges);
        if (isStale()) return;
        if (snapshot.error) throw snapshot.error;
        if (snapshot.data) {
          markPerformanceRpcAvailable();
          payload = snapshot.data;
        } else {
          markPerformanceRpcMissing();
        }
      }

      // Compatibility path for deployments where migration 030 has not reached
      // the database yet; it builds the same payload from table reads.
      if (!payload) {
        const fallback = await fetchDashboardSnapshotFromTables(supabase, selectedClubId, snapshotRanges);
        if (isStale()) return;
        if (fallback.error || !fallback.data) throw fallback.error;
        payload = fallback.data;
      }

      setData(buildDashboardDataFromSnapshot({ ...snapshotRanges, payload }));
      displayedRequestKey.current = requestKey;
      setLoading(false);
    } catch {
      if (isStale()) return;
      // Never leave another club's (or month's) figures on screen as if they
      // were this request's; a failed silent refresh keeps its own data.
      if (displayedRequestKey.current !== requestKey) {
        setData(emptyDashboardData);
        displayedRequestKey.current = '';
      }
      setError(true);
      setLoading(false);
    }
  }, [range.from, range.to, selectedClubId, snapshotRanges]);

  useEffect(() => {
    const requestKey = `${selectedClubId}:${range.from}:${range.to}`;
    if (loadedRequestKey.current === requestKey) return;
    loadedRequestKey.current = requestKey;

    // A stale server snapshot (or data already on screen for this key) stays
    // visible while it is refreshed in the background.
    void fetchDashboard({ silent: displayedRequestKey.current === requestKey });
  }, [fetchDashboard, range.from, range.to, selectedClubId]);

  const retryDashboard = useCallback(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    if (loading || renderCharts) return;
    const anchor = chartsAnchorRef.current;
    if (!anchor || typeof IntersectionObserver === 'undefined') {
      setRenderCharts(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setRenderCharts(true);
      observer.disconnect();
    }, { rootMargin: '600px 0px' });
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [loading, renderCharts]);

  const { totals, previousTotals } = data;

  const incomeComparisonLabel = isCurrentMonth ? t('vsLastMonth') : t('vsPreviousMonth');

  const comparisonFor = (current: number, previous: number, label = incomeComparisonLabel) => {
    const value = percentChange(current, previous);
    return { value, label: value === null ? t('noComparisonData') : label };
  };

  const trend = useMemo(
    // Days after today have no data yet; drawing them only adds an empty tail.
    () => withRunningDailyAverages(
      data.trend.filter((row, index) => index === 0 || row.date <= businessToday),
      { gameClub: data.latestDailyCashEntryDate, bar: data.latestBarEntryDate },
    ).map((row) => ({
      ...row,
      // The day itself, for opening its report from a tapped bar.
      iso: row.date,
      date: formatDateShort(row.date, locale),
    })),
    [data.trend, data.latestDailyCashEntryDate, data.latestBarEntryDate, businessToday, locale],
  );
  const dailySales = useMemo(
    () => buildDailySalesLines(
      data.trend.filter((row, index) => index === 0 || row.date <= businessToday),
      data.ledgers.cashRows,
      { gameClub: data.latestDailyCashEntryDate, bar: data.latestBarEntryDate },
    ).map((row) => ({ ...row, date: formatDateShort(row.date, locale) })),
    [data.trend, data.ledgers.cashRows, data.latestDailyCashEntryDate, data.latestBarEntryDate, businessToday, locale],
  );
  /** A link only to pages this member can open. */
  const pathIfAllowed = (path: string) => (canAccessPath(role, featureAccess, path) ? path : undefined);
  const productsHref = pathIfAllowed('/products');
  const canOpenDailyReport = Boolean(pathIfAllowed('/daily-report'));
  const canOpenReports = Boolean(pathIfAllowed('/reports'));
  const canOpenGameClubDetails = Boolean(pathIfAllowed('/game-club-money-details'));
  const canOpenBarDetails = Boolean(pathIfAllowed('/bar-money-details'));
  const glanceLinks = useMemo(() => ({
    game_club: { moneyDetails: canOpenGameClubDetails, dailyReport: canOpenDailyReport, reports: canOpenReports },
    bar: { moneyDetails: canOpenBarDetails, dailyReport: canOpenDailyReport, reports: canOpenReports },
  }), [canOpenBarDetails, canOpenDailyReport, canOpenGameClubDetails, canOpenReports]);
  // The month so far, day by day, as the small line beside each income figure.
  const sparkDays = useMemo(
    () => data.trend.filter((row) => row.date <= businessToday),
    [data.trend, businessToday],
  );
  const gameClubSpark = useMemo(() => sparkDays.map((row) => row.gameClubIncome), [sparkDays]);
  const barSpark = useMemo(() => sparkDays.map((row) => row.barSales), [sparkDays]);
  // PlayStation money is collected with each day's cash, so its line comes from the same cash rows.
  const playstationSpark = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const row of data.ledgers.cashRows) {
      byDate.set(row.date, (byDate.get(row.date) ?? 0) + Number(row.playstation_income ?? 0));
    }
    return sparkDays.map((row) => byDate.get(row.date) ?? 0);
  }, [data.ledgers.cashRows, sparkDays]);
  const averageBarDayCount = countDashboardRangeDaysThroughDate(range, data.latestBarEntryDate);
  const averageGameClubDayCount = countDashboardRangeDaysThroughDate(range, data.latestDailyCashEntryDate);
  const averageGameClubIncome = calculateAverageDailyIncome(totals.gameClubIncome, averageGameClubDayCount);
  const averageBarIncome = calculateAverageDailyIncome(totals.barSales, averageBarDayCount);
  const averageWeeklyGameClubIncome = calculateAverageWeeklyIncome(totals.gameClubIncome, averageGameClubDayCount);
  const averageWeeklyBarIncome = calculateAverageWeeklyIncome(totals.barSales, averageBarDayCount);
  // Where the month is heading if the remaining days earn like the entered ones.
  const rangeDays = countDashboardRangeDays(range);
  const paceNote = (total: number, elapsedDays: number) => {
    const projected = isCurrentMonth ? projectRangeIncome(total, elapsedDays, rangeDays) : null;
    return projected === null ? undefined : `${t('onPaceFor')}: ${formatCurrency(projected)} ${currency}`;
  };


  const gameClubDetailsHref = canOpenGameClubDetails ? moneyDetailsHref('game_club', range) : undefined;
  const barDetailsHref = canOpenBarDetails ? moneyDetailsHref('bar', range) : undefined;
  const periodLabel = `${formatDateShort(range.from, locale)} – ${formatDateShort(range.to, locale)}`;
  const barProfitComparison = comparisonFor(totals.barProfit, previousTotals.barProfit);
  const inventoryHelper = data.hasInventoryComparisonData
    ? `${isCurrentMonth ? t('lastMonthInventoryValue') : t('previousMonthInventoryValue')}: ${formatCurrency(data.inventoryComparisonValue)} ${currency}`
    : isCurrentMonth ? t('lowStockAlertsCount', { count: data.lowStockCount }) : '';
  const inventoryNote = `${isCurrentMonth ? t('inventoryValueDesc') : t('inventoryValueMonthEndDesc')} ${inventoryHelper}`.trim();

  // The money flows come from the same snapshot as the cards, so the two always agree.
  const { ledgers } = data;

  // "At a glance": each side's month day by day, from the same snapshot as the cards.
  const gameClubByDate = useMemo(() => valuesByDate(data.trend, (row) => row.gameClubIncome), [data.trend]);
  const barByDate = useMemo(() => valuesByDate(data.trend, (row) => row.barSales), [data.trend]);
  const categoryLabel = useCallback((category: string) => {
    const key = `categories.${category}`;
    return te.has(key) ? te(key as Parameters<typeof te>[0]) : category.replace(/_/g, ' ');
  }, [te]);
  // Reserve-paid purchases stay in each side's expenses and profit, so the donut keeps them too.
  const gameClubSpending = useMemo(
    () => expenseTotalsByCategory(ledgers.expenseRows, 'game_club', { includeReservePaid: true }).map(({ category, value }) => ({ key: category, label: categoryLabel(category), value })),
    [ledgers.expenseRows, categoryLabel],
  );
  const barSpending = useMemo(
    () => [
      { key: 'barCost', label: tf('barCost'), value: totals.barCost },
      ...expenseTotalsByCategory(ledgers.expenseRows, 'bar', { includeReservePaid: true }).map(({ category, value }) => ({ key: category, label: categoryLabel(category), value })),
    ],
    [ledgers.expenseRows, categoryLabel, totals.barCost, tf],
  );
  const monthProgress = periodProgress(range, businessToday);

  const detailsLink = (href: string) => (
    <ButtonLink href={href} variant="ghost" size="sm" iconRight={<ArrowRight size={15} aria-hidden="true" />}>
      {t('details')}
    </ButtonLink>
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        title={t('title')}
        className="mb-0"
        action={(
          <Field label={t('month')} className="sm:w-56">
            <MonthPicker
              value={month}
              max={currentMonth}
              onChange={(value) => setPickedMonth(value >= currentMonth ? '' : value)}
            />
          </Field>
        )}
      />

      {error && (
        <LoadErrorAlert retrying={loading} onRetry={retryDashboard}>
          {t('loadErrorDashboard')}
        </LoadErrorAlert>
      )}

      {/* After a failed load the figures are unknown, not zero: show only the error. */}
      {!error && (
        <>
          {/* Headline numbers: the figures an owner checks first. */}
          <div className={HEADLINE_GRID_CLASS}>
            <AmountCard
              loading={loading}
              currency={currency}
              label={t('gameClubIncome')}
              href={gameClubDetailsHref}
              amount={totals.gameClubIncome}
              icon={SIDE_ICONS.gameClub}
              accent="primary"
              tone="success"
              comparison={comparisonFor(totals.gameClubIncome, previousTotals.gameClubIncome)}
              helper={paceNote(totals.gameClubIncome, averageGameClubDayCount)}
              sparkline={gameClubSpark}
            />
            {/* PlayStation money is part of Game Club income, collected with the daily cash. */}
            <AmountCard
              loading={loading}
              currency={currency}
              label={t('playstationIncome')}
              href={pathIfAllowed('/reports') && reportsHref(range, { category: 'income' })}
              amount={totals.playstationIncome}
              icon={SIDE_ICONS.playstation}
              accent="primary"
              tone="success"
              comparison={comparisonFor(totals.playstationIncome, previousTotals.playstationIncome)}
              helper={paceNote(totals.playstationIncome, averageGameClubDayCount)}
              sparkline={playstationSpark}
            />
            <AmountCard
              loading={loading}
              currency={currency}
              label={t('barSales')}
              href={barDetailsHref}
              amount={totals.barSales}
              icon={SIDE_ICONS.bar}
              accent="bar"
              tone="success"
              comparison={comparisonFor(totals.barSales, previousTotals.barSales)}
              helper={paceNote(totals.barSales, averageBarDayCount)}
              sparkline={barSpark}
            />
            {/* The game club and the bar are separate businesses: each keeps its own profit. */}
            <AmountCard
              loading={loading}
              currency={currency}
              label={t('gameClubNetProfit')}
              href={gameClubDetailsHref}
              amount={totals.gameClubProfit}
              icon={totals.gameClubProfit < 0 ? ArrowDownRight : ArrowUpRight}
              accent="primary"
              tone={toneForAmount(totals.gameClubProfit)}
              comparison={comparisonFor(totals.gameClubProfit, previousTotals.gameClubProfit)}
              helper={`${t('gameClubPaidExpenses')}: ${formatCurrency(totals.gameClubExpenses)} ${currency}`}
            />
            <AmountCard
              loading={loading}
              currency={currency}
              label={t('barNetProfit')}
              href={barDetailsHref}
              amount={totals.barProfit}
              icon={totals.barProfit < 0 ? ArrowDownRight : ArrowUpRight}
              accent="bar"
              tone={toneForAmount(totals.barProfit)}
              comparison={barProfitComparison}
              helper={t('barNetProfitDesc')}
            />
          </div>

          {/* The month at a glance: each side on its own, never added together. */}
          <section aria-labelledby="dashboard-glance-heading" className="space-y-3">
            <SectionHeading
              title={<span id="dashboard-glance-heading">{capitalizeFirst(t('glanceSectionTitle', { month: formatYearMonth(month, locale) }), locale)}</span>}
              // Only a month still running has a "day N of M"; a finished one is simply whole.
              action={isCurrentMonth ? (
                <div className="flex min-w-44 items-center gap-2 text-xs text-gray-500">
                  <span className="tabular-nums">{t('monthDayProgress', { elapsed: monthProgress.elapsed, total: monthProgress.total })}</span>
                  <span className="h-1.5 w-28 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                    <span className="grow-x block h-full rounded-full bg-primary-600 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${monthProgress.ratio * 100}%` }} />
                  </span>
                </div>
              ) : undefined}
            />
            {loading ? (
              <div className="grid gap-3 xl:grid-cols-2" role="status" aria-label={t('loading')}>
                <SideGlanceCardSkeleton />
                <SideGlanceCardSkeleton />
              </div>
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                <SideGlanceCard
                  title={t('gameClub')}
                  icon={SIDE_ICONS.gameClub}
                  accent="primary"
                  color={chartColors.primary}
                  yearMonth={month}
                  range={range}
                  values={gameClubByDate}
                  through={data.latestDailyCashEntryDate}
                  today={businessToday}
                  income={totals.gameClubIncome}
                  profit={totals.gameClubProfit}
                  spending={gameClubSpending}
                  currency={currency}
                  locale={locale}
                  side="game_club"
                  links={glanceLinks.game_club}
                />
                <SideGlanceCard
                  title={t('bar')}
                  icon={SIDE_ICONS.bar}
                  accent="bar"
                  color={chartColors.orange}
                  yearMonth={month}
                  range={range}
                  values={barByDate}
                  through={data.latestBarEntryDate}
                  today={businessToday}
                  income={totals.barSales}
                  profit={totals.barProfit}
                  spending={barSpending}
                  currency={currency}
                  locale={locale}
                  side="bar"
                  links={glanceLinks.bar}
                />
              </div>
            )}
          </section>

          {/* Each business gets its own money flow; tapping a node opens the Sankey behind it. */}
          {loading ? (
            <div className="grid gap-3 2xl:grid-cols-2" role="status" aria-label={t('loading')}>
              <FlowCardSkeleton />
              <FlowCardSkeleton />
            </div>
          ) : (
            <MoneyFlowSankeys
              className="grid gap-3 2xl:grid-cols-2"
              ledgers={ledgers}
              range={range}
              periodLabel={periodLabel}
              locale={locale}
              currency={currency}
              gameClub={{
                title: tf('gameClubFlowTitle'),
                description: tf('flowDesc'),
                action: gameClubDetailsHref ? detailsLink(gameClubDetailsHref) : undefined,
                footer: (
                  <FlowFigures
                    loading={loading}
                    items={[
                      { href: gameClubDetailsHref, label: t('totalMoneyLeft'), helper: t('totalMoneyLeftDesc'), amount: totals.gameClubMoneyLeft, currency, tone: toneForAmount(totals.gameClubMoneyLeft) },
                      { href: pathIfAllowed('/debts'), label: t('activeDebts'), helper: t('activeDebtsDesc', { count: totals.activeDebtCount }), amount: totals.activeDebts, currency, tone: totals.activeDebts > 0 ? 'danger' : 'default' },
                      { href: gameClubDetailsHref, label: t('averageDailyIncome'), helper: t('averageDailyClubIncomeDesc'), amount: averageGameClubIncome, currency },
                      { href: gameClubDetailsHref, label: t('averageWeeklyIncome'), helper: t('averageWeeklyClubIncomeDesc'), amount: averageWeeklyGameClubIncome, currency },
                    ]}
                  />
                ),
              }}
              bar={{
                title: tf('barFlowTitle'),
                description: tf('flowDesc'),
                action: barDetailsHref ? detailsLink(barDetailsHref) : undefined,
                footer: (
                  <FlowFigures
                    loading={loading}
                    items={[
                      { href: barDetailsHref, label: t('barMoneyLeft'), helper: t('barMoneyLeftDesc'), amount: totals.barIncome, currency, tone: toneForAmount(totals.barIncome) },
                      { href: isCurrentMonth ? productsHref : pathIfAllowed('/closing-stock') && closingStockHref(range.to), label: t('inventoryValue'), helper: inventoryNote, amount: totals.inventoryValue, currency },
                      { href: barDetailsHref, label: t('averageDailyIncome'), helper: t('averageDailyBarIncomeDesc'), amount: averageBarIncome, currency },
                      { href: barDetailsHref, label: t('averageWeeklyIncome'), helper: t('averageWeeklyBarIncomeDesc'), amount: averageWeeklyBarIncome, currency },
                    ]}
                  />
                ),
              }}
            />
          )}

          {!renderCharts ? (
            <div ref={chartsAnchorRef} className="space-y-4" role="status" aria-label={t('loading')}>
              <TrendChartSkeleton />
              <TrendChartSkeleton />
            </div>
          ) : (
            // Once rendered, the chart stays mounted across range/club changes and is
            // dimmed while the next data loads instead of swapping to a skeleton.
            <div
              className={cn('space-y-4 transition-opacity motion-reduce:transition-none', loading && 'pointer-events-none opacity-60')}
              aria-busy={loading || undefined}
            >
              <DailySalesLineChart data={dailySales} />
              <IncomeTrendChart
                data={trend}
                onSelectDay={canOpenDailyReport ? (date) => router.push(dailyReportHref(date)) : undefined}
                link={(
                  <ButtonLink
                    href={financialAnalysisHref(month)}
                    variant="ghost"
                    size="sm"
                    iconRight={<ArrowRight size={15} aria-hidden="true" />}
                  >
                    {t('analysisLinkAction')}
                  </ButtonLink>
                )}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
