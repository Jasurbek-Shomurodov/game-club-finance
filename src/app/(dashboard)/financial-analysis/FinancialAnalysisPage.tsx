'use client';

// Route: /financial-analysis

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SIDE_ICONS } from '@/components/sideIcons';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { usePathname, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fetchAnalysisLedgers } from '@/lib/supabase/analysisLedgers';
import { fetchExpensePresets, fetchPresetExpenses } from '@/lib/supabase/expensePresets';
import { fetchMoneyExchanges } from '@/lib/supabase/moneyExchanges';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessRollover } from '@/lib/useBusinessPeriod';
import { useClubQuery } from '@/lib/useClubQuery';
import { canAccessPath } from '@/lib/permissions';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useClub } from '@/components/layout/DashboardShell';
import { cn, monthRange } from '@/lib/utils';
import { formatCurrency, formatDateShort } from '@/lib/formatters';
import {
  ChartSkeleton,
  LoadErrorAlert,
  MonthPicker,
  PageHeader,
  SegmentedControl,
  TappableSurface,
} from '@/components/PresentationFoundation';
import { ChartCard, ChartEmpty, chartColors } from '@/components/dashboard/ChartCard';
import {
  getDashboardComparisonRange,
  percentChange,
} from '@/lib/calculations/dashboardMetrics';
import {
  BAR_COST_TARGET,
  buildCategoryComparison,
  buildCategoryDetail,
  buildFinancialAnalysis,
  buildMonthlyAnalysis,
  buildPlaystationDaily,
  visiblePaymentMethodRows,
  type AnalysisLedgers,
  type MonthlyAnalysisRow,
  type PaymentMethodFlowRow,
  type PlaystationDayRow,
} from '@/lib/calculations/financialAnalysis';
import { buildExpensePlanSummary, type ExpensePreset, type ExpensePlanSummary } from '@/lib/calculations/expensePlans';
import { buildMoneyChecks, moneyCheckHistoryStart } from '@/lib/calculations/moneyChecks';
import type { MoneyExchangeRow } from '@/lib/calculations/moneyExchanges';
import { ExpensePlanPanel } from '@/components/financial-analysis/ExpensePlanPanel';
import { MoneyChecksPanel, MoneyChecksPanelSkeleton } from '@/components/financial-analysis/MoneyChecksPanel';
import { MoneyFlowSankeys } from '@/components/financial-analysis/MoneyFlowSankeys';
import {
  CategoryComparison,
  CategoryDonut,
  LargestPayments,
  PaymentMethodFlow,
} from '@/components/financial-analysis/AnalysisPanels';
import { CategoryDrawer } from '@/components/financial-analysis/CategoryDrawer';
import { Section, SideScorecard } from '@/components/financial-analysis/AnalysisSections';
import { OverallAnalysis } from '@/components/financial-analysis/OverallAnalysis';
import { categoryColors, formatShare } from '@/components/financial-analysis/analysisFormat';
import { moneyDetailsHref, reportsHref } from '@/lib/detailLinks';
import { AnalysisBodySkeleton } from './FinancialAnalysisSkeleton';
import { scrollBehavior } from '@/lib/scroll';

function ChartLoading() {
  return <ChartSkeleton />;
}

// Charts render only after the ledgers arrive; the page starts this download on
// mount so the recharts chunk loads alongside the data instead of after it.
const loadTimeCharts = () => import('@/components/financial-analysis/AnalysisTimeCharts');
const DailyFlowChart = dynamic(
  () => loadTimeCharts().then((module) => module.DailyFlowChart),
  { ssr: false, loading: ChartLoading },
);
const PlaystationDailyChart = dynamic(
  () => loadTimeCharts().then((module) => module.PlaystationDailyChart),
  { ssr: false, loading: ChartLoading },
);
const MonthlyTrendChart = dynamic(
  () => loadTimeCharts().then((module) => module.MonthlyTrendChart),
  { ssr: false, loading: ChartLoading },
);

type Range = { from: string; to: string };

const emptyLedgers: AnalysisLedgers = {
  cashRows: [],
  stockRows: [],
  purchaseRows: [],
  expenseRows: [],
  debtRows: [],
  debtPaymentRows: [],
};

const inRange = <T extends { date?: string }>(rows: T[], range: Range) =>
  rows.filter((row) => row.date !== undefined && row.date >= range.from && row.date <= range.to);

const containsRange = (outer: Range, inner: Range) => inner.from >= outer.from && inner.to <= outer.to;

function sliceLedgers(ledgers: AnalysisLedgers, range: Range): AnalysisLedgers {
  return {
    cashRows: inRange(ledgers.cashRows, range),
    stockRows: inRange(ledgers.stockRows, range),
    purchaseRows: [],
    expenseRows: inRange(ledgers.expenseRows, range),
    debtRows: inRange(ledgers.debtRows, range),
    debtPaymentRows: inRange(ledgers.debtPaymentRows, range),
    reserveMoves: inRange(ledgers.reserveMoves ?? [], range),
  };
}

function firstMonthOfWindow(businessToday: string, months = 12): string {
  const [year, month] = businessToday.split('-').map(Number);
  const absolute = year * 12 + month - months;
  return `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, '0')}-01`;
}

type AnalysisView = 'monthly' | 'overall';

/** The month in the link (`month`, or the month a dashboard `from`/`to` range ends in), else the business month. */
function initialMonth(searchParams: URLSearchParams | { get(name: string): string | null }, businessMonth: string): string {
  const fromQuery = searchParams.get('month') ?? searchParams.get('to')?.slice(0, 7) ?? null;
  return fromQuery && /^\d{4}-(0[1-9]|1[0-2])$/.test(fromQuery) && fromQuery <= businessMonth ? fromQuery : businessMonth;
}

export default function FinancialAnalysisPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { businessDayStartHour } = useClub();
  const t = useTranslations('financialAnalysis');
  const businessToday = useBusinessToday(businessDayStartHour);
  const businessMonth = businessToday.slice(0, 7);
  const [view, setView] = useState<AnalysisView>(() => (searchParams.get('view') === 'overall' ? 'overall' : 'monthly'));
  const [month, setMonth] = useState(() => initialMonth(searchParams, businessMonth));
  const range = useMemo(() => monthRange(month), [month]);

  // A month the user picked is kept on rollover; the default month follows the business month.
  useBusinessRollover(businessMonth, (previousMonth, nextMonth) => {
    setMonth((current) => (current === previousMonth ? nextMonth : current));
  });

  // Keep the view and month shareable.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ['period', 'from', 'to', 'month', 'view']) params.delete(key);
    if (view === 'overall') params.set('view', 'overall');
    else params.set('month', month);
    const nextQuery = params.toString();
    if (nextQuery !== searchParams.toString()) {
      window.history.replaceState(null, '', `${pathname}?${nextQuery}`);
    }
  }, [month, pathname, searchParams, view]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        className="mb-0"
        tabs={(
          <SegmentedControl
            variant="tabs"
            label={t('viewSwitcher')}
            options={[
              { value: 'monthly', label: t('monthlyView') },
              { value: 'overall', label: t('overallView') },
            ]}
            value={view}
            onChange={setView}
          />
        )}
        action={view === 'monthly' ? (
          <MonthPicker value={month} max={businessMonth} onChange={setMonth} className="sm:w-56" />
        ) : undefined}
      />
      {view === 'monthly'
        ? <MonthlyAnalysis range={range} businessToday={businessToday} />
        : (
          <OverallAnalysis
            businessToday={businessToday}
            onOpenMonth={(nextMonth) => {
              setMonth(nextMonth);
              setView('monthly');
              window.scrollTo({ top: 0, behavior: scrollBehavior() });
            }}
          />
        )}
    </div>
  );
}

function MonthlyAnalysis({ range, businessToday }: { range: Range; businessToday: string }) {
  const { selectedClubId, enabledPaymentMethods, role, featureAccess } = useClub();
  const { locale } = useAppLocale();
  const t = useTranslations('financialAnalysis');
  const td = useTranslations('dashboard');
  const tc = useTranslations('common');
  const tCategories = useTranslations('expenses.categories');
  const currency = tc('currency');
  // The current month is compared with the same days of last month; a past month with all of the month before.
  const previousRange = useMemo(
    () => getDashboardComparisonRange(range.from.slice(0, 7) === businessToday.slice(0, 7) ? 'month' : 'lastMonth', range, businessToday),
    [businessToday, range],
  );
  // The 12-month trend window; a selected month inside it reuses its read. It
  // ends with the current month (not today) so the current month, whose range
  // runs to the month's last day, shares this one RPC.
  const monthlyWindow = useMemo(
    () => ({ from: firstMonthOfWindow(businessToday), to: monthRange(businessToday.slice(0, 7)).to }),
    [businessToday],
  );

  useEffect(() => {
    void loadTimeCharts().catch(() => {
      // dynamic() retries and shows its own fallback when the chart renders.
    });
  }, []);

  const windowRequest = useRef<{ key: string; promise: Promise<AnalysisLedgers> } | null>(null);
  // The category stays set while the drawer slides out, so its content does not vanish mid-animation.
  const [drawerCategory, setDrawerCategory] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadMonthlyWindow = useCallback((clubId: string) => {
    const key = `${clubId}:${monthlyWindow.from}:${monthlyWindow.to}`;
    if (windowRequest.current?.key === key) return windowRequest.current.promise;
    const promise = fetchAnalysisLedgers(createClient(), clubId, monthlyWindow);
    windowRequest.current = { key, promise };
    promise.catch(() => {
      if (windowRequest.current?.promise === promise) windowRequest.current = null;
    });
    return promise;
  }, [monthlyWindow]);

  // One read covers the selected and comparison periods and the history the
  // money checks compare with; they are split in memory. When all of it falls
  // inside the 12-month window, that read is reused.
  const loadLedgers = useCallback(async () => {
    if (!selectedClubId) return null;
    const fetchRange = {
      from: [previousRange.from, range.from, moneyCheckHistoryStart(range)].sort()[0],
      to: previousRange.to > range.to ? previousRange.to : range.to,
    };
    const [rows, exchangeRows] = await Promise.all([
      containsRange(monthlyWindow, fetchRange)
        ? loadMonthlyWindow(selectedClubId)
        : fetchAnalysisLedgers(createClient(), selectedClubId, fetchRange),
      // Exchanges (092) only move money between the method rows of the selected month.
      fetchMoneyExchanges(createClient(), selectedClubId, range.from, range.to),
    ]);
    return { clubId: selectedClubId, ledgers: rows, exchangeRows };
  }, [loadMonthlyWindow, monthlyWindow, previousRange.from, previousRange.to, range, selectedClubId]);
  // Ledgers remember their club, so another club's rows never render as current.
  const ledgerQuery = useClubQuery<{ clubId: string; ledgers: AnalysisLedgers; exchangeRows: MoneyExchangeRow[] } | null>(loadLedgers, null);
  const loadedLedgers = ledgerQuery.data && ledgerQuery.data.clubId === selectedClubId ? ledgerQuery.data : null;
  const ledgers = loadedLedgers?.ledgers ?? emptyLedgers;
  const exchangeRows = loadedLedgers?.exchangeRows;
  const loading = ledgerQuery.loading;
  const error = ledgerQuery.error;

  const loadMonthly = useCallback(async () => (
    buildMonthlyAnalysis(businessToday, selectedClubId ? await loadMonthlyWindow(selectedClubId) : emptyLedgers)
  ), [businessToday, loadMonthlyWindow, selectedClubId]);
  const monthlyQuery = useClubQuery<MonthlyAnalysisRow[] | null>(loadMonthly, null);
  // The trend chart shows its skeleton while any read of it is in flight.
  const monthly = monthlyQuery.loading ? null : monthlyQuery.data;
  const monthlyError = monthlyQuery.error;

  // Planned expenses (091) for the selected range; absent until a club sets some up.
  // The presets also tell the money checks which categories the plans cover.
  const loadPlans = useCallback(async () => {
    if (!selectedClubId) return null;
    const supabase = createClient();
    const [{ presets, available }, expenses] = await Promise.all([
      fetchExpensePresets(supabase, selectedClubId),
      fetchPresetExpenses(supabase, selectedClubId, range),
    ]);
    if (!available || presets.length === 0) return { clubId: selectedClubId, presets: [], summary: null };
    return { clubId: selectedClubId, presets, summary: buildExpensePlanSummary(presets, expenses, range) };
  }, [range, selectedClubId]);
  const planQuery = useClubQuery<{ clubId: string; presets: ExpensePreset[]; summary: ExpensePlanSummary | null } | null>(loadPlans, null);
  const loadedPlans = planQuery.data && planQuery.data.clubId === selectedClubId ? planQuery.data : null;
  const plans = loadedPlans?.summary ?? null;

  // A failed window read is evicted above, so a retry reads it afresh while a
  // successful one is shared; the page-level retry covers both queries.
  const retryAll = () => {
    void Promise.all([ledgerQuery.reload(), monthlyQuery.reload(), planQuery.reload()]);
  };

  const current = useMemo(() => sliceLedgers(ledgers, range), [ledgers, range]);
  // What looks off in the month, against the history the ledger read covers.
  // Until the plans settle it is unknown which categories they cover; a failed
  // plan read leaves every category to the checks.
  const plansSettled = !!loadedPlans || planQuery.error;
  const moneyChecks = useMemo(
    () => (loadedLedgers && plansSettled
      ? buildMoneyChecks({
        range,
        today: businessToday,
        expenseRows: loadedLedgers.ledgers.expenseRows,
        cashRows: loadedLedgers.ledgers.cashRows,
        stockRows: loadedLedgers.ledgers.stockRows,
        presets: loadedPlans?.presets ?? [],
      })
      : null),
    [businessToday, loadedLedgers, loadedPlans, plansSettled, range],
  );
  const checkAccess = useMemo(() => ({
    canOpen: (path: string) => canAccessPath(role, featureAccess, path),
    isOwner: role === 'owner',
    businessMonth: businessToday.slice(0, 7),
  }), [businessToday, featureAccess, role]);
  const previous = useMemo(() => sliceLedgers(ledgers, previousRange), [ledgers, previousRange]);
  // Average daily income follows the dashboard: each side through its latest entry in the range.
  const analysis = useMemo(() => buildFinancialAnalysis(range, current, { exchangeRows }), [current, exchangeRows, range]);
  // Days after today have no data yet; drawing them only adds an empty tail (as on the dashboard).
  const dailyRows = useMemo(
    () => analysis.daily.filter((row, index) => index === 0 || row.date <= businessToday),
    [analysis.daily, businessToday],
  );
  const previousAnalysis = useMemo(() => buildFinancialAnalysis(previousRange, previous), [previous, previousRange]);
  // PlayStation money, collected with each day's cash: how it grows day over day in the period.
  const playstationDays = useMemo(
    () => buildPlaystationDaily(range, current.cashRows, businessToday),
    [range, current.cashRows, businessToday],
  );
  const comparison = useMemo(
    () => buildCategoryComparison(current.expenseRows, previous.expenseRows),
    [current.expenseRows, previous.expenseRows],
  );
  const colors = useMemo(() => categoryColors(analysis.topCategories), [analysis.topCategories]);
  const categoryDetail = useMemo(
    () => (drawerCategory
      ? buildCategoryDetail(drawerCategory, current.expenseRows, previous.expenseRows, analysis.topCategories)
      : null),
    [analysis.topCategories, current.expenseRows, drawerCategory, previous.expenseRows],
  );
  const openCategory = useCallback((category: string) => {
    setDrawerCategory(category);
    setDrawerOpen(true);
  }, []);

  const categoryName = useCallback((category: string) => {
    if (category === BAR_COST_TARGET) return t('barCost');
    return tCategories.has(category)
      ? tCategories(category as Parameters<typeof tCategories>[0])
      : category.replace(/_/g, ' ');
  }, [t, tCategories]);
  const periodLabel = `${formatDateShort(range.from, locale)} – ${formatDateShort(range.to, locale)}`;
  const methodName = (method: PaymentMethodFlowRow['method']) => td(method);

  const { indicators } = analysis;
  const previousIndicators = previousAnalysis.indicators;
  const comparisonLabel = t('vsPrevious');
  const compare = (now: number, before: number) => {
    const value = percentChange(now, before);
    return { value, label: value === null ? td('noComparisonData') : comparisonLabel };
  };

  const scoreLabels = { spent: t('spent'), profit: t('profit'), margin: t('margin'), perDay: t('scorePerDay'), kept: t('scoreKept') };
  const visibleMethods = visiblePaymentMethodRows(analysis.paymentMethods, enabledPaymentMethods);
  const hasActivity = [indicators.gameClub, indicators.bar].some((side) => side.income > 0 || side.spent > 0);

  return (
    <>
      {error && (
        <LoadErrorAlert retrying={loading} onRetry={retryAll}>
          {t('loadError')}
        </LoadErrorAlert>
      )}

      {/* After a failed load the figures are unknown, not zero: show only the error. */}
      {!error && (
        <>
          {/* One scorecard per side: in, spent, profit, margin and daily average at a glance. */}
          <div className="grid gap-3 lg:grid-cols-2">
            <SideScorecard
              title={td('gameClub')}
              detailsHref={moneyDetailsHref('game_club', range)}
              spentHref={reportsHref(range, { category: 'expense', source: 'game_club' })}
              icon={SIDE_ICONS.gameClub}
              accent="primary"
              color={chartColors.primary}
              incomeLabel={t('moneyIn')}
              now={indicators.gameClub}
              before={previousIndicators.gameClub}
              compare={compare}
              loading={loading}
              currency={currency}
              locale={locale}
              labels={scoreLabels}
            />
            <SideScorecard
              title={td('bar')}
              detailsHref={moneyDetailsHref('bar', range)}
              spentHref={reportsHref(range, { category: 'expense', source: 'bar' })}
              icon={SIDE_ICONS.bar}
              accent="bar"
              color={chartColors.orange}
              incomeLabel={t('barSalesIn')}
              now={indicators.bar}
              before={previousIndicators.bar}
              compare={compare}
              loading={loading}
              currency={currency}
              locale={locale}
              labels={scoreLabels}
            />
          </div>

          {loading && !hasActivity ? (
            <div className="space-y-4" role="status" aria-label={tc('loading')}>
              <AnalysisBodySkeleton />
            </div>
          ) : (
            <div className={cn('space-y-6 transition-opacity motion-reduce:transition-none', loading && 'pointer-events-none opacity-60')} aria-busy={loading || undefined}>
              {/* Rows read before a month switch would judge the new month against the wrong history. */}
              {moneyChecks && !loading ? (
                <MoneyChecksPanel
                  checks={moneyChecks}
                  labelFor={categoryName}
                  access={checkAccess}
                  currency={currency}
                  locale={locale}
                />
              ) : <MoneyChecksPanelSkeleton />}

              {planQuery.error ? (
                <Section title={t('planSection')}>
                  <LoadErrorAlert retrying={planQuery.loading} onRetry={() => void planQuery.reload()}>
                    {t('planLoadError')}
                  </LoadErrorAlert>
                </Section>
              ) : plans && (plans.gameClub.rows.length > 0 || plans.bar.rows.length > 0) && (
                <Section title={t('planSection')} description={t('planSectionDesc')}>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {plans.gameClub.rows.length > 0 && (
                      <ExpensePlanPanel
                        title={td('gameClub')}
                        icon={SIDE_ICONS.gameClub}
                        accent="primary"
                        side={plans.gameClub}
                        rowHref={(row) => reportsHref(range, { category: `expense:${row.preset.category}`, source: row.preset.payment_source })}
                        currency={currency}
                        locale={locale}
                      />
                    )}
                    {plans.bar.rows.length > 0 && (
                      <ExpensePlanPanel
                        title={td('bar')}
                        icon={SIDE_ICONS.bar}
                        accent="bar"
                        side={plans.bar}
                        rowHref={(row) => reportsHref(range, { category: `expense:${row.preset.category}`, source: row.preset.payment_source })}
                        currency={currency}
                        locale={locale}
                      />
                    )}
                  </div>
                </Section>
              )}

              <Section title={t('flowSection')} description={t('flowSectionDesc')}>
                <MoneyFlowSankeys
                  className="space-y-3"
                  ledgers={current}
                  range={range}
                  colors={colors}
                  periodLabel={periodLabel}
                  locale={locale}
                  currency={currency}
                  gameClub={{ title: t('gameClubFlowTitle'), description: t('flowDesc') }}
                  bar={{ title: t('barFlowTitle'), description: t('flowDesc') }}
                />

                <div className="grid gap-4 lg:grid-cols-2">
                  <ChartCard title={t('categoriesTitle')} description={t('categoriesDesc')}>
                    <CategoryDonut
                      categories={analysis.topCategories}
                      colors={colors}
                      total={analysis.totals.totalExpenses}
                      labelFor={categoryName}
                      locale={locale}
                      currency={currency}
                      onSelect={openCategory}
                    />
                  </ChartCard>
                  <ChartCard title={t('compareTitle')} description={t('compareDesc')}>
                    <CategoryComparison
                      rows={comparison}
                      colors={colors}
                      labelFor={categoryName}
                      locale={locale}
                      currency={currency}
                      onSelect={openCategory}
                    />
                  </ChartCard>
                </div>
              </Section>

              <Section title={t('trendsSection')} description={t('trendsSectionDesc')}>
                <ChartCard title={t('dailyTitle')} description={t('dailyDesc')}>
                  {hasActivity
                    ? <DailyFlowChart data={dailyRows} locale={locale} currency={currency} />
                    : <ChartEmpty title={t('empty')} className="mt-4" />}
                </ChartCard>

                <ChartCard title={t('playstationTitle')} description={t('playstationDesc')}>
                  <PlaystationFigures
                    total={analysis.totals.playstationIncome}
                    previous={previousAnalysis.totals.playstationIncome}
                    gameClubIncome={analysis.totals.gameClubIncome}
                    days={playstationDays}
                    // PlayStation money is entered with each day's cash: its records are the period's income in Reports.
                    totalHref={canAccessPath(role, featureAccess, '/reports') ? reportsHref(range, { category: 'income' }) : undefined}
                    locale={locale}
                    currency={currency}
                  />
                  {analysis.totals.playstationIncome > 0
                    ? <PlaystationDailyChart data={playstationDays} locale={locale} currency={currency} />
                    : <ChartEmpty title={t('playstationEmpty')} className="mt-4" />}
                </ChartCard>

                <ChartCard title={t('monthlyTitle')} description={t('monthlyDesc')}>
                  {monthlyError ? (
                    <LoadErrorAlert className="mt-4" retrying={monthlyQuery.loading} onRetry={() => void monthlyQuery.reload()}>
                      {t('monthlyLoadError')}
                    </LoadErrorAlert>
                  ) : monthly ? (
                    <MonthlyTrendChart data={monthly} locale={locale} currency={currency} />
                  ) : (
                    <div className="mt-4"><ChartSkeleton /></div>
                  )}
                </ChartCard>
              </Section>

              <Section title={t('detailsSection')}>
                <div className="grid gap-4 lg:grid-cols-2">
                  <ChartCard title={t('largestTitle')} description={t('largestDesc')}>
                    <LargestPayments
                      rows={analysis.largest}
                      colors={colors}
                      labelFor={categoryName}
                      locale={locale}
                      currency={currency}
                      onSelect={openCategory}
                    />
                  </ChartCard>
                  <ChartCard title={t('methodsTitle')} description={t('methodsDesc')}>
                    <PaymentMethodFlow rows={visibleMethods} methodLabel={methodName} locale={locale} currency={currency} />
                  </ChartCard>
                </div>
              </Section>
            </div>
          )}
        </>
      )}

      <CategoryDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        detail={categoryDetail}
        color={(drawerCategory && colors[drawerCategory]) || colors.other}
        labelFor={categoryName}
        periodLabel={periodLabel}
        locale={locale}
        currency={currency}
      />
    </>
  );
}

/** The period's PlayStation money, its change, its daily average over the days with money, and its share of Game Club income. */
function PlaystationFigures({ total, previous, gameClubIncome, days, totalHref, locale, currency }: {
  total: number;
  previous: number;
  gameClubIncome: number;
  days: PlaystationDayRow[];
  /** The records behind the total. */
  totalHref?: string;
  locale: string;
  currency: string;
}) {
  const t = useTranslations('financialAnalysis');
  const change = percentChange(total, previous);
  const daysWithMoney = days.filter((day) => day.amount > 0).length;
  const share = gameClubIncome > 0 ? (total / gameClubIncome) * 100 : null;
  const items = [
    {
      label: t('playstationTotal'),
      href: totalHref,
      value: `${formatCurrency(total)} ${currency}`,
      helper: change === null ? t('playstationNoComparison') : t('playstationVsPrevious', { change: `${change > 0 ? '+' : ''}${formatShare(change, locale)}` }),
      tone: change === null ? 'text-gray-500' : change < 0 ? 'text-danger-600' : 'text-success-600',
    },
    {
      label: t('playstationAverage'),
      value: daysWithMoney ? `${formatCurrency(Math.round(total / daysWithMoney))} ${currency}` : '—',
      helper: t('playstationDaysWithMoney', { count: daysWithMoney }),
      tone: 'text-gray-500',
    },
    {
      label: t('playstationShare'),
      value: formatShare(share, locale),
      helper: t('playstationShareHelper'),
      tone: 'text-gray-500',
    },
  ];
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      {items.map((item) => (
        <TappableSurface key={item.label} href={item.href} chevron={false} className={cn('min-w-0', item.href && '-m-2 rounded-lg p-2 hover:bg-gray-50')}>
          <p className="text-xs text-gray-500">{item.label}</p>
          <p className="mt-0.5 whitespace-nowrap text-base font-semibold tabular-nums text-gray-950">{item.value}</p>
          <p className={cn('text-xs', item.tone)}>{item.helper}</p>
        </TappableSurface>
      ))}
    </div>
  );
}
