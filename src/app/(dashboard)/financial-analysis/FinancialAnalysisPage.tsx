'use client';

// Route: /financial-analysis

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Flame,
  Percent,
  RefreshCcw,
  ShoppingBag,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { usePathname, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fetchAnalysisLedgers } from '@/lib/supabase/analysisLedgers';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useClub } from '@/components/layout/DashboardShell';
import { cn } from '@/lib/utils';
import { formatCurrency, formatDateShort } from '@/lib/formatters';
import {
  AmountCard,
  Button,
  ChartSkeleton,
  DateRangePicker,
  InlineAlert,
  MetricCard,
  MetricGridSkeleton,
  PageHeader,
  toneForAmount,
  type MetricTone,
} from '@/components/PresentationFoundation';
import { ChartCard, ChartEmpty } from '@/components/dashboard/ChartCard';
import {
  getDashboardAverageDayCount,
  getDashboardComparisonRange,
  percentChange,
} from '@/lib/calculations/dashboardMetrics';
import { dashboardPeriodForRange, initialDashboardRange } from '@/lib/calculations/dashboardRangeState';
import {
  BAR_COST_TARGET,
  PROFIT_TARGET,
  buildCategoryComparison,
  buildCategoryDetail,
  buildFinancialAnalysis,
  buildMonthlyAnalysis,
  type AnalysisLedgers,
  type IncomeSourceKey,
  type MonthlyAnalysisRow,
  type PaymentMethodFlowRow,
} from '@/lib/calculations/financialAnalysis';
import { SankeyFlowChart } from '@/components/financial-analysis/SankeyFlowChart';
import {
  CategoryComparison,
  CategoryDonut,
  LargestPayments,
  PaymentMethodFlow,
} from '@/components/financial-analysis/AnalysisPanels';
import { CategoryDrawer } from '@/components/financial-analysis/CategoryDrawer';
import { SOURCE_COLORS, categoryColors, formatShare } from '@/components/financial-analysis/analysisFormat';

function ChartLoading() {
  return <ChartSkeleton />;
}

const DailyFlowChart = dynamic(
  () => import('@/components/financial-analysis/AnalysisTimeCharts').then((module) => module.DailyFlowChart),
  { ssr: false, loading: ChartLoading },
);
const MonthlyTrendChart = dynamic(
  () => import('@/components/financial-analysis/AnalysisTimeCharts').then((module) => module.MonthlyTrendChart),
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
  };
}

function firstMonthOfWindow(businessToday: string, months = 12): string {
  const [year, month] = businessToday.split('-').map(Number);
  const absolute = year * 12 + month - months;
  return `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, '0')}-01`;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-gray-950">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Small ratio tile: icon, label, value, optional 0–100 meter and a caption. */
function Indicator({ icon, label, value, helper, meter, tone = 'default', loading }: {
  icon: LucideIcon;
  label: string;
  value: string;
  helper: string;
  meter?: number | null;
  tone?: MetricTone;
  loading: boolean;
}) {
  const meterColor = tone === 'danger' ? 'bg-danger-500' : tone === 'success' ? 'bg-success-500' : tone === 'warning' ? 'bg-warning-500' : 'bg-primary-600';
  return (
    <MetricCard
      loading={loading}
      icon={icon}
      label={label}
      value={value}
      tone={tone}
      helper={(
        <>
          {meter !== undefined && meter !== null && (
            <span className="mb-2 block h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
              <span className={cn('block h-full rounded-full', meterColor)} style={{ width: `${Math.min(100, Math.max(0, meter))}%` }} />
            </span>
          )}
          {helper}
        </>
      )}
    />
  );
}

export default function FinancialAnalysisPage() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { selectedClubId, businessDayStartHour, enabledPaymentMethods } = useClub();
  const { locale } = useAppLocale();
  const t = useTranslations('financialAnalysis');
  const td = useTranslations('dashboard');
  const tc = useTranslations('common');
  const tCategories = useTranslations('expenses.categories');
  const currency = tc('currency');
  const businessToday = useBusinessToday(businessDayStartHour);
  const [range, setRange] = useState<Range>(() => initialDashboardRange(searchParams, businessToday));
  const period = useMemo(() => dashboardPeriodForRange(range, businessToday), [businessToday, range]);
  const previousRange = useMemo(
    () => getDashboardComparisonRange(period, range, businessToday),
    [businessToday, period, range],
  );
  // The 12-month trend window; a selected period inside it reuses its read.
  const monthlyWindow = useMemo(
    () => ({ from: firstMonthOfWindow(businessToday), to: businessToday }),
    [businessToday],
  );

  // Ledgers remember their club, so another club's rows never render as current.
  const [loadedLedgers, setLoadedLedgers] = useState<{ clubId: string; ledgers: AnalysisLedgers } | null>(null);
  const ledgers = loadedLedgers && loadedLedgers.clubId === selectedClubId ? loadedLedgers.ledgers : emptyLedgers;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [monthly, setMonthly] = useState<MonthlyAnalysisRow[] | null>(null);
  const [monthlyError, setMonthlyError] = useState(false);
  const [monthlyReloadToken, setMonthlyReloadToken] = useState(0);
  const requestSequence = useRef(0);
  const windowRequest = useRef<{ key: string; promise: Promise<AnalysisLedgers> } | null>(null);
  // Bumped by either retry button so a retried read never reuses a failed window.
  const windowGeneration = useRef(0);
  // The category stays set while the drawer slides out, so its content does not vanish mid-animation.
  const [drawerCategory, setDrawerCategory] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Keep the range shareable, like the dashboard.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('period');
    params.set('from', range.from);
    params.set('to', range.to);
    const nextQuery = params.toString();
    if (nextQuery !== searchParams.toString()) {
      window.history.replaceState(null, '', `${pathname}?${nextQuery}`);
    }
  }, [pathname, range.from, range.to, searchParams]);

  /** One shared read of the 12-month window per club, day and retry. */
  const loadMonthlyWindow = useCallback((clubId: string) => {
    const key = `${clubId}:${monthlyWindow.from}:${monthlyWindow.to}:${windowGeneration.current}`;
    if (windowRequest.current?.key === key) return windowRequest.current.promise;
    const promise = fetchAnalysisLedgers(createClient(), clubId, monthlyWindow);
    windowRequest.current = { key, promise };
    promise.catch(() => {
      if (windowRequest.current?.promise === promise) windowRequest.current = null;
    });
    return promise;
  }, [monthlyWindow]);

  // One read covers the selected and comparison periods; they are split in
  // memory. When both fall inside the 12-month window, that read is reused.
  useEffect(() => {
    const requestId = ++requestSequence.current;
    if (!selectedClubId) {
      setLoadedLedgers(null);
      setError(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(false);
    const fetchRange = {
      from: previousRange.from < range.from ? previousRange.from : range.from,
      to: previousRange.to > range.to ? previousRange.to : range.to,
    };
    const request = containsRange(monthlyWindow, fetchRange)
      ? loadMonthlyWindow(selectedClubId)
      : fetchAnalysisLedgers(createClient(), selectedClubId, fetchRange);
    request
      .then((rows) => {
        if (requestId !== requestSequence.current) return;
        setLoadedLedgers({ clubId: selectedClubId, ledgers: rows });
        setLoading(false);
      })
      .catch(() => {
        if (requestId !== requestSequence.current) return;
        setLoadedLedgers(null);
        setError(true);
        setLoading(false);
      });
  }, [loadMonthlyWindow, monthlyWindow, previousRange.from, previousRange.to, range.from, range.to, reloadToken, selectedClubId]);

  useEffect(() => {
    setMonthly(null);
    setMonthlyError(false);
    if (!selectedClubId) {
      setMonthly(buildMonthlyAnalysis(businessToday, emptyLedgers));
      return;
    }
    let cancelled = false;
    loadMonthlyWindow(selectedClubId)
      .then((rows) => {
        if (!cancelled) setMonthly(buildMonthlyAnalysis(businessToday, rows));
      })
      .catch(() => {
        if (cancelled) return;
        setMonthlyError(true);
        setMonthly(null);
      });
    return () => { cancelled = true; };
  }, [businessToday, loadMonthlyWindow, monthlyReloadToken, selectedClubId]);

  const current = useMemo(() => sliceLedgers(ledgers, range), [ledgers, range]);
  const previous = useMemo(() => sliceLedgers(ledgers, previousRange), [ledgers, previousRange]);
  const averageDayCount = getDashboardAverageDayCount(period, range, businessToday);
  const analysis = useMemo(
    () => buildFinancialAnalysis(range, current, { averageDayCount }),
    [averageDayCount, current, range],
  );
  const previousAnalysis = useMemo(() => buildFinancialAnalysis(previousRange, previous), [previous, previousRange]);
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
    if (category === PROFIT_TARGET) return t('profit');
    return tCategories.has(category)
      ? tCategories(category as Parameters<typeof tCategories>[0])
      : category.replace(/_/g, ' ');
  }, [t, tCategories]);
  const sourceName = (key: string) => t(`sources.${key as IncomeSourceKey}`);
  const methodName = (method: PaymentMethodFlowRow['method']) => td(method);

  const { indicators } = analysis;
  const previousIndicators = previousAnalysis.indicators;
  const comparisonLabel = t('vsPrevious');
  const compare = (now: number, before: number) => {
    const value = percentChange(now, before);
    return { value, label: value === null ? td('noComparisonData') : comparisonLabel };
  };

  const visibleMethods = analysis.paymentMethods.filter((row) => enabledPaymentMethods.includes(row.method));
  const hasActivity = indicators.income > 0 || indicators.spent > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        className="mb-0"
        action={(
          <DateRangePicker
            from={range.from}
            to={range.to}
            fromLabel={td('from')}
            toLabel={td('to')}
            max={businessToday}
            className="sm:w-80"
            onChange={setRange}
          />
        )}
      />

      {error && (
        <InlineAlert
          variant="danger"
          action={(
            <Button size="sm" variant="outline" onClick={() => {
              windowGeneration.current += 1;
              setReloadToken((token) => token + 1);
            }} icon={<RefreshCcw size={15} aria-hidden="true" />}>
              {tc('retry')}
            </Button>
          )}
        >
          {t('loadError')}
        </InlineAlert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('moneyIn')}
          amount={indicators.income}
          icon={ArrowUpRight}
          tone="success"
          comparison={compare(indicators.income, previousIndicators.income)}
        />
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('spent')}
          amount={indicators.spent}
          icon={ArrowDownRight}
          tone="danger"
          comparison={compare(indicators.spent, previousIndicators.spent)}
          comparisonGoodWhen="down"
          helper={t('spentHelper')}
        />
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('left')}
          amount={indicators.left}
          icon={Wallet}
          tone={toneForAmount(indicators.left)}
          comparison={compare(indicators.left, previousIndicators.left)}
          helper={t('leftHelper')}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Indicator
          loading={loading}
          icon={Percent}
          label={t('profitMargin')}
          value={formatShare(indicators.profitMarginPct, locale)}
          helper={t('profitMarginHelper')}
          meter={indicators.profitMarginPct}
          tone={indicators.profitMarginPct !== null && indicators.profitMarginPct < 0 ? 'danger' : 'success'}
        />
        <Indicator
          loading={loading}
          icon={Flame}
          label={t('spendRatio')}
          value={formatShare(indicators.spendRatioPct, locale)}
          helper={t('spendRatioHelper')}
          meter={indicators.spendRatioPct}
          tone={indicators.spendRatioPct !== null && indicators.spendRatioPct > 100 ? 'danger' : 'warning'}
        />
        <Indicator
          loading={loading}
          icon={ShoppingBag}
          label={t('barMargin')}
          value={formatShare(indicators.barMarginPct, locale)}
          helper={t('barMarginHelper')}
          meter={indicators.barMarginPct}
        />
        <Indicator
          loading={loading}
          icon={Users}
          label={t('salaryShare')}
          value={formatShare(indicators.salarySharePct, locale)}
          helper={t('salaryShareHelper')}
          meter={indicators.salarySharePct}
        />
        <Indicator
          loading={loading}
          icon={CalendarDays}
          label={t('averageDailySpend')}
          value={`${formatCurrency(indicators.averageDailySpend)} ${currency}`}
          helper={t('averageDailyIncomeHelper', { amount: `${formatCurrency(indicators.averageDailyIncome)} ${currency}` })}
        />
      </div>

      {loading && !hasActivity ? (
        <div className="space-y-4" role="status" aria-label={tc('loading')}>
          <ChartSkeleton />
          <MetricGridSkeleton />
        </div>
      ) : (
        <div className={cn('space-y-6 transition-opacity', loading && 'pointer-events-none opacity-60')} aria-busy={loading || undefined}>
          <Section title={t('flowSection')} description={t('flowSectionDesc')}>
            <ChartCard title={t('flowTitle')} description={t('flowDesc')}>
              <div className="mt-4">
                {analysis.sankey.total > 0 ? (
                  <SankeyFlowChart
                    sankey={analysis.sankey}
                    hubLabel={t('hub')}
                    sourceLabel={sourceName}
                    targetLabel={categoryName}
                    sourceColor={(key) => SOURCE_COLORS[key as IncomeSourceKey]}
                    targetColor={(key) => colors[key]}
                    locale={locale}
                    currency={currency}
                    onTargetClick={openCategory}
                    isTargetClickable={(key) => key !== BAR_COST_TARGET && key !== PROFIT_TARGET}
                  />
                ) : (
                  <ChartEmpty title={t('empty')} />
                )}
              </div>
            </ChartCard>

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
                ? <DailyFlowChart data={analysis.daily} locale={locale} currency={currency} />
                : <ChartEmpty title={t('empty')} className="mt-4" />}
            </ChartCard>

            <ChartCard title={t('monthlyTitle')} description={t('monthlyDesc')}>
              {monthlyError ? (
                <InlineAlert
                  variant="danger"
                  className="mt-4"
                  action={(
                    <Button size="sm" variant="outline" onClick={() => {
                      windowGeneration.current += 1;
                      setMonthlyReloadToken((token) => token + 1);
                    }} icon={<RefreshCcw size={15} aria-hidden="true" />}>
                      {tc('retry')}
                    </Button>
                  )}
                >
                  {t('monthlyLoadError')}
                </InlineAlert>
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

      <CategoryDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        detail={categoryDetail}
        color={(drawerCategory && colors[drawerCategory]) || colors.other}
        labelFor={categoryName}
        periodLabel={`${formatDateShort(range.from, locale)} – ${formatDateShort(range.to, locale)}`}
        locale={locale}
        currency={currency}
      />
    </div>
  );
}
