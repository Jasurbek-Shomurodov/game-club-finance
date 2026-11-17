'use client';

// Route: /

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  MonitorSmartphone,
  ShoppingBag,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { cn } from '@/lib/utils';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { formatDateShort } from '@/lib/formatters';
import { useClub } from '@/components/layout/DashboardShell';
import {
  AmountCard,
  ButtonLink,
  ChartSkeleton,
  Field,
  HelpButton,
  LoadErrorAlert,
  MetricMoney,
  MonthPicker,
  PageHeader,
  StatTile,
  toneForAmount,
  type MetricTone,
} from '@/components/PresentationFoundation';
import { DashboardAttention } from '@/components/dashboard/DashboardAttention';
import { DashboardToday } from '@/components/dashboard/DashboardToday';
import { buildDashboardTodayStatus } from '@/lib/calculations/dashboardAttention';
import { canAccessPath, canReadStockCounts } from '@/lib/permissions';
import { buildProductSalesSummary, buildRestockList, salesPeriodStart, type ProductSalesRow } from '@/lib/calculations/productSales';
import { fetchBarProductSales } from '@/lib/supabase/barProductSales';
import { useClubQuery } from '@/lib/useClubQuery';
import { MoneyFlowSankeys } from '@/components/financial-analysis/MoneyFlowSankeys';
import { SIDE_ICON_CLASS } from '@/components/financial-analysis/analysisFormat';
import { formatCurrency } from '@/lib/formatters';
import {
  calculateAverageDailyIncome,
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

function ChartLoading() {
  return <ChartSkeleton />;
}

const IncomeTrendChart = dynamic(
  () => import('@/components/dashboard/IncomeTrendChart').then((module) => module.IncomeTrendChart),
  { ssr: false, loading: ChartLoading },
);

/** A few figures for one side, under its money-flow Sankey. */
function FlowFigures({ items, loading }: {
  items: Array<{ label: string; amount: number; currency: string; tone?: MetricTone; helper?: string }>;
  loading: boolean;
}) {
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-3">
      {items.map((item) => (
        <StatTile
          key={item.label}
          variant="soft"
          size="sm"
          // The note sits behind a "?" so it is reachable by touch, not only by hover.
          label={(
            <span className="inline-flex items-center gap-0.5">
              {item.label}
              {item.helper && <HelpButton title={item.label} body={item.helper} className="-my-2" />}
            </span>
          )}
          tone={loading ? 'muted' : item.tone}
          value={loading ? '—' : <MetricMoney amount={item.amount} currency={item.currency} />}
        />
      ))}
    </div>
  );
}

/** The restock list ranks products by their sales over this many days ending today. */
const RESTOCK_SALES_DAYS = 30;
const NO_SALES: ProductSalesRow[] = [];

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
      date: formatDateShort(row.date, locale),
    })),
    [data.trend, data.latestDailyCashEntryDate, data.latestBarEntryDate, businessToday, locale],
  );
  const todayStatus = useMemo(() => buildDashboardTodayStatus({
    trend: data.trend,
    cashEntryDates: data.cashEntryDates,
    stockEntryDates: data.stockEntryDates,
    businessToday,
  }), [data.trend, data.cashEntryDates, data.stockEntryDates, businessToday]);
  // Sales only rank the restock list: without them (no access, or a failed
  // read) it is the plain low-stock list from the snapshot.
  const canRankRestock = canReadStockCounts(role, featureAccess);
  const loadSales = useCallback(async (): Promise<ProductSalesRow[]> => (
    fetchBarProductSales(createClient(), selectedClubId, salesPeriodStart(businessToday, RESTOCK_SALES_DAYS), businessToday)
  ), [selectedClubId, businessToday]);
  const salesQuery = useClubQuery(selectedClubId && canRankRestock && isCurrentMonth ? loadSales : null, NO_SALES);
  const restock = useMemo(() => buildRestockList(
    data.stockProducts,
    salesQuery.error ? null : buildProductSalesSummary(data.stockProducts, salesQuery.data),
  ), [data.stockProducts, salesQuery.data, salesQuery.error]);
  /** A link only to pages this member can open. */
  const pathIfAllowed = (path: string) => (canAccessPath(role, featureAccess, path) ? path : undefined);
  const stockLinkHref = pathIfAllowed('/stock-purchase');
  const productsHref = pathIfAllowed('/products');
  // The month so far, day by day, as the small line beside each income figure.
  const sparkDays = useMemo(
    () => data.trend.filter((row) => row.date <= businessToday),
    [data.trend, businessToday],
  );
  const gameClubSpark = useMemo(() => sparkDays.map((row) => row.gameClubIncome), [sparkDays]);
  const barSpark = useMemo(() => sparkDays.map((row) => row.barSales), [sparkDays]);
  const averageBarDayCount = countDashboardRangeDaysThroughDate(range, data.latestBarEntryDate);
  const averageGameClubDayCount = countDashboardRangeDaysThroughDate(range, data.latestDailyCashEntryDate);
  const averageGameClubIncome = calculateAverageDailyIncome(totals.gameClubIncome, averageGameClubDayCount);
  const averageBarIncome = calculateAverageDailyIncome(totals.barSales, averageBarDayCount);
  // Where the month is heading if the remaining days earn like the entered ones.
  const rangeDays = countDashboardRangeDays(range);
  const paceNote = (total: number, elapsedDays: number) => {
    const projected = isCurrentMonth ? projectRangeIncome(total, elapsedDays, rangeDays) : null;
    return projected === null ? undefined : `${t('onPaceFor')}: ${formatCurrency(projected)} ${currency}`;
  };


  const detailsQuery = new URLSearchParams({ from: range.from, to: range.to }).toString();
  const periodLabel = `${formatDateShort(range.from, locale)} – ${formatDateShort(range.to, locale)}`;
  const barProfitComparison = comparisonFor(totals.barProfit, previousTotals.barProfit);
  const inventoryHelper = data.hasInventoryComparisonData
    ? `${isCurrentMonth ? t('lastMonthInventoryValue') : t('previousMonthInventoryValue')}: ${formatCurrency(data.inventoryComparisonValue)} ${currency}`
    : isCurrentMonth ? t('lowStockAlertsCount', { count: data.lowStockCount }) : '';
  const inventoryNote = `${isCurrentMonth ? t('inventoryValueDesc') : t('inventoryValueMonthEndDesc')} ${inventoryHelper}`.trim();

  // The money flows come from the same snapshot as the cards, so the two always agree.
  const { ledgers } = data;

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
          {/* The shift's two tasks first: they are what the rest of the page is built from.
              They and the lists below describe now, so an earlier month leaves them out. */}
          {isCurrentMonth && <DashboardToday
            status={todayStatus}
            businessToday={businessToday}
            locale={locale}
            currency={currency}
            loading={loading}
            cashHref={pathIfAllowed('/daily-cash')}
            stockHref={pathIfAllowed('/closing-stock')}
          />}

          {/* Headline numbers: the four figures an owner checks first. */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <AmountCard
              loading={loading}
              currency={currency}
              label={t('gameClubIncome')}
              amount={totals.gameClubIncome}
              icon={MonitorSmartphone}
              iconClassName={SIDE_ICON_CLASS.gameClub}
              tone="success"
              comparison={comparisonFor(totals.gameClubIncome, previousTotals.gameClubIncome)}
              helper={paceNote(totals.gameClubIncome, averageGameClubDayCount)}
              sparkline={gameClubSpark}
            />
            <AmountCard
              loading={loading}
              currency={currency}
              label={t('barSales')}
              amount={totals.barSales}
              icon={ShoppingBag}
              iconClassName={SIDE_ICON_CLASS.bar}
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
              amount={totals.gameClubProfit}
              icon={totals.gameClubProfit < 0 ? ArrowDownRight : ArrowUpRight}
              iconClassName={SIDE_ICON_CLASS.gameClub}
              tone={toneForAmount(totals.gameClubProfit)}
              comparison={comparisonFor(totals.gameClubProfit, previousTotals.gameClubProfit)}
              helper={`${t('gameClubPaidExpenses')}: ${formatCurrency(totals.gameClubExpenses)} ${currency}`}
            />
            <AmountCard
              loading={loading}
              currency={currency}
              label={t('barNetProfit')}
              amount={totals.barProfit}
              icon={totals.barProfit < 0 ? ArrowDownRight : ArrowUpRight}
              iconClassName={SIDE_ICON_CLASS.bar}
              tone={toneForAmount(totals.barProfit)}
              comparison={barProfitComparison}
              helper={t('barNetProfitDesc')}
            />
          </div>

          {isCurrentMonth && <DashboardAttention
            lowStock={restock}
            debtors={data.debtors}
            loading={loading}
            locale={locale}
            currency={currency}
            stockLink={stockLinkHref
              ? { href: stockLinkHref, label: t('runningLowBuy') }
              : productsHref ? { href: productsHref, label: t('runningLowProducts') } : undefined}
            debtsHref={pathIfAllowed('/debts')}
          />}

          {/* Each business gets its own money flow; tapping a node opens the Sankey behind it. */}
          {loading ? (
            <div className="grid gap-3 2xl:grid-cols-2" role="status" aria-label={t('loading')}>
              <ChartLoading />
              <ChartLoading />
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
                action: detailsLink(`/game-club-money-details?${detailsQuery}`),
                footer: (
                  <FlowFigures
                    loading={loading}
                    items={[
                      { label: t('totalMoneyLeft'), helper: t('totalMoneyLeftDesc'), amount: totals.gameClubMoneyLeft, currency, tone: toneForAmount(totals.gameClubMoneyLeft) },
                      { label: t('activeDebts'), helper: t('activeDebtsDesc', { count: totals.activeDebtCount }), amount: totals.activeDebts, currency, tone: totals.activeDebts > 0 ? 'danger' : 'default' },
                      { label: t('averageDailyIncome'), helper: t('averageDailyClubIncomeDesc'), amount: averageGameClubIncome, currency },
                    ]}
                  />
                ),
              }}
              bar={{
                title: tf('barFlowTitle'),
                description: tf('flowDesc'),
                action: detailsLink(`/bar-money-details?${detailsQuery}`),
                footer: (
                  <FlowFigures
                    loading={loading}
                    items={[
                      { label: t('barMoneyLeft'), helper: t('barMoneyLeftDesc'), amount: totals.barIncome, currency, tone: toneForAmount(totals.barIncome) },
                      { label: t('inventoryValue'), helper: inventoryNote, amount: totals.inventoryValue, currency },
                      { label: t('averageDailyIncome'), helper: t('averageDailyBarIncomeDesc'), amount: averageBarIncome, currency },
                    ]}
                  />
                ),
              }}
            />
          )}

          {!renderCharts ? (
            <div ref={chartsAnchorRef} role="status" aria-label={t('loading')}>
              <ChartLoading />
            </div>
          ) : (
            // Once rendered, the chart stays mounted across range/club changes and is
            // dimmed while the next data loads instead of swapping to a skeleton.
            <div
              className={cn('transition-opacity', loading && 'pointer-events-none opacity-60')}
              aria-busy={loading || undefined}
            >
              <IncomeTrendChart
                data={trend}
                link={(
                  <ButtonLink
                    href={`/financial-analysis?${detailsQuery}`}
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
