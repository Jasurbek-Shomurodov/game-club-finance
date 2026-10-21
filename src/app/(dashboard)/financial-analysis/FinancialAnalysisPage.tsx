'use client';

// Route: /financial-analysis

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownRight,
  CalendarDays,
  MonitorSmartphone,
  Percent,
  ShoppingBag,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { usePathname, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { fetchAnalysisLedgers } from '@/lib/supabase/analysisLedgers';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useClubQuery } from '@/lib/useClubQuery';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useClub } from '@/components/layout/DashboardShell';
import { cn, monthRange } from '@/lib/utils';
import { formatCurrency, formatDateShort } from '@/lib/formatters';
import {
  AmountCard,
  ChartSkeleton,
  DateRangePicker,
  LoadErrorAlert,
  MetricCard,
  MetricGridSkeleton,
  PageHeader,
  toneForAmount,
  type MetricTone,
} from '@/components/PresentationFoundation';
import { ChartCard, ChartEmpty } from '@/components/dashboard/ChartCard';
import {
  getDashboardComparisonRange,
  percentChange,
} from '@/lib/calculations/dashboardMetrics';
import { dashboardPeriodForRange, initialDashboardRange } from '@/lib/calculations/dashboardRangeState';
import {
  BAR_COST_TARGET,
  buildCategoryComparison,
  buildCategoryDetail,
  buildFinancialAnalysis,
  buildMonthlyAnalysis,
  type AnalysisLedgers,
  type MonthlyAnalysisRow,
  type PaymentMethodFlowRow,
  type SourceIndicators,
} from '@/lib/calculations/financialAnalysis';
import { MoneyFlowSankeys } from '@/components/financial-analysis/MoneyFlowSankeys';
import {
  CategoryComparison,
  CategoryDonut,
  LargestPayments,
  PaymentMethodFlow,
} from '@/components/financial-analysis/AnalysisPanels';
import { CategoryDrawer } from '@/components/financial-analysis/CategoryDrawer';
import { categoryColors, formatShare, SIDE_ICON_CLASS } from '@/components/financial-analysis/analysisFormat';

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
  };
}

function firstMonthOfWindow(businessToday: string, months = 12): string {
  const [year, month] = businessToday.split('-').map(Number);
  const absolute = year * 12 + month - months;
  return `${Math.floor(absolute / 12)}-${String((absolute % 12) + 1).padStart(2, '0')}-01`;
}

function Section({ title, description, icon: Icon, iconClassName, children }: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-950">
          {Icon && <Icon size={18} className={cn('shrink-0', iconClassName)} aria-hidden="true" />}
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Small ratio tile: icon, label, value, optional 0–100 meter and a caption. */
function Indicator({ icon, iconClassName, label, value, helper, meter, tone = 'default', loading }: {
  icon: LucideIcon;
  iconClassName?: string;
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
      iconClassName={iconClassName}
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

/** Money in, spent and accounting profit for one side of the club; the two sides are never added together. */
function SourceCards({ title, icon, iconClassName, incomeLabel, now, before, loading, currency, compare }: {
  title: string;
  icon: LucideIcon;
  /** The side's colour, so club and bar cards are told apart at a glance. */
  iconClassName: string;
  incomeLabel: string;
  now: SourceIndicators;
  before: SourceIndicators;
  loading: boolean;
  currency: string;
  compare: (now: number, before: number) => { value: number | null; label: string };
}) {
  const t = useTranslations('financialAnalysis');
  return (
    <Section title={title} icon={icon} iconClassName={iconClassName}>
      <div className="grid gap-4 sm:grid-cols-3">
        <AmountCard
          loading={loading}
          currency={currency}
          label={incomeLabel}
          amount={now.income}
          icon={icon}
          iconClassName={iconClassName}
          tone="success"
          comparison={compare(now.income, before.income)}
        />
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('spent')}
          amount={now.spent}
          icon={ArrowDownRight}
          iconClassName={iconClassName}
          tone="danger"
          comparison={compare(now.spent, before.spent)}
          comparisonGoodWhen="down"
        />
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('profit')}
          amount={now.left}
          icon={Wallet}
          iconClassName={iconClassName}
          tone={toneForAmount(now.left)}
          comparison={compare(now.left, before.left)}
        />
      </div>
    </Section>
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
  // The 12-month trend window; a selected period inside it reuses its read. It
  // ends with the current month (not today) so the default month-to-month view,
  // whose range runs to the month's last day, shares this one RPC.
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
    const key = `${clubId}:${monthlyWindow.from}:${monthlyWindow.to}`;
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
  const loadLedgers = useCallback(async () => {
    if (!selectedClubId) return null;
    const fetchRange = {
      from: previousRange.from < range.from ? previousRange.from : range.from,
      to: previousRange.to > range.to ? previousRange.to : range.to,
    };
    const rows = await (containsRange(monthlyWindow, fetchRange)
      ? loadMonthlyWindow(selectedClubId)
      : fetchAnalysisLedgers(createClient(), selectedClubId, fetchRange));
    return { clubId: selectedClubId, ledgers: rows };
  }, [loadMonthlyWindow, monthlyWindow, previousRange.from, previousRange.to, range.from, range.to, selectedClubId]);
  // Ledgers remember their club, so another club's rows never render as current.
  const ledgerQuery = useClubQuery<{ clubId: string; ledgers: AnalysisLedgers } | null>(loadLedgers, null);
  const loadedLedgers = ledgerQuery.data;
  const ledgers = loadedLedgers && loadedLedgers.clubId === selectedClubId ? loadedLedgers.ledgers : emptyLedgers;
  const loading = ledgerQuery.loading;
  const error = ledgerQuery.error;

  const loadMonthly = useCallback(async () => (
    buildMonthlyAnalysis(businessToday, selectedClubId ? await loadMonthlyWindow(selectedClubId) : emptyLedgers)
  ), [businessToday, loadMonthlyWindow, selectedClubId]);
  const monthlyQuery = useClubQuery<MonthlyAnalysisRow[] | null>(loadMonthly, null);
  // The trend chart shows its skeleton while any read of it is in flight.
  const monthly = monthlyQuery.loading ? null : monthlyQuery.data;
  const monthlyError = monthlyQuery.error;

  // A failed window read is evicted above, so a retry reads it afresh while a
  // successful one is shared; the page-level retry covers both queries.
  const retryAll = () => {
    void Promise.all([ledgerQuery.reload(), monthlyQuery.reload()]);
  };

  const current = useMemo(() => sliceLedgers(ledgers, range), [ledgers, range]);
  const previous = useMemo(() => sliceLedgers(ledgers, previousRange), [ledgers, previousRange]);
  // Average daily income follows the dashboard: each side through its latest entry in the range.
  const analysis = useMemo(() => buildFinancialAnalysis(range, current), [current, range]);
  // Days after today have no data yet; drawing them only adds an empty tail (as on the dashboard).
  const dailyRows = useMemo(
    () => analysis.daily.filter((row, index) => index === 0 || row.date <= businessToday),
    [analysis.daily, businessToday],
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

  const visibleMethods = analysis.paymentMethods.filter((row) => enabledPaymentMethods.includes(row.method));
  const hasActivity = [indicators.gameClub, indicators.bar].some((side) => side.income > 0 || side.spent > 0);

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
        <LoadErrorAlert retrying={loading} onRetry={retryAll}>
          {t('loadError')}
        </LoadErrorAlert>
      )}

      <SourceCards
        title={td('gameClub')}
        icon={MonitorSmartphone}
        iconClassName={SIDE_ICON_CLASS.gameClub}
        incomeLabel={t('moneyIn')}
        now={indicators.gameClub}
        before={previousIndicators.gameClub}
        loading={loading}
        currency={currency}
        compare={compare}
      />
      <SourceCards
        title={td('bar')}
        icon={ShoppingBag}
        iconClassName={SIDE_ICON_CLASS.bar}
        incomeLabel={t('barSalesIn')}
        now={indicators.bar}
        before={previousIndicators.bar}
        loading={loading}
        currency={currency}
        compare={compare}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicator
          loading={loading}
          icon={Percent}
          iconClassName={SIDE_ICON_CLASS.gameClub}
          label={t('gameClubMargin')}
          value={formatShare(indicators.gameClub.marginPct, locale)}
          helper={t('gameClubMarginHelper')}
          meter={indicators.gameClub.marginPct}
          tone={indicators.gameClub.marginPct !== null && indicators.gameClub.marginPct < 0 ? 'danger' : 'success'}
        />
        <Indicator
          loading={loading}
          icon={Percent}
          iconClassName={SIDE_ICON_CLASS.bar}
          label={t('barMargin')}
          value={formatShare(indicators.bar.marginPct, locale)}
          helper={t('barMarginHelper')}
          meter={indicators.bar.marginPct}
          tone={indicators.bar.marginPct !== null && indicators.bar.marginPct < 0 ? 'danger' : 'success'}
        />
        <Indicator
          loading={loading}
          icon={CalendarDays}
          iconClassName={SIDE_ICON_CLASS.gameClub}
          label={t('gameClubDaily')}
          value={`${formatCurrency(indicators.gameClub.averageDailyIncome)} ${currency}`}
          helper={t('gameClubDailyHelper')}
        />
        <Indicator
          loading={loading}
          icon={CalendarDays}
          iconClassName={SIDE_ICON_CLASS.bar}
          label={t('barDaily')}
          value={`${formatCurrency(indicators.bar.averageDailyIncome)} ${currency}`}
          helper={t('barDailyHelper')}
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
    </div>
  );
}
