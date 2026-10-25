'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  CircleDollarSign,
  MonitorSmartphone,
  PiggyBank,
  ShoppingBag,
  Wallet,
} from 'lucide-react';
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
  AmountCard,
  ButtonLink,
  ChartSkeleton,
  DataTable,
  LoadErrorAlert,
  MetricGridSkeleton,
  SegmentedControl,
  metricToneClassName,
  toneForAmount,
  type DataTableColumn,
} from '@/components/PresentationFoundation';
import { ChartCard, ChartEmpty } from '@/components/dashboard/ChartCard';
import { sumAvailableMoneyResults, type AvailableSourceBalance } from '@/lib/calculations/availableMoney';
import {
  buildCategorySeries,
  buildOwnerMonthSeries,
  buildPeriodSeries,
  buildProfitMonths,
  buildWeekdayPattern,
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
import { Section, SourceCards } from './AnalysisSections';
import { categoryColors, formatShare, SIDE_ICON_CLASS } from './analysisFormat';

function ChartLoading() {
  return <ChartSkeleton />;
}

// One recharts chunk for every overall chart, requested once.
const loadCharts = () => import('./OverallCharts');
const SideFlowChart = dynamic(() => loadCharts().then((module) => module.SideFlowChart), { ssr: false, loading: ChartLoading });
const CumulativeProfitChart = dynamic(() => loadCharts().then((module) => module.CumulativeProfitChart), { ssr: false, loading: ChartLoading });
const IncomeMixChart = dynamic(() => loadCharts().then((module) => module.IncomeMixChart), { ssr: false, loading: ChartLoading });
const CategoryTrendChart = dynamic(() => loadCharts().then((module) => module.CategoryTrendChart), { ssr: false, loading: ChartLoading });
const WeekdayChart = dynamic(() => loadCharts().then((module) => module.WeekdayChart), { ssr: false, loading: ChartLoading });
const ProfitMonthsChart = dynamic(() => loadCharts().then((module) => module.ProfitMonthsChart), { ssr: false, loading: ChartLoading });
const OwnerMonthsChart = dynamic(() => loadCharts().then((module) => module.OwnerMonthsChart), { ssr: false, loading: ChartLoading });

/** Before the first ledger row; the analysis then starts at the club's first entry. */
const HISTORY_START = '2000-01-01';

type Side = 'gameClub' | 'bar';

interface MonthTableRow extends MonthlyAnalysisRow {
  gameClubWithdrawn: number | null;
  barWithdrawn: number | null;
}

/** Earned, withdrawn and still-available owner profit for one side over every month. */
function OwnerSideCards({ side, balance, loading, currency }: {
  side: Side;
  balance: AvailableSourceBalance;
  loading: boolean;
  currency: string;
}) {
  const t = useTranslations('financialAnalysis');
  const td = useTranslations('dashboard');
  const Icon = side === 'gameClub' ? MonitorSmartphone : ShoppingBag;
  const iconClassName = SIDE_ICON_CLASS[side];
  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
        <Icon size={16} className={iconClassName} aria-hidden="true" />
        {td(side)}
      </h3>
      <div className="grid gap-4 sm:grid-cols-3">
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('ownerEarned')}
          helper={t(side === 'gameClub' ? 'ownerEarnedGameClubHelper' : 'ownerEarnedBarHelper')}
          amount={balance.earned}
          icon={PiggyBank}
          iconClassName={iconClassName}
          tone={toneForAmount(balance.earned)}
        />
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('ownerWithdrawn')}
          amount={balance.withdrawn}
          icon={ArrowDownToLine}
          iconClassName={iconClassName}
          tone="danger"
        />
        <AmountCard
          loading={loading}
          currency={currency}
          label={t('ownerLeft')}
          helper={t('ownerLeftHelper')}
          amount={balance.available}
          icon={Wallet}
          iconClassName={iconClassName}
          tone={toneForAmount(balance.available)}
        />
      </div>
    </div>
  );
}

/** Compact figures above a side's profit-by-month chart. */
function ProfitStats({ items }: { items: Array<{ label: string; value: string; helper?: string; tone?: ReturnType<typeof toneForAmount> }> }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="truncate text-xs text-gray-500">{item.label}</dt>
          <dd className={cn('truncate text-sm font-semibold tabular-nums', item.tone ? metricToneClassName[item.tone] : 'text-gray-950')}>
            {item.value}
          </dd>
          {item.helper && <dd className="truncate text-xs text-gray-500">{item.helper}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function OverallAnalysis({ businessToday }: { businessToday: string }) {
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
      summary: buildOverallSummary(months),
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
  const profitMonths = useMemo(() => ({
    gameClub: buildProfitMonths(months, 'gameClub'),
    bar: buildProfitMonths(months, 'bar'),
  }), [months]);

  const balancesByMonth = (ownerMoney ?? EMPTY_OWNER_MONEY).balancesByMonth;
  const ownerTotals = useMemo(() => sumAvailableMoneyResults(Object.values(balancesByMonth)), [balancesByMonth]);
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
    { key: 'month', header: t('tableMonth'), render: (row) => <span className="font-medium text-gray-900">{monthName(row.month)}</span> },
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
      <SourceCards
        title={td('gameClub')}
        description={sinceLabel}
        icon={MonitorSmartphone}
        iconClassName={SIDE_ICON_CLASS.gameClub}
        incomeLabel={t('moneyIn')}
        now={indicators.gameClub}
        loading={loading}
        currency={currency}
      />
      <SourceCards
        title={td('bar')}
        description={sinceLabel}
        icon={ShoppingBag}
        iconClassName={SIDE_ICON_CLASS.bar}
        incomeLabel={t('barSalesIn')}
        now={indicators.bar}
        loading={loading}
        currency={currency}
      />

      {showOwnerProfit && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold text-gray-950">
                <CircleDollarSign size={18} className="shrink-0 text-success-600" aria-hidden="true" />
                {t('ownerSection')}
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">{t('ownerSectionDesc')}</p>
            </div>
            <ButtonLink href="/money-taken" variant="ghost" size="sm" iconRight={<ArrowRight size={15} aria-hidden="true" />}>
              {t('ownerOpen')}
            </ButtonLink>
          </div>
          {ownerQuery.error ? (
            <LoadErrorAlert retrying={ownerQuery.loading} onRetry={() => void ownerQuery.reload()}>
              {t('ownerLoadError')}
            </LoadErrorAlert>
          ) : (
            <div className="space-y-4">
              <OwnerSideCards side="gameClub" balance={ownerTotals.gameClub} loading={ownerLoading} currency={currency} />
              <OwnerSideCards side="bar" balance={ownerTotals.bar} loading={ownerLoading} currency={currency} />
              <ChartCard title={t('ownerChartTitle')} description={t('ownerChartDesc')}>
                {ownerLoading
                  ? <div className="mt-4"><ChartSkeleton /></div>
                  : ownerMonths.length > 0
                    ? <OwnerMonthsChart rows={ownerMonths} locale={locale} currency={currency} />
                    : <ChartEmpty title={t('empty')} className="mt-4" />}
              </ChartCard>
            </div>
          )}
        </section>
      )}

      {loading ? (
        <div className="space-y-4" role="status" aria-label={tc('loading')}>
          <ChartSkeleton />
          <MetricGridSkeleton />
        </div>
      ) : (
        <div className="space-y-6">
          <Section title={t('overallSection')} description={t('overallSectionDesc', { count: summary.months })}>
            <div className="grid gap-4 xl:grid-cols-2">
              {(['gameClub', 'bar'] as const).map((side) => (
                <ChartCard key={side} title={t(side === 'gameClub' ? 'profitMonthsGameClubTitle' : 'profitMonthsBarTitle')} description={t('profitMonthsDesc')}>
                  <ProfitStats items={profitStats(side, summary[side])} />
                  {hasActivity
                    ? <ProfitMonthsChart rows={profitMonths[side]} average={summary[side].averageMonthlyProfit} locale={locale} currency={currency} />
                    : <ChartEmpty title={t('empty')} className="mt-4" />}
                </ChartCard>
              ))}
            </div>
          </Section>

          <Section title={t('reportsSection')} description={t('reportsSectionDesc')} action={granularityControl}>
            {hasActivity ? (
              <>
                <div className="grid gap-4 xl:grid-cols-2">
                  <ChartCard title={t('sideFlowGameClubTitle')} description={t('sideFlowDesc')}>
                    <SideFlowChart rows={series.periods} side="gameClub" granularity={granularity} locale={locale} currency={currency} />
                  </ChartCard>
                  <ChartCard title={t('sideFlowBarTitle')} description={t('sideFlowDesc')}>
                    <SideFlowChart rows={series.periods} side="bar" granularity={granularity} locale={locale} currency={currency} />
                  </ChartCard>
                </div>
                <ChartCard title={t('cumulativeTitle')} description={t('cumulativeDesc')}>
                  <CumulativeProfitChart rows={series.periods} granularity={granularity} locale={locale} currency={currency} />
                </ChartCard>
                <div className="grid gap-4 xl:grid-cols-2">
                  <ChartCard title={t('incomeMixTitle')} description={t('incomeMixDesc')}>
                    <IncomeMixChart rows={series.periods} granularity={granularity} locale={locale} currency={currency} />
                  </ChartCard>
                  <ChartCard title={t('categoryTrendTitle')} description={t('categoryTrendDesc')}>
                    {analysis.topCategories.length > 0 ? (
                      <CategoryTrendChart
                        rows={series.categories}
                        categories={analysis.topCategories}
                        colors={colors}
                        labelFor={categoryName}
                        granularity={granularity}
                        locale={locale}
                        currency={currency}
                      />
                    ) : <ChartEmpty title={t('noExpenses')} className="mt-4" />}
                  </ChartCard>
                </div>
                <ChartCard title={t('weekdayTitle')} description={t('weekdayDesc')}>
                  <WeekdayChart rows={weekdays} locale={locale} currency={currency} />
                </ChartCard>
              </>
            ) : <ChartEmpty title={t('empty')} />}
          </Section>

          <Section title={t('trendsSection')} description={t('trendsSectionDesc')}>
            <ChartCard title={t('tableTitle')} description={showOwnerProfit ? t('tableDescOwner') : t('tableDesc')}>
              <DataTable
                className="mt-4"
                columns={columns}
                data={tableRows}
                keyExtractor={(row) => row.month}
                label={t('tableTitle')}
                dense
              />
            </ChartCard>
          </Section>

          <Section title={t('flowSection')} description={t('flowSectionDesc')}>
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
              <ChartCard title={t('largestTitle')} description={t('overallLargestDesc')}>
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
