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
  LoadErrorAlert,
  MetricMoney,
  PageHeader,
  StatTile,
  toneForAmount,
  type MetricTone,
} from '@/components/PresentationFoundation';
import { MoneyFlowSankeys } from '@/components/financial-analysis/MoneyFlowSankeys';
import { fetchAnalysisLedgers } from '@/lib/supabase/analysisLedgers';
import type { AnalysisLedgers } from '@/lib/calculations/financialAnalysis';
import { useClubQuery } from '@/lib/useClubQuery';
import { formatCurrency } from '@/lib/formatters';
import {
  calculateAverageDailyIncome,
  countDashboardRangeDaysThroughDate,
  percentChange,
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

const emptyLedgers: AnalysisLedgers = {
  cashRows: [],
  stockRows: [],
  purchaseRows: [],
  expenseRows: [],
  debtRows: [],
  debtPaymentRows: [],
};

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
          label={<span title={item.helper}>{item.label}</span>}
          tone={loading ? 'muted' : item.tone}
          value={loading ? '—' : <MetricMoney amount={item.amount} currency={item.currency} />}
        />
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
  const { selectedClubId, businessDayStartHour } = useClub();
  const { locale } = useAppLocale();
  const businessToday = useBusinessToday(businessDayStartHour);
  // The dashboard always shows the club's current business month.
  const snapshotRanges = useMemo(() => getDashboardSnapshotRanges(businessToday), [businessToday]);
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

  const incomeComparisonLabel = t('vsLastMonth');

  const comparisonFor = (current: number, previous: number, label = incomeComparisonLabel) => {
    const value = percentChange(current, previous);
    return { value, label: value === null ? t('noComparisonData') : label };
  };

  const trend = useMemo(
    // Days after today have no data yet; drawing them only adds an empty tail.
    () => data.trend.filter((row, index) => index === 0 || row.date <= businessToday).map((row) => ({
      ...row,
      date: formatDateShort(row.date, locale),
    })),
    [data.trend, businessToday, locale],
  );
  const averageBarDayCount = countDashboardRangeDaysThroughDate(range, data.latestBarEntryDate);
  const averageGameClubDayCount = countDashboardRangeDaysThroughDate(range, data.latestDailyCashEntryDate);
  const averageGameClubIncome = calculateAverageDailyIncome(totals.gameClubIncome, averageGameClubDayCount);
  const averageBarIncome = calculateAverageDailyIncome(totals.barSales, averageBarDayCount);


  const detailsQuery = new URLSearchParams({ from: range.from, to: range.to }).toString();
  const periodLabel = `${formatDateShort(range.from, locale)} – ${formatDateShort(range.to, locale)}`;
  const barProfitComparison = comparisonFor(totals.barProfit, previousTotals.barProfit);
  const inventoryHelper = data.hasInventoryComparisonData
    ? `${t('lastMonthInventoryValue')}: ${formatCurrency(data.inventoryComparisonValue)} ${currency}`
    : t('lowStockAlertsCount', { count: data.lowStockCount });

  // The money flows need the period's payments, which the snapshot does not carry.
  const loadLedgers = useCallback(async () => (
    selectedClubId ? { clubId: selectedClubId, ledgers: await fetchAnalysisLedgers(createClient(), selectedClubId, range) } : null
  ), [range, selectedClubId]);
  const ledgerQuery = useClubQuery<{ clubId: string; ledgers: AnalysisLedgers } | null>(loadLedgers, null);
  // Ledgers remember their club, so another club's rows never render as current.
  const ledgers = ledgerQuery.data?.clubId === selectedClubId ? ledgerQuery.data.ledgers : emptyLedgers;
  const flowsLoading = loading || ledgerQuery.loading;

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
      />

      {error && (
        <LoadErrorAlert retrying={loading} onRetry={retryDashboard}>
          {t('loadErrorDashboard')}
        </LoadErrorAlert>
      )}

      {/* Headline numbers: the four figures an owner checks first. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
        {/* The game club and the bar are separate businesses: each keeps its own profit. */}
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('gameClubNetProfit')}
          amount={totals.gameClubProfit}
          icon={totals.gameClubProfit < 0 ? ArrowDownRight : ArrowUpRight}
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
          tone={toneForAmount(totals.barProfit)}
          comparison={barProfitComparison}
          helper={t('barNetProfitDesc')}
        />
      </div>

      {ledgerQuery.error && (
        <LoadErrorAlert retrying={ledgerQuery.loading} onRetry={() => void ledgerQuery.reload()}>
          {t('loadErrorFlows')}
        </LoadErrorAlert>
      )}

      {/* Each business gets its own money flow; tapping a node opens the Sankey behind it. */}
      {flowsLoading && !ledgerQuery.data ? (
        <div className="grid gap-3 2xl:grid-cols-2" role="status" aria-label={t('loading')}>
          <ChartLoading />
          <ChartLoading />
        </div>
      ) : (
        <MoneyFlowSankeys
          className={cn('grid items-start gap-3 2xl:grid-cols-2 transition-opacity', flowsLoading && 'pointer-events-none opacity-60')}
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
                  { label: t('inventoryValue'), helper: `${t('inventoryValueDesc')} ${inventoryHelper}`, amount: totals.inventoryValue, currency },
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

    </div>
  );
}
