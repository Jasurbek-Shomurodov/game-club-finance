'use client';

// Route: /

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  ChartPie,
  MonitorSmartphone,
  RefreshCcw,
  ShoppingBag,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { cn, todayIso } from '@/lib/utils';
import { formatDateShort } from '@/lib/formatters';
import { useClub } from '@/components/layout/DashboardShell';
import {
  AmountCard,
  Button,
  ButtonLink,
  Card,
  ChartSkeleton,
  InlineAlert,
  MetricCard,
  PageHeader,
  SectionHeading,
  toneForAmount,
  type MetricTone,
} from '@/components/PresentationFoundation';
import { formatCurrency } from '@/lib/formatters';
import {
  buildPeriodTrend,
  calculateAverageDailyIncome,
  calculateDashboardInventoryValue,
  calculateDashboardTotals,
  calculateGameClubMoneyLeftByPaymentMethod,
  calculateInventoryValueFromLatestStockCounts,
  countDashboardRangeDaysThroughDate,
  getDashboardComparisonRange,
  getDashboardRange,
  getLatestRowDateInRange,
  percentChange,
  type DailyCashRow,
  type DebtPaymentValueRow,
  type ExpenseRow,
  type InventorySnapshotRow,
  type StockCountRow,
  type StockPurchaseCostRow,
} from '@/lib/calculations/dashboardMetrics';
import {
  buildDashboardDataFromSnapshot,
  emptyDashboardData,
  type DashboardData,
  type DashboardSnapshotPayload,
} from '@/lib/calculations/dashboardSnapshot';
import { isMissingDatabaseFunction } from '@/lib/supabase/errors';
import {
  markPerformanceRpcAvailable,
  markPerformanceRpcMissing,
  shouldTryPerformanceRpc,
} from '@/lib/supabase/performanceRpc';
import type { Product } from '@/types';

function ChartLoading() {
  return <ChartSkeleton />;
}

const IncomeTrendChart = dynamic(
  () => import('@/components/dashboard/IncomeTrendChart').then((module) => module.IncomeTrendChart),
  { ssr: false, loading: ChartLoading },
);

interface StockPurchaseRow extends StockPurchaseCostRow {
  id: string;
  comment: string | null;
  created_at: string;
}

interface DebtRow {
  id: string;
  person_name: string;
  date: string;
  amount: number;
  remaining_amount: number;
  status: string;
}

function isMissingSortOrder(error: { message?: string } | null | undefined) {
  return error?.message?.includes('sort_order') ?? false;
}

async function fetchActiveProductsOrdered(supabase: ReturnType<typeof createClient>, clubId: string) {
  const ordered = await fetchAllRows<Product>(() =>
    supabase
      .from('products')
      .select('*')
      .eq('club_id', clubId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .order('id', { ascending: true }),
  );

  if (!isMissingSortOrder(ordered.error)) return ordered;

  return fetchAllRows<Product>(() =>
    supabase
      .from('products')
      .select('*')
      .eq('club_id', clubId)
      .eq('is_active', true)
      .order('name', { ascending: true })
      .order('id', { ascending: true }),
  );
}

function inRangeQuery<T extends { gte: (column: string, value: string) => T; lte: (column: string, value: string) => T }>(
  query: T,
  range: { from: string; to: string },
): T {
  return query.gte('date', range.from).lte('date', range.to);
}

interface MetricSectionProps {
  id: string;
  title: string;
  children: ReactNode;
  actionLabel: string;
  actionHref: string;
}

/** Plain section: small heading + "Details" link, then a grid of secondary metrics. */
function MetricSection({ id, title, children, actionLabel, actionHref }: MetricSectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <SectionHeading
        size="sm"
        title={<span id={headingId}>{title}</span>}
        className="sm:items-center"
        action={(
          <ButtonLink href={actionHref} variant="ghost" size="sm" iconRight={<ArrowRight size={15} aria-hidden="true" />}>
            {actionLabel}
          </ButtonLink>
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>
    </section>
  );
}

/** Money for a MetricCard: number plus a small muted currency suffix on the same line. */
function MetricAmount({ amount, currency }: { amount: number; currency: string }) {
  return (
    <>
      {formatCurrency(amount)}
      <span className="ml-1.5 text-sm font-medium tracking-normal text-gray-500">{currency}</span>
    </>
  );
}

type Comparison = { value: number | null; label: string };

/** Trend arrow + "12% vs last month" line for a MetricCard, or nothing when there is no comparison. */
function comparisonTrend(comparison: Comparison | undefined): Pick<ComponentProps<typeof MetricCard>, 'trend' | 'trendLabel'> {
  if (!comparison || comparison.value === null) return {};
  return {
    trend: comparison.value > 0 ? 'up' : comparison.value < 0 ? 'down' : 'neutral',
    trendLabel: (
      <>
        {Math.abs(comparison.value)}% <span className="font-normal text-gray-500">{comparison.label}</span>
      </>
    ),
  };
}

/** A zero with nothing to compare against is not worth colour or a caption. */
function isIdleMetric(amount: number, comparison?: Comparison): boolean {
  return amount === 0 && (!comparison || comparison.value === null);
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

const DASHBOARD_PERIOD = 'month' as const;

function isInitialSnapshotFresh(snapshot: InitialDashboardSnapshot): boolean {
  if (typeof snapshot.generatedAt !== 'number') return false;
  return Date.now() - snapshot.generatedAt < INITIAL_SNAPSHOT_MAX_AGE_MS;
}

export default function DashboardPage({
  initialSnapshot = null,
}: {
  initialSnapshot?: InitialDashboardSnapshot | null;
}) {
  const { selectedClubId, businessDayStartHour } = useClub();
  const { locale } = useAppLocale();
  const businessToday = useMemo(() => todayIso(new Date(), businessDayStartHour), [businessDayStartHour]);
  // The dashboard always shows the club's current business month.
  const range = useMemo(() => getDashboardRange(DASHBOARD_PERIOD, businessToday), [businessToday]);
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
  const currency = tc('currency');

  const fetchDashboard = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const requestId = ++requestSequence.current;
    const requestKey = `${selectedClubId}:${range.from}:${range.to}`;

    if (!selectedClubId) {
      setData(emptyDashboardData);
      setError(false);
      setLoading(false);
      return;
    }

    if (!silent) setLoading(true);
    setError(false);

    try {
      const supabase = createClient();
      const previousRange = getDashboardComparisonRange(DASHBOARD_PERIOD, range);
      const inventoryComparisonRange = getDashboardRange('lastMonth', businessToday);
      const inventoryQueryRange = inventoryComparisonRange;

      if (shouldTryPerformanceRpc()) {
        const snapshotResult = await supabase.rpc('get_dashboard_snapshot', {
          p_club_id: selectedClubId,
          p_range_from: range.from,
          p_range_to: range.to,
          p_previous_from: previousRange.from,
          p_previous_to: previousRange.to,
          p_inventory_from: inventoryComparisonRange.from,
          p_inventory_to: inventoryComparisonRange.to,
        });

        if (requestId !== requestSequence.current) return;

        if (!snapshotResult.error) {
          const snapshot = snapshotResult.data as Omit<DashboardSnapshotPayload, 'inventoryRows'> & {
            inventoryRows?: InventorySnapshotRow[];
          };
          setData(buildDashboardDataFromSnapshot({
            period: DASHBOARD_PERIOD,
            range,
            previousRange,
            inventoryComparisonRange,
            payload: {
              ...snapshot,
              inventoryRows: snapshot.inventoryRows ?? snapshot.stockRows as unknown as InventorySnapshotRow[],
            },
          }));
          markPerformanceRpcAvailable();
          displayedRequestKey.current = requestKey;
          setLoading(false);
          return;
        }

        if (!isMissingDatabaseFunction(snapshotResult.error, 'get_dashboard_snapshot')) {
          setError(true);
          setLoading(false);
          return;
        }

        markPerformanceRpcMissing();
      }

      // Compatibility path for deployments where migration 030 has not reached
      // the database yet. Each table is read once for the union of the current
      // and comparison periods, keeping the fallback to one parallel phase.
      const financeRange = {
        from: range.from < previousRange.from ? range.from : previousRange.from,
        to: range.to > previousRange.to ? range.to : previousRange.to,
      };

      const [
        cashRes,
        stockRes,
        expenseRes,
        productRes,
        debtRes,
        debtPaymentRes,
        purchaseRes,
        inventorySnapshotRes,
      ] = await Promise.all([
        fetchAllRows<DailyCashRow>(() =>
          inRangeQuery(
            supabase
              .from('daily_cash_entries')
              .select('date,cash_income,terminal_income,card_income,playstation_income,created_at')
              .eq('club_id', selectedClubId)
              .order('date', { ascending: true })
              .order('created_at', { ascending: true }),
            financeRange,
          ),
        ),
        fetchAllRows<StockCountRow>(() =>
          inRangeQuery(
            supabase
              .from('daily_stock_counts')
              .select('product_id,date,bar_income,bar_profit,bar_cost,sold_quantity,updated_at')
              .eq('club_id', selectedClubId)
              .order('date', { ascending: true })
              .order('product_id', { ascending: true }),
            financeRange,
          ),
        ),
        fetchAllRows<ExpenseRow>(() =>
          inRangeQuery(
            supabase
              .from('expenses')
              .select('id,date,amount,category,payment_method,payment_source,comment,created_at')
              .eq('club_id', selectedClubId)
              .order('date', { ascending: true })
              .order('id', { ascending: true }),
            financeRange,
          ),
        ),
        fetchActiveProductsOrdered(supabase, selectedClubId),
        fetchAllRows<DebtRow>(() =>
          supabase
            .from('new_debts')
            .select('id,person_name,date,amount,remaining_amount,status')
            .eq('club_id', selectedClubId)
            .order('created_at', { ascending: false })
            .order('id', { ascending: true }),
        ),
        fetchAllRows<DebtPaymentValueRow>(() =>
          inRangeQuery(
            supabase
              .from('debt_payments')
              .select('id,date,amount,payment_method')
              .eq('club_id', selectedClubId)
              .order('date', { ascending: true })
              .order('id', { ascending: true }),
            financeRange,
          ),
        ),
        fetchAllRows<StockPurchaseRow>(() =>
          inRangeQuery(
            supabase
              .from('stock_purchases')
              .select('id,date,quantity,cost_price,comment,created_at')
              .eq('club_id', selectedClubId)
              .order('date', { ascending: true })
              .order('id', { ascending: true }),
            financeRange,
          ),
        ),
        fetchAllRows<InventorySnapshotRow>(() =>
          supabase
            .from('daily_stock_counts')
            .select('product_id,date,closing_stock,cost_price,products(tracks_inventory)')
            .eq('club_id', selectedClubId)
            .gte('date', inventoryQueryRange.from)
            .lte('date', inventoryQueryRange.to)
            .order('date', { ascending: true })
            .order('product_id', { ascending: true }),
        ),
      ]);

      if (requestId !== requestSequence.current) return;

      const firstError = [
        cashRes.error,
        stockRes.error,
        expenseRes.error,
        productRes.error,
        debtRes.error,
        debtPaymentRes.error,
        purchaseRes.error,
        inventorySnapshotRes.error,
      ].find(Boolean);

      if (firstError) {
        setError(true);
        setLoading(false);
        return;
      }

      const allCashRows = (cashRes.data ?? []) as DailyCashRow[];
      const allStockRows = (stockRes.data ?? []) as StockCountRow[];
      const allExpenseRows = (expenseRes.data ?? []) as ExpenseRow[];
      const products = (productRes.data ?? []) as Product[];
      const debts = (debtRes.data ?? []) as DebtRow[];
      const allPurchases = (purchaseRes.data ?? []) as unknown as StockPurchaseRow[];
      const allDebtPayments = (debtPaymentRes.data ?? []) as DebtPaymentValueRow[];
      const cashRows = allCashRows.filter((row) => row.date >= range.from && row.date <= range.to);
      const stockRows = allStockRows.filter((row) => row.date >= range.from && row.date <= range.to);
      const expenseRows = allExpenseRows.filter((row) => row.date >= range.from && row.date <= range.to);
      const purchases = allPurchases.filter((row) => row.date >= range.from && row.date <= range.to);
      const debtPayments = allDebtPayments.filter((row) => row.date >= range.from && row.date <= range.to);
      const activeDebts = debts.filter((debt) => debt.status !== 'paid');
      const rangeDebts = debts.filter((debt) => debt.date >= range.from && debt.date <= range.to);
      const inventorySnapshotRows = (inventorySnapshotRes.data ?? []) as InventorySnapshotRow[];
      const inventoryComparisonRows = inventorySnapshotRows.filter(
        (row) => row.date >= inventoryComparisonRange.from && row.date <= inventoryComparisonRange.to,
      );

      const liveTotals = calculateDashboardTotals(
        cashRows,
        stockRows,
        purchases,
        expenseRows,
        products,
        rangeDebts,
        debtPayments,
        activeDebts,
      );
      const totals = {
        ...liveTotals,
        inventoryValue: calculateDashboardInventoryValue(
          DASHBOARD_PERIOD,
          liveTotals.inventoryValue,
          inventorySnapshotRows,
          range,
        ),
      };
      const inventoryComparisonValue = calculateInventoryValueFromLatestStockCounts(
        inventoryComparisonRows,
      );
      const moneyLeftByPaymentMethod = calculateGameClubMoneyLeftByPaymentMethod(
        cashRows,
        expenseRows,
        debtPayments,
      );
      const latestDailyCashEntryDate = getLatestRowDateInRange([...cashRows, ...rangeDebts], range);
      const latestBarEntryDate = getLatestRowDateInRange(stockRows, range);
      const trend = buildPeriodTrend(range, cashRows, stockRows, purchases, expenseRows, rangeDebts);
      const lowStockCount = products.filter(
        (product) => product.tracks_inventory !== false
          && product.current_stock <= (product.low_stock_threshold ?? 5),
      ).length;
      const expenseCategories = Array.from(
        expenseRows.reduce((categoryMap, row) => {
          categoryMap.set(row.category, (categoryMap.get(row.category) ?? 0) + Number(row.amount ?? 0));
          return categoryMap;
        }, new Map<string, number>()),
        ([category, value]) => ({ category, value }),
      ).sort((a, b) => b.value - a.value);
      const previousDebts = debts.filter(
        (debt) => debt.date >= previousRange.from && debt.date <= previousRange.to,
      );
      const previousTotals = calculateDashboardTotals(
        allCashRows.filter((row) => row.date >= previousRange.from && row.date <= previousRange.to),
        allStockRows.filter((row) => row.date >= previousRange.from && row.date <= previousRange.to),
        allPurchases.filter((row) => row.date >= previousRange.from && row.date <= previousRange.to),
        allExpenseRows.filter((row) => row.date >= previousRange.from && row.date <= previousRange.to),
        products,
        previousDebts,
        allDebtPayments.filter((row) => row.date >= previousRange.from && row.date <= previousRange.to),
        activeDebts,
      );

      setData({
        totals,
        previousTotals,
        inventoryComparisonValue,
        hasInventoryComparisonData: inventoryComparisonRows.length > 0,
        trend,
        lowStockCount,
        expenseCategories,
        moneyLeftByPaymentMethod,
        latestDailyCashEntryDate,
        latestBarEntryDate,
      });
      displayedRequestKey.current = requestKey;
      setLoading(false);
    } catch {
      if (requestId !== requestSequence.current) return;
      setError(true);
      setLoading(false);
    }
  }, [businessToday, range, selectedClubId]);

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

  const incomeComparisonLabel = t('vsLastMonth');

  const comparisonFor = (current: number, previous: number, label = incomeComparisonLabel) => {
    const value = percentChange(current, previous);
    return { value, label: value === null ? t('noComparisonData') : label };
  };

  const trend = useMemo(
    () => data.trend.map((row) => ({
      ...row,
      date: formatDateShort(row.date, locale),
    })),
    [data.trend, locale],
  );
  const averageBarDayCount = countDashboardRangeDaysThroughDate(range, data.latestBarEntryDate);
  const averageGameClubDayCount = countDashboardRangeDaysThroughDate(range, data.latestDailyCashEntryDate);
  const averageGameClubIncome = calculateAverageDailyIncome(totals.gameClubIncome, averageGameClubDayCount);
  const averageBarIncome = calculateAverageDailyIncome(totals.barSales, averageBarDayCount);


  const detailsQuery = new URLSearchParams({ from: range.from, to: range.to }).toString();

  // Secondary metrics: a MetricCard each; a zero with no comparison is muted.
  const secondaryMetric = (
    amount: number,
    comparison: Comparison | undefined,
    tone: MetricTone = 'default',
  ) => {
    const idle = isIdleMetric(amount, comparison);
    return {
      value: <MetricAmount amount={amount} currency={currency} />,
      tone: idle ? ('muted' as const) : tone,
      ...(idle ? {} : comparisonTrend(comparison)),
    };
  };

  const playstationComparison = comparisonFor(totals.playstationIncome, previousTotals.playstationIncome);
  const moneyLeftComparison = comparisonFor(totals.gameClubMoneyLeft, previousTotals.gameClubMoneyLeft);
  const barMoneyLeftComparison = comparisonFor(totals.barIncome, previousTotals.barIncome);
  const barProfitComparison = comparisonFor(totals.barProfit, previousTotals.barProfit);
  const inventoryComparison = data.hasInventoryComparisonData
    ? comparisonFor(
        totals.inventoryValue,
        data.inventoryComparisonValue,
        t('vsLastMonth'),
      )
    : undefined;
  const inventoryHelper = data.hasInventoryComparisonData
    ? `${t('lastMonthInventoryValue')}: ${formatCurrency(data.inventoryComparisonValue)} ${currency}`
    : t('lowStockAlertsCount', { count: data.lowStockCount });

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        title={t('title')}
        className="mb-0"
      />

      {error && (
        <InlineAlert
          variant="danger"
          action={(
            <Button size="sm" variant="outline" onClick={retryDashboard} icon={<RefreshCcw size={15} aria-hidden="true" />}>
              {tc('retry')}
            </Button>
          )}
        >
          {t('loadErrorDashboard')}
        </InlineAlert>
      )}

      {/* Headline numbers: the four figures an owner checks first. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('gameClubIncome')}
          amount={totals.computerIncome}
          icon={MonitorSmartphone}
          tone="success"
          comparison={comparisonFor(totals.computerIncome, previousTotals.computerIncome)}
        />
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('barSales')}
          amount={totals.barSales}
          icon={ShoppingBag}
          tone="success"
          comparison={comparisonFor(totals.barSales, previousTotals.barSales)}
        />
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('totalExpenses')}
          amount={totals.totalExpenses}
          icon={ArrowDownRight}
          tone="danger"
          comparison={comparisonFor(totals.totalExpenses, previousTotals.totalExpenses)}
          comparisonGoodWhen="down"
        />
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('netProfit')}
          amount={totals.accountingNetProfit}
          icon={totals.accountingNetProfit < 0 ? ArrowDownRight : ArrowUpRight}
          tone={toneForAmount(totals.accountingNetProfit)}
          comparison={comparisonFor(totals.accountingNetProfit, previousTotals.accountingNetProfit)}
        />
      </div>

      <MetricSection
        id="dashboard-game-club"
        title={t('gameClubPlaystationSection')}
        actionLabel={t('details')}
        actionHref={`/game-club-money-details?${detailsQuery}`}
      >
        <MetricCard
          loading={loading}
          label={t('playstationIncome')}
          {...secondaryMetric(totals.playstationIncome, playstationComparison)}
        />
        <MetricCard
          loading={loading}
          label={t('activeDebts')}
          helper={t('activeDebtsDesc', { count: totals.activeDebtCount })}
          {...secondaryMetric(totals.activeDebts, undefined, 'danger')}
        />
        <MetricCard
          loading={loading}
          label={<span title={t('averageDailyClubIncomeDesc')}>{t('averageDailyIncome')}</span>}
          {...secondaryMetric(averageGameClubIncome, undefined)}
        />
        <MetricCard
          loading={loading}
          label={<span title={t('totalMoneyLeftDesc')}>{t('totalMoneyLeft')}</span>}
          {...secondaryMetric(totals.gameClubMoneyLeft, moneyLeftComparison, toneForAmount(totals.gameClubMoneyLeft))}
        />
      </MetricSection>

      <MetricSection
        id="dashboard-bar"
        title={t('barStatisticsSection')}
        actionLabel={t('details')}
        actionHref={`/bar-money-details?${detailsQuery}`}
      >
        <MetricCard
          loading={loading}
          label={<span title={t('barMoneyLeftDesc')}>{t('barMoneyLeft')}</span>}
          {...secondaryMetric(totals.barIncome, barMoneyLeftComparison, toneForAmount(totals.barIncome))}
        />
        <MetricCard
          loading={loading}
          label={<span title={t('averageDailyBarIncomeDesc')}>{t('averageDailyIncome')}</span>}
          {...secondaryMetric(averageBarIncome, undefined)}
        />
        <MetricCard
          loading={loading}
          label={<span title={t('barNetProfitDesc')}>{t('barNetProfit')}</span>}
          {...secondaryMetric(totals.barProfit, barProfitComparison, toneForAmount(totals.barProfit))}
        />
        <MetricCard
          loading={loading}
          label={<span title={t('inventoryValueDesc')}>{t('inventoryValue')}</span>}
          helper={inventoryHelper}
          {...secondaryMetric(totals.inventoryValue, inventoryComparison)}
        />
      </MetricSection>

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
          <IncomeTrendChart data={trend} />
        </div>
      )}

      <Card as="section" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ChartPie size={20} className="mt-0.5 shrink-0 text-primary-600" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-950">{t('analysisLinkTitle')}</h2>
            <p className="mt-0.5 text-xs leading-5 text-gray-500">{t('analysisLinkDesc')}</p>
          </div>
        </div>
        <ButtonLink
          href={`/financial-analysis?${detailsQuery}`}
          variant="outline"
          size="sm"
          iconRight={<ArrowRight size={15} aria-hidden="true" />}
        >
          {t('analysisLinkAction')}
        </ButtonLink>
      </Card>
    </div>
  );
}
