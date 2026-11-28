'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ArrowRight,
  CircleDollarSign,
} from 'lucide-react';
import { SIDE_ICONS } from '@/components/sideIcons';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import { fetchAnalysisLedgers } from '@/lib/supabase/analysisLedgers';
import { EMPTY_OWNER_MONEY, fetchOwnerMoney, type OwnerMoneyData } from '@/lib/supabase/ownerMoney';
import { useClubQuery } from '@/lib/useClubQuery';
import { canAccessFeature } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { capitalizeFirst, formatCurrency, formatDate, formatYearMonth } from '@/lib/formatters';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { useClub } from '@/components/layout/DashboardShell';
import {
  ButtonLink,
  ChartSkeleton,
  DataTable,
  LoadErrorAlert,
  SegmentedControl,
  metricToneClassName,
  toneForAmount,
  type DataTableColumn,
} from '@/components/PresentationFoundation';
import { ChartCard, ChartEmpty } from '@/components/dashboard/ChartCard';
import { percentChange } from '@/lib/calculations/dashboardMetrics';
import { sumOwnerBalances } from '@/lib/calculations/ownerProfitSnapshot';
import {
  buildCalendarHeatmap,
  buildCategorySeries,
  buildMonthForecast,
  buildYearOverYear,
  buildOwnerMonthSeries,
  buildPeriodSeries,
  buildProfitMonths,
  buildWeekdayPattern,
  buildWeeklyAverages,
  granularityRange,
  type Granularity,
} from '@/lib/calculations/analysisSeries';
import {
  BAR_COST_TARGET,
  buildCategoryDetail,
  buildFinancialAnalysis,
  buildMonthlyAnalysis,
  buildOverallSummary,
  firstLedgerDate,
  monthsSpanned,
  type AnalysisLedgers,
  type MonthlyAnalysisRow,
  type OverallSideSummary,
} from '@/lib/calculations/financialAnalysis';
import { MoneyFlowSankeys } from './MoneyFlowSankeys';
import { CategoryDonut, LargestPayments } from './AnalysisPanels';
import { CategoryDrawer } from './CategoryDrawer';
import { Section } from './AnalysisSections';
import { OverallBodySkeleton } from './OverallSkeleton';
import { OwnerBalanceCard, SectionNav, SideSummaryCard } from './OverallSummary';
import { categoryColors, formatShare } from './analysisFormat';

function ChartLoading() {
  return <ChartSkeleton />;
}

// One recharts chunk for every overall chart, requested once.
const loadCharts = () => import('./OverallCharts');
const SideFlowChart = dynamic(() => loadCharts().then((module) => module.SideFlowChart), { ssr: false, loading: ChartLoading });
const CumulativeProfitChart = dynamic(() => loadCharts().then((module) => module.CumulativeProfitChart), { ssr: false, loading: ChartLoading });
const IncomeMixChart = dynamic(() => loadCharts().then((module) => module.IncomeMixChart), { ssr: false, loading: ChartLoading });
const CategoryTrendChart = dynamic(() => loadCharts().then((module) => module.CategoryTrendChart), { ssr: false, loading: ChartLoading });
const WeeklyAverageChart = dynamic(() => loadCharts().then((module) => module.WeeklyAverageChart), { ssr: false, loading: ChartLoading });
const WeekdayChart = dynamic(() => loadCharts().then((module) => module.WeekdayChart), { ssr: false, loading: ChartLoading });
const ProfitMonthsChart = dynamic(() => loadCharts().then((module) => module.ProfitMonthsChart), { ssr: false, loading: ChartLoading });
const ForecastChart = dynamic(() => loadCharts().then((module) => module.ForecastChart), { ssr: false, loading: ChartLoading });
const YearOverYearChart = dynamic(() => loadCharts().then((module) => module.YearOverYearChart), { ssr: false, loading: ChartLoading });
const CalendarHeatmap = dynamic(() => loadCharts().then((module) => module.CalendarHeatmap), { ssr: false, loading: ChartLoading });
const OwnerMonthsChart = dynamic(() => loadCharts().then((module) => module.OwnerMonthsChart), { ssr: false, loading: ChartLoading });

/** Before the first ledger row; the analysis then starts at the club's first entry. */
const HISTORY_START = '2000-01-01';

type Side = 'gameClub' | 'bar';
type ForecastSide = Side | 'playstation';

interface MonthTableRow extends MonthlyAnalysisRow {
  gameClubWithdrawn: number | null;
  barWithdrawn: number | null;
}

/** Compact figures above a side's profit-by-month chart. */
function ProfitStats({ items }: { items: Array<{ label: string; value: string; helper?: string; tone?: ReturnType<typeof toneForAmount> }> }) {
  return (
    // Four across only where a whole amount fits in a quarter of the card; a figure is never cut short.
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:max-xl:grid-cols-4 2xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-gray-500">{item.label}</dt>
          <dd className={cn('whitespace-nowrap text-sm font-semibold tabular-nums', item.tone ? metricToneClassName[item.tone] : 'text-gray-950')}>
            {item.value}
          </dd>
          {item.helper && <dd className="text-xs text-gray-500">{item.helper}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** `onOpenMonth` switches to the monthly view for a month tapped in the table. */
export function OverallAnalysis({ businessToday, onOpenMonth }: { businessToday: string; onOpenMonth?: (month: string) => void }) {
  const { selectedClubId, role, featureAccess } = useClub();
  const { locale } = useAppLocale();
  const t = useTranslations('financialAnalysis');
  const td = useTranslations('dashboard');
  const tc = useTranslations('common');
  const tCategories = useTranslations('expenses.categories');
  const currency = tc('currency');
  const showOwnerProfit = canAccessFeature(role, featureAccess, 'owner_profit');
  const [drawerCategory, setDrawerCategory] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>('week');

  // Every ledger row through today, in one read; the history starts at the first entry.
  const loadLedgers = useCallback(async () => {
    if (!selectedClubId) return null;
    const ledgers = await fetchAnalysisLedgers(createClient(), selectedClubId, { from: HISTORY_START, to: businessToday });
    return { clubId: selectedClubId, ledgers };
  }, [businessToday, selectedClubId]);
  const ledgerQuery = useClubQuery<{ clubId: string; ledgers: AnalysisLedgers } | null>(loadLedgers, null);
  const ledgers = ledgerQuery.data && ledgerQuery.data.clubId === selectedClubId ? ledgerQuery.data.ledgers : null;
  const loading = ledgerQuery.loading || !ledgers;

  const loadOwnerMoney = useCallback(async (isCurrent: () => boolean): Promise<OwnerMoneyData & { clubId: string } | null> => {
    if (!selectedClubId || !showOwnerProfit) return null;
    const data = await fetchOwnerMoney(createClient(), selectedClubId, businessToday, isCurrent);
    return { ...data, clubId: selectedClubId };
  }, [businessToday, selectedClubId, showOwnerProfit]);
  const ownerQuery = useClubQuery(loadOwnerMoney, null);
  const ownerMoney = ownerQuery.data && ownerQuery.data.clubId === selectedClubId ? ownerQuery.data : null;
  const ownerLoading = ownerQuery.loading || !ownerMoney;

  const history = useMemo(() => {
    const source = ledgers ?? { cashRows: [], stockRows: [], purchaseRows: [], expenseRows: [], debtRows: [], debtPaymentRows: [] };
    const from = firstLedgerDate(source) ?? businessToday;
    const range = { from, to: businessToday };
    const months = buildMonthlyAnalysis(businessToday, source, monthsSpanned(from, businessToday));
    return {
      range,
      ledgers: source,
      analysis: buildFinancialAnalysis(range, source),
      months,
      // The month still running is listed but not counted in the average, best, worst or loss months.
      summary: buildOverallSummary(months, businessToday.slice(0, 7)),
    };
  }, [businessToday, ledgers]);
  const { analysis, months, summary, range } = history;
  const colors = useMemo(() => categoryColors(analysis.topCategories), [analysis.topCategories]);

  const series = useMemo(() => {
    const window = granularityRange(range, granularity);
    return {
      periods: buildPeriodSeries(window, history.ledgers, granularity),
      categories: buildCategorySeries(window, history.ledgers.expenseRows, granularity, analysis.topCategories),
    };
  }, [analysis.topCategories, granularity, history.ledgers, range]);
  const weekdays = useMemo(() => buildWeekdayPattern(range, history.ledgers), [history.ledgers, range]);
  const weeklyAverages = useMemo(() => buildWeeklyAverages(range, history.ledgers), [history.ledgers, range]);
  const forecast = useMemo(() => buildMonthForecast(businessToday, history.ledgers), [businessToday, history.ledgers]);
  const heatmaps = useMemo(() => ({
    gameClub: buildCalendarHeatmap(range, history.ledgers, 'gameClub').weeks,
    bar: buildCalendarHeatmap(range, history.ledgers, 'bar').weeks,
  }), [history.ledgers, range]);
  const yearOverYear = useMemo(() => ({
    gameClub: buildYearOverYear(months, 'gameClub'),
    bar: buildYearOverYear(months, 'bar'),
  }), [months]);
  const profitMonths = useMemo(() => ({
    gameClub: buildProfitMonths(months, 'gameClub'),
    bar: buildProfitMonths(months, 'bar'),
  }), [months]);

  const { balancesByMonth, carryovers } = ownerMoney ?? EMPTY_OWNER_MONEY;
  const ownerTotals = useMemo(
    () => sumOwnerBalances(balancesByMonth, carryovers, businessToday.slice(0, 7)),
    [balancesByMonth, businessToday, carryovers],
  );
  const ownerMonths = useMemo(() => buildOwnerMonthSeries(balancesByMonth), [balancesByMonth]);

  const tableRows = useMemo<MonthTableRow[]>(() => months
    .map((row) => {
      const balance = balancesByMonth[row.month.slice(0, 7)];
      return {
        ...row,
        gameClubWithdrawn: ownerMoney ? balance?.gameClub.withdrawn ?? 0 : null,
        barWithdrawn: ownerMoney ? balance?.bar.withdrawn ?? 0 : null,
      };
    })
    .reverse(), [balancesByMonth, months, ownerMoney]);

  const categoryDetail = useMemo(
    () => (drawerCategory ? buildCategoryDetail(drawerCategory, history.ledgers.expenseRows, [], analysis.topCategories) : null),
    [analysis.topCategories, drawerCategory, history.ledgers.expenseRows],
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

  const monthName = (month: string) => capitalizeFirst(formatYearMonth(month.slice(0, 7), locale), locale);
  const money = (amount: number) => `${formatCurrency(amount)} ${currency}`;
  const periodLabel = `${formatDate(range.from, locale)} – ${formatDate(range.to, locale)}`;
  const sinceLabel = t('overallSince', { date: formatDate(range.from, locale) });
  const { indicators } = analysis;
  const hasActivity = [indicators.gameClub, indicators.bar].some((side) => side.income > 0 || side.spent > 0);

  const signedCell = (amount: number) => (
    <span className={cn('tabular-nums', metricToneClassName[toneForAmount(amount)])}>{formatCurrency(amount)}</span>
  );
  const columns: DataTableColumn<MonthTableRow>[] = [
    {
      key: 'month',
      header: t('tableMonth'),
      render: (row) => (
        <span className="font-medium text-gray-900">
          {row.month.slice(0, 7) === businessToday.slice(0, 7) ? t('monthSoFar', { month: monthName(row.month) }) : monthName(row.month)}
        </span>
      ),
    },
    { key: 'gameClubIncome', header: t('gameClubIncome'), align: 'right', render: (row) => <span className="tabular-nums">{formatCurrency(row.gameClubIncome)}</span> },
    { key: 'gameClubLeft', header: t('drill.gameClubLeft'), align: 'right', render: (row) => signedCell(row.gameClubLeft) },
    { key: 'barSales', header: t('barSales'), align: 'right', render: (row) => <span className="tabular-nums">{formatCurrency(row.barSales)}</span> },
    { key: 'barLeft', header: t('drill.barLeft'), align: 'right', render: (row) => signedCell(row.barLeft) },
    ...(showOwnerProfit ? [
      { key: 'gameClubWithdrawn', header: t('tableGameClubWithdrawn'), align: 'right' as const, render: (row: MonthTableRow) => <span className="tabular-nums">{row.gameClubWithdrawn === null ? '—' : formatCurrency(row.gameClubWithdrawn)}</span> },
      { key: 'barWithdrawn', header: t('tableBarWithdrawn'), align: 'right' as const, render: (row: MonthTableRow) => <span className="tabular-nums">{row.barWithdrawn === null ? '—' : formatCurrency(row.barWithdrawn)}</span> },
    ] : []),
  ];

  const profitStats = (side: Side, data: OverallSideSummary) => [
    {
      label: t('margin'),
      value: formatShare(indicators[side].marginPct, locale),
      tone: indicators[side].marginPct !== null && indicators[side].marginPct < 0 ? 'danger' as const : 'success' as const,
    },
    { label: t('average'), value: money(data.averageMonthlyProfit), helper: t('lossMonths', { count: data.lossMonths }), tone: toneForAmount(data.averageMonthlyProfit) },
    { label: t('best'), value: data.best ? money(data.best.profit) : '—', helper: data.best ? monthName(data.best.month) : undefined, tone: data.best ? toneForAmount(data.best.profit) : undefined },
    { label: t('worst'), value: data.worst ? money(data.worst.profit) : '—', helper: data.worst ? monthName(data.worst.month) : undefined, tone: data.worst ? toneForAmount(data.worst.profit) : undefined },
  ];
  const forecastStats = (side: ForecastSide) => {
    const data = forecast[side];
    const change = data.projectedIncome === null ? null : percentChange(data.projectedIncome, data.lastMonthIncome);
    // PlayStation has no expenses of its own: its share of Game Club money says more than a profit.
    const share = forecast.gameClub.incomeToDate > 0 ? (data.incomeToDate / forecast.gameClub.incomeToDate) * 100 : null;
    return [
      { label: t('forecastSoFar'), value: money(data.incomeToDate), helper: t('forecastDays', { count: data.daysCounted, total: forecast.daysInMonth }) },
      {
        label: t('forecastIncome'),
        value: data.projectedIncome === null ? '—' : money(data.projectedIncome),
        helper: change === null ? undefined : t('forecastVsLastMonth', { change: `${change > 0 ? '+' : ''}${formatShare(change, locale)}` }),
        tone: change === null ? undefined : change < 0 ? 'danger' as const : 'success' as const,
      },
      side === 'playstation'
        ? { label: t('forecastShare'), value: share === null ? '—' : formatShare(share, locale), helper: t('forecastShareHelper') }
        : {
          label: t('forecastProfit'),
          value: data.projectedProfit === null ? '—' : money(data.projectedProfit),
          tone: data.projectedProfit === null ? undefined : toneForAmount(data.projectedProfit),
        },
      side === 'playstation'
        ? { label: t('forecastLastMonth'), value: money(data.lastMonthIncome) }
        : { label: t('forecastLastMonth'), value: money(data.lastMonthIncome), helper: t('forecastLastMonthProfit', { amount: money(data.lastMonthProfit) }) },
    ];
  };
  const weeklyAverageStats = (side: Side) => {
    const key = side === 'gameClub' ? 'gameClubAverage' : 'barAverage';
    const counted = weeklyAverages.weeks.filter((row) => row[side === 'gameClub' ? 'gameClubDays' : 'barDays'] > 0);
    const thisWeek = counted.at(-1);
    const lastWeek = counted.at(-2);
    const change = thisWeek && lastWeek ? percentChange(thisWeek[key], lastWeek[key]) : null;
    return [
      {
        label: t('weeklyAverageThisWeek'),
        value: thisWeek ? money(thisWeek[key]) : '—',
        helper: change === null ? undefined : t('weeklyAverageVsLastWeek', { change: `${change > 0 ? '+' : ''}${formatShare(change, locale)}` }),
        tone: change === null ? undefined : change < 0 ? 'danger' as const : 'success' as const,
      },
      { label: t('weeklyAverageLastWeek'), value: lastWeek ? money(lastWeek[key]) : '—' },
      { label: t('weeklyAverageOverall'), value: money(weeklyAverages[key]), helper: t('weeklyAverageWeeks', { count: counted.length }) },
      { label: t('weeklyAverageWeekly'), value: money(weeklyAverages[side === 'gameClub' ? 'gameClubWeekly' : 'barWeekly']) },
    ];
  };
  const hasYearOverYear = yearOverYear.gameClub.years.length > 1;

  const navItems = useMemo(() => [
    { id: 'overview', label: t('overviewSection') },
    { id: 'flow', label: t('flowSection') },
    ...(showOwnerProfit ? [{ id: 'owner', label: t('ownerSection') }] : []),
    { id: 'forecast', label: t('forecastSection') },
    { id: 'profit', label: t('overallSection') },
    { id: 'reports', label: t('reportsSection') },
    { id: 'years', label: t('yoySection') },
    { id: 'table', label: t('tableTitle') },
    { id: 'expenses', label: t('expensesSection') },
  ], [showOwnerProfit, t]);

  const granularityControl = (
    <SegmentedControl
      variant="soft"
      size="sm"
      label={t('granularity')}
      options={[
        { value: 'day', label: t('granularityDay') },
        { value: 'week', label: t('granularityWeek') },
        { value: 'month', label: t('granularityMonth') },
      ]}
      value={granularity}
      onChange={setGranularity}
      className="w-full sm:w-72"
    />
  );

  if (ledgerQuery.error) {
    return (
      <LoadErrorAlert retrying={ledgerQuery.loading} onRetry={() => void ledgerQuery.reload()}>
        {t('loadError')}
      </LoadErrorAlert>
    );
  }

  return (
    <>
      <SectionNav label={t('sectionNav')} items={navItems} />

      <Section id="overview" help={t('help.overview')} title={t('overviewSection')} description={sinceLabel}>
        <div className="grid gap-4 lg:grid-cols-2">
          <SideSummaryCard
            side="gameClub"
            title={td('gameClub')}
            icon={SIDE_ICONS.gameClub}
            incomeLabel={t('moneyIn')}
            data={indicators.gameClub}
            help={t('help.sideSummary')}
            months={profitMonths.gameClub}
            loading={loading}
            locale={locale}
            currency={currency}
          />
          <SideSummaryCard
            side="bar"
            title={td('bar')}
            icon={SIDE_ICONS.bar}
            incomeLabel={t('barSalesIn')}
            data={indicators.bar}
            help={t('help.sideSummary')}
            months={profitMonths.bar}
            loading={loading}
            locale={locale}
            currency={currency}
          />
        </div>
      </Section>

      {!loading && (
        <Section id="flow" help={t('help.flow')} title={t('flowSection')} description={t('flowSectionDesc')}>
          <MoneyFlowSankeys
            className="space-y-3"
            ledgers={history.ledgers}
            range={range}
            colors={colors}
            periodLabel={periodLabel}
            locale={locale}
            currency={currency}
            gameClub={{ title: t('gameClubFlowTitle'), description: t('flowDesc') }}
            bar={{ title: t('barFlowTitle'), description: t('flowDesc') }}
          />
        </Section>
      )}

      {showOwnerProfit && (
        <Section
          id="owner" help={t('help.owner')}
          title={t('ownerSection')}
          description={t('ownerSectionDesc')}
          icon={CircleDollarSign}
          iconClassName="text-success-600"
          action={(
            <ButtonLink href="/money-taken" variant="ghost" size="sm" iconRight={<ArrowRight size={15} aria-hidden="true" />}>
              {t('ownerOpen')}
            </ButtonLink>
          )}
        >
          {ownerQuery.error ? (
            <LoadErrorAlert retrying={ownerQuery.loading} onRetry={() => void ownerQuery.reload()}>
              {t('ownerLoadError')}
            </LoadErrorAlert>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <OwnerBalanceCard
                help={t('help.ownerBalance')}
                loading={ownerLoading}
                locale={locale}
                currency={currency}
                sides={[
                  { side: 'gameClub', label: td('gameClub'), icon: SIDE_ICONS.gameClub, balance: ownerTotals.gameClub },
                  { side: 'bar', label: td('bar'), icon: SIDE_ICONS.bar, balance: ownerTotals.bar },
                ]}
              />
              <OwnerMonthsChart
                rows={ownerMonths}
                locale={locale}
                currency={currency}
                card={{
                  title: t('ownerChartTitle'),
                  help: t('help.ownerMonths'),
                  description: t('ownerChartDesc'),
                  placeholder: ownerLoading
                    ? <div className="mt-4"><ChartSkeleton /></div>
                    : ownerMonths.length > 0 ? undefined : <ChartEmpty title={t('empty')} className="mt-4" />,
                }}
              />
            </div>
          )}
        </Section>
      )}

      {loading ? (
        <div role="status" aria-label={tc('loading')}>
          <OverallBodySkeleton />
        </div>
      ) : (
        <div className="space-y-6">
          <Section id="forecast" help={t('help.forecast')} title={t('forecastSection')} description={t('forecastSectionDesc', { month: monthName(forecast.month) })}>
            <div className="grid gap-4 xl:grid-cols-2">
              {(['gameClub', 'bar', 'playstation'] as const).map((side) => (
                <ForecastChart
                  key={side}
                  forecast={forecast}
                  side={side}
                  locale={locale}
                  currency={currency}
                  card={{
                    // PlayStation money is part of Game Club money; it gets the full row under the two sides.
                    className: side === 'playstation' ? 'xl:col-span-2' : undefined,
                    help: t('help.forecastChart'),
                    title: t(side === 'gameClub' ? 'forecastGameClubTitle' : side === 'bar' ? 'forecastBarTitle' : 'forecastPlaystationTitle'),
                    description: t('forecastDesc'),
                    placeholder: forecast[side].daysCounted > 0 ? undefined : <ChartEmpty title={t('forecastNoData')} className="mt-4" />,
                    children: <ProfitStats items={forecastStats(side)} />,
                  }}
                />
              ))}
            </div>
          </Section>

          <Section id="profit" help={t('help.profit')} title={t('overallSection')} description={t('overallSectionDesc', { count: summary.months })}>
            <div className="grid gap-4 xl:grid-cols-2">
              {(['gameClub', 'bar'] as const).map((side) => (
                <ProfitMonthsChart
                  key={side}
                  rows={profitMonths[side]}
                  average={summary[side].averageMonthlyProfit}
                  locale={locale}
                  currency={currency}
                  card={{
                    help: t('help.profitMonths'),
                    title: t(side === 'gameClub' ? 'profitMonthsGameClubTitle' : 'profitMonthsBarTitle'),
                    description: t('profitMonthsDesc'),
                    placeholder: hasActivity ? undefined : <ChartEmpty title={t('empty')} className="mt-4" />,
                    children: <ProfitStats items={profitStats(side, summary[side])} />,
                  }}
                />
              ))}
            </div>
          </Section>

          <Section id="reports" help={t('help.reports')} title={t('reportsSection')} description={t('reportsSectionDesc')} action={granularityControl}>
            {hasActivity ? (
              <>
                <div className="grid gap-4 xl:grid-cols-2">
                  <SideFlowChart
                    rows={series.periods}
                    side="gameClub"
                    granularity={granularity}
                    locale={locale}
                    currency={currency}
                    card={{ title: t('sideFlowGameClubTitle'), help: t('help.sideFlow'), description: t('sideFlowDesc') }}
                  />
                  <SideFlowChart
                    rows={series.periods}
                    side="bar"
                    granularity={granularity}
                    locale={locale}
                    currency={currency}
                    card={{ title: t('sideFlowBarTitle'), help: t('help.sideFlow'), description: t('sideFlowDesc') }}
                  />
                </div>
                <CumulativeProfitChart
                  rows={series.periods}
                  granularity={granularity}
                  locale={locale}
                  currency={currency}
                  card={{ title: t('cumulativeTitle'), help: t('help.cumulative'), description: t('cumulativeDesc') }}
                />
                <div className="grid gap-4 xl:grid-cols-2">
                  <IncomeMixChart
                    rows={series.periods}
                    granularity={granularity}
                    locale={locale}
                    currency={currency}
                    card={{ title: t('incomeMixTitle'), help: t('help.incomeMix'), description: t('incomeMixDesc') }}
                  />
                  <CategoryTrendChart
                    rows={series.categories}
                    periods={series.periods}
                    categories={analysis.topCategories}
                    colors={colors}
                    labelFor={categoryName}
                    granularity={granularity}
                    locale={locale}
                    currency={currency}
                    card={{
                      title: t('categoryTrendTitle'),
                      help: t('help.categoryTrend'),
                      description: t('categoryTrendDesc'),
                      placeholder: analysis.topCategories.length > 0 ? undefined : <ChartEmpty title={t('noExpenses')} className="mt-4" />,
                    }}
                  />
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  {(['gameClub', 'bar'] as const).map((side) => (
                    <WeeklyAverageChart
                      key={side}
                      rows={weeklyAverages.weeks}
                      side={side}
                      average={weeklyAverages[side === 'gameClub' ? 'gameClubAverage' : 'barAverage']}
                      locale={locale}
                      currency={currency}
                      card={{
                        help: t('help.weeklyAverage'),
                        title: t(side === 'gameClub' ? 'weeklyAverageGameClubTitle' : 'weeklyAverageBarTitle'),
                        description: t('weeklyAverageDesc'),
                        children: <ProfitStats items={weeklyAverageStats(side)} />,
                      }}
                    />
                  ))}
                </div>
                <ChartCard title={t('weekdayTitle')} help={t('help.weekday')} description={t('weekdayDesc')}>
                  <WeekdayChart rows={weekdays} locale={locale} currency={currency} />
                </ChartCard>
                <div className="grid gap-4 xl:grid-cols-2">
                  {(['gameClub', 'bar'] as const).map((side) => (
                    <ChartCard key={side} help={t('help.heatmap')} title={t(side === 'gameClub' ? 'heatmapGameClubTitle' : 'heatmapBarTitle')} description={t('heatmapDesc')}>
                      <CalendarHeatmap weeks={heatmaps[side]} side={side} locale={locale} currency={currency} />
                    </ChartCard>
                  ))}
                </div>
              </>
            ) : <ChartEmpty title={t('empty')} />}
          </Section>

          <Section id="years" help={t('help.years')} title={t('yoySection')} description={t('yoySectionDesc')}>
            {hasYearOverYear ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {(['gameClub', 'bar'] as const).map((side) => (
                  <ChartCard key={side} help={t('help.years')} title={t(side === 'gameClub' ? 'yoyGameClubTitle' : 'yoyBarTitle')}>
                    <YearOverYearChart data={yearOverYear[side]} locale={locale} currency={currency} />
                  </ChartCard>
                ))}
              </div>
            ) : (
              <ChartEmpty title={t('yoyEmpty', { year: yearOverYear.gameClub.years[0] ?? businessToday.slice(0, 4) })} className="min-h-32" />
            )}
          </Section>

          <Section id="table" help={t('help.table')} title={t('trendsSection')} description={t('trendsSectionDesc')}>
            <ChartCard title={t('tableTitle')} help={t('help.table')} description={showOwnerProfit ? t('tableDescOwner') : t('tableDesc')}>
              <DataTable
                className="mt-4"
                columns={columns}
                data={tableRows}
                keyExtractor={(row) => row.month}
                onRowClick={onOpenMonth ? (row) => onOpenMonth(row.month) : undefined}
                label={t('tableTitle')}
                dense
              />
            </ChartCard>
          </Section>

          <Section id="expenses" help={t('help.expenses')} title={t('expensesSection')} description={t('expensesSectionDesc')}>
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title={t('categoriesTitle')} help={t('help.categories')} description={t('categoriesDesc')}>
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
              <ChartCard title={t('largestTitle')} help={t('help.largest')} description={t('overallLargestDesc')}>
                <LargestPayments
                  rows={analysis.largest}
                  colors={colors}
                  labelFor={categoryName}
                  locale={locale}
                  currency={currency}
                  onSelect={openCategory}
                />
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
        showPrevious={false}
      />
    </>
  );
}
