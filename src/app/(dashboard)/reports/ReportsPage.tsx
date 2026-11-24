'use client';

// Route: /reports

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRightLeft,
  Banknote,
  Check,
  CircleCheck,
  CircleDollarSign,
  CreditCard,
  Gamepad2,
  HandCoins,
  Landmark,
  Lock,
  ReceiptText,
  Trash2,
  WalletCards,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CategoryIcon,
  DataTable,
  DateRangePicker,
  EmptyState,
  IconButton,
  InlineAlert,
  LoadErrorAlert,
  MetricCard,
  Money,
  PageHeader,
  SectionHeading,
  Select,
  SearchInput,
  SegmentedControl,
  TableSkeleton,
  toneForAmount,
  useConfirm,
  useToast,
  type DataTableColumn,
  type MetricTone,
  metricGridClassName,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import {
  buildFilteredMoneyReport,
  buildMoneyReport,
  expensesFromSource,
  openingBalanceRange,
  withOpeningBalances,
  type MoneyReport,
  type MoneyReportActivity,
  type MoneyReportCategoryFilter,
  type MoneyReportCashRow,
  type MoneyReportBarSalesRow,
  type MoneyReportDebtPaymentRow,
} from '@/lib/calculations/moneyReport';
import type { StockPurchaseCostRow } from '@/lib/calculations/barMoney';
import {
  getDashboardRange,
  type ExpenseRow,
} from '@/lib/calculations/dashboardMetrics';
import { formatCurrency, formatDateOnly, formatDateShort, formatDollars, formatTime } from '@/lib/formatters';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { createClient, mutateFinanceRequest } from '@/lib/supabase/client';
import { requestDailyCashDeletion } from '@/lib/dailyCashApi';
import { isMissingDatabaseFunction } from '@/lib/supabase/errors';
import { cn } from '@/lib/utils';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessPeriod } from '@/lib/useBusinessPeriod';
import { useClubQuery } from '@/lib/useClubQuery';
import { useQuickAction } from '@/lib/quickActions';
import { ExportButton, type ExportFile } from '@/components/ExportButton';
import { sheetFileName } from '@/lib/sheetExport';
import { canAccessFeature } from '@/lib/permissions';
import { expensePaymentMethods } from '@/lib/paymentMethods';
import ExpenseRegistrationForm from '@/components/expenses/ExpenseRegistrationForm';
import { ExpenseModal } from '@/components/expenses/ExpenseModal';
import { ExchangeModal } from './ExchangeForm';
import CollectedTab from './CollectedTab';
import { DonutSkeleton, InOutChartSkeleton } from '@/components/charts/ChartSkeletons';
import { MoneyWhereabouts, PaymentMethodTiles } from './PaymentMethodSection';
import { EntryDetailsSheet, activityKindVariant, type ExpenseCorrection } from './EntryDetailsSheet';
import WriteOffsTab from './WriteOffsTab';
import { fetchDollarExpenses, fetchMoneyExchanges, withDollarAmounts } from '@/lib/supabase/moneyExchanges';
import { fetchReserveMoves } from '@/lib/supabase/reserveMoves';
import type { ReserveMove } from '@/lib/calculations/reserveMoves';
import { requestCollectionChange } from '@/lib/collectionsApi';
import {
  COLLECTED_METHODS,
  moneyStillHeld,
  summarizeCollectedMoney,
  type CollectedMethod,
  type CollectedMoneyMove,
  type CollectionGroup,
} from '@/lib/calculations/collectedMoney';
import {
  deleteMoneyCollection,
  fetchCollectedMoneyMoves,
  isCollectedInsufficientError,
  moveCollectedToReserve,
} from '@/lib/supabase/moneyCollections';
import { fetchReserveHoldings } from '@/lib/supabase/ownerReserve';
import { CollectMoneyModal } from './CollectMoneyForm';
import { ReserveDepositModal } from '@/components/owner-reserve/ReserveDepositModal';
import type { ReserveDepositAmounts } from '@/lib/calculations/ownerReserve';
import { reservedFromGameClubOn } from '@/lib/calculations/entryReserve';
import { ReportsTabs, type ReportsView } from './ReportsTabs';
import { DayBreakdownModal } from './DayBreakdownModal';
import { MethodDaysModal, type PaymentMethodFigure } from './MethodDaysModal';
import type { DayFigure } from '@/lib/calculations/dayExclusion';
import { fetchProfileNames } from '@/lib/supabase/profileNames';
import { fetchDailyCashCollections, type DailyCashCollection } from '@/lib/supabase/dailyCashCollections';
import type { ExchangeMethod, MoneyExchangeRow } from '@/lib/calculations/moneyExchanges';
import { EXPENSE_CATEGORIES, isKnownExpenseCategory, manualExpenseCategoriesFor } from '@/lib/expenseCategories';
import { moneyDetailsHref } from '@/lib/detailLinks';
import dynamic from 'next/dynamic';
import { ChartCard } from '@/components/dashboard/ChartCard';
import { toDonutSlices } from '@/components/charts/donutSlices';
import { expenseTotalsByCategory } from '@/lib/calculations/insights';
import { scrollBehavior } from '@/lib/scroll';

// The recharts chunk loads only on the closeout view, beside the report data.
const DonutBreakdown = dynamic(
  () => import('@/components/charts/DonutBreakdown').then((module) => module.DonutBreakdown),
  { ssr: false, loading: () => <DonutSkeleton /> },
);
const DailyInOutChart = dynamic(
  () => import('@/components/charts/DailyInOutChart').then((module) => module.DailyInOutChart),
  { ssr: false, loading: () => <InOutChartSkeleton /> },
);

const emptyReportRows = {
  cash: [] as MoneyReportCashRow[],
  expenses: [] as ExpenseRow[],
  debtPayments: [] as MoneyReportDebtPaymentRow[],
  barSales: [] as MoneyReportBarSalesRow[],
  stockPurchases: [] as StockPurchaseCostRow[],
  exchanges: [] as MoneyExchangeRow[],
  /** Money moved into or out of the owner reserve (156): kept out of money left. */
  reserveMoves: [] as ReserveMove[],
  collections: [] as DailyCashCollection[],
  /** What each method held when the period began; null when it starts on the 1st or is unknown. */
  opening: null as MoneyReport['paymentMethods'] | null,
  /** Collected money moves (169) from the month's first day through the period's end, like the cards' money left. */
  collectedMoves: [] as CollectedMoneyMove[],
  collectorNames: new Map<string, string | null>() as ReadonlyMap<string, string | null>,
  /** The owner reserve's sums, for owners; null when it cannot be read. */
  reserveSums: null as number | null,
};

type ReportRange = { from: string; to: string };

function sameRange(a: ReportRange, b: ReportRange): boolean {
  return a.from === b.from && a.to === b.to;
}

interface MoneyReportSnapshotPayload {
  cash: MoneyReportCashRow[];
  expenses: ExpenseRow[];
  debtPayments: MoneyReportDebtPaymentRow[];
  barSales: MoneyReportBarSalesRow[];
  stockPurchases: StockPurchaseCostRow[];
}

/** Money in is green, money out is red; the row's own sign decides. */
function amountToneClassName(amount: number): string {
  return amount < 0 ? 'text-danger-600' : 'text-success-600';
}

/** One entry of the closeout table; entries are grouped under a one-line header per day. */
type CloseoutRow = { key: string; date: string; activity: MoneyReportActivity };

function SummaryCard({
  label,
  value,
  icon,
  tone,
  loading = false,
  href,
  onClick,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: MetricTone;
  loading?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  return (
    <MetricCard
      href={href}
      onClick={onClick}
      label={label}
      value={<Money amount={value} currencyClassName="text-sm font-medium tracking-normal text-gray-500" />}
      tone={tone}
      icon={icon}
      loading={loading}
    />
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A `?from&to` range from a link (e.g. a money flow), or null when it is missing or malformed. */
function requestedReportRange(from: string | undefined, to: string | undefined): ReportRange | null {
  if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) return null;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** A `?category` filter from a link; unknown values fall back to every row. */
function requestedCategoryFilter(category: string | undefined): MoneyReportCategoryFilter {
  if (category === 'money_in' || category === 'income' || category === 'debt_payment' || category === 'expense' || category === 'exchange') return category;
  if (category?.startsWith('expense:') && isKnownExpenseCategory(category.slice('expense:'.length))) {
    return category as MoneyReportCategoryFilter;
  }
  return 'all';
}

/** A `?source` filter from a money-flow link: only expenses paid from that side's money. */
function requestedSourceFilter(source: string | undefined): ExpenseSourceFilter {
  return source === 'game_club' || source === 'bar' ? source : null;
}

type ExpenseSourceFilter = 'game_club' | 'bar' | null;


/** A red edge down the left of every row of a closed (collected) day. */
const CLOSED_DAY_ROW = '[&>td:first-child]:shadow-[inset_4px_0_0_rgb(var(--c-danger-500))]';
/** The day header of a closed day: tinted, with the same red edge and the header's hairlines. */
const CLOSED_DAY_HEADER = 'bg-danger-100/70 shadow-[inset_4px_0_0_rgb(var(--c-danger-500)),inset_0_1px_0_rgb(var(--c-gray-200)),inset_0_-1px_0_rgb(var(--c-gray-200))]';

/** Lower case with spaces and thousands separators dropped from digits, so "1 200 000" finds 1200000. */
function searchText(value: string): string {
  return value.toLowerCase().replace(/(\d)[\s\u00a0\u202f,.]+(?=\d)/g, '$1');
}

export default function ReportsPage({ requestedFrom, requestedTo, requestedCategory, requestedSource, requestedView }: {
  requestedFrom?: string;
  requestedTo?: string;
  requestedCategory?: string;
  requestedSource?: string;
  requestedView?: string;
} = {}) {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const te = useTranslations('expenses.categories');
  const tex = useTranslations('expenses');
  const tg = useTranslations('glance');
  const tor = useTranslations('ownerReserve');
  const { locale } = useAppLocale();
  const { selectedClubId, businessDayStartHour, role, featureAccess, enabledPaymentMethods } = useClub();
  const hasReportsAccess = canAccessFeature(role, featureAccess, 'reports');
  // Members with only the expenses feature land here to register expenses.
  const canRegisterExpenses = canAccessFeature(role, featureAccess, 'expenses');
  // Collectors tick a date once they have the money; only an owner can undo it.
  const canCollect = canAccessFeature(role, featureAccess, 'collection');
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  // Reached through "Add an expense" in the quick-add sheet or the command palette.
  // Without Reports access the form is already on the page.
  useQuickAction('expense', () => setExpenseDialogOpen(true), hasReportsAccess && canRegisterExpenses);
  const [exchangeDialogOpen, setExchangeDialogOpen] = useState(false);
  const businessToday = useBusinessToday(businessDayStartHour);
  // A club switch opens the current month; a business-day rollover moves the
  // range forward only while it is still the previous day's default range.
  // A link's period and category (from a money flow) win over the current month.
  const defaultRange = useMemo(
    () => requestedReportRange(requestedFrom, requestedTo) ?? getDashboardRange('month', businessToday),
    [businessToday, requestedFrom, requestedTo],
  );
  const [range, setRange] = useBusinessPeriod<ReportRange>(defaultRange, selectedClubId, sameRange);
  const [categoryFilter, setCategoryFilter] = useState<MoneyReportCategoryFilter>(() => requestedCategoryFilter(requestedCategory));
  useEffect(() => {
    setCategoryFilter(requestedCategoryFilter(requestedCategory));
  }, [requestedCategory]);
  /** Narrows the closeout table to dates ticked as collected, or to the ones still waiting. */
  const [collectionFilter, setCollectionFilter] = useState<'all' | 'pending' | 'collected'>('all');
  /** Narrows the closeout to entries whose comment, person, type, category, method or amount match. */
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ReportsView>(requestedView === 'collected' || (requestedView === 'writeOffs' && role === 'owner') ? requestedView : 'closeout');
  // Keep the tab shareable without dropping the rest of the link.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (view !== 'closeout') params.set('view', view);
    else params.delete('view');
    const query = params.toString();
    if (query !== window.location.search.replace(/^\?/, '')) {
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }
  }, [view]);
  const [sourceFilter, setSourceFilter] = useState<ExpenseSourceFilter>(() => requestedSourceFilter(requestedSource));
  /** A summary card narrows the closeout to the entries behind its figure and scrolls to them. */
  const showCloseout = (category: MoneyReportCategoryFilter, source: ExpenseSourceFilter) => {
    setCategoryFilter(category);
    setSourceFilter(source);
    setCollectionFilter('all');
    setSearch('');
    document.getElementById('report-closeout')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  };
  /** "With the admin" is the money of the days nobody has collected yet: show those days, or every day on a second tap. */
  const showPendingDays = () => {
    const selected = view === 'closeout' && collectionFilter === 'pending';
    setView('closeout');
    setCollectionFilter(selected ? 'all' : 'pending');
    if (selected) return;
    // The table is not mounted yet when this comes from another tab.
    requestAnimationFrame(() => {
      document.getElementById('report-closeout')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    });
  };
  useEffect(() => {
    setSourceFilter(requestedSourceFilter(requestedSource));
  }, [requestedSource]);
  /** Translated result of a failed delete. */
  const [actionError, setActionError] = useState('');
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<{ activity: MoneyReportActivity; date: string } | null>(null);
  /** The day figure the owner tapped, to see its entries and leave some out. */
  const [dayBreakdown, setDayBreakdown] = useState<{ date: string; figure: DayFigure } | null>(null);
  /** The payment method card the owner tapped, to list the days that moved it. */
  const [methodDays, setMethodDays] = useState<PaymentMethodFigure | null>(null);
  const currentClubId = useRef(selectedClubId);
  const deletePending = useRef(false);
  const [methodSaving, setMethodSaving] = useState(false);
  const [collectingDate, setCollectingDate] = useState<string | null>(null);
  const isOwner = role === 'owner';
  const loadReport = useCallback(async (isCurrent: () => boolean): Promise<typeof emptyReportRows> => {
    if (!selectedClubId || !hasReportsAccess) return emptyReportRows;

    const supabase = createClient();
    const collectedFrom = openingBalanceRange(range.from)?.from ?? range.from;
    const [snapshotResult, exchangeRows, collections, dollarExpenses, { opening }, reserveMoves, collectedMoves, reserveHoldings] = await Promise.all([
      supabase.rpc('get_money_report_snapshot', {
        p_club_id: selectedClubId,
        p_range_from: range.from,
        p_range_to: range.to,
      }),
      // Exchanges (092) are read beside the snapshot, which predates them.
      fetchMoneyExchanges(supabase, selectedClubId, range.from, range.to),
      fetchDailyCashCollections(supabase, selectedClubId, range.from, range.to),
      // Dollars spent by expenses (124) are read beside the snapshot, which predates them.
      fetchDollarExpenses(supabase, selectedClubId, range.from, range.to),
      loadOpening(selectedClubId),
      fetchReserveMoves(supabase, selectedClubId, range.from, range.to),
      fetchCollectedMoneyMoves(supabase, selectedClubId, collectedFrom, range.to),
      isOwner ? fetchReserveHoldings(supabase, selectedClubId) : Promise.resolve(null),
    ]);
    // Everyone who moved collected money: collectors, and who paid from it or moved it to the reserve.
    const collectorNames = await fetchProfileNames(supabase, collectedMoves.flatMap((move) => (
      move.createdBy ? [move.createdBy] : []
    )));
    const collectedRows = { collectedMoves, collectorNames, reserveSums: reserveHoldings?.sums ?? null };

    if (!snapshotResult.error) {
      const snapshot = snapshotResult.data as MoneyReportSnapshotPayload;
      return {
        cash: snapshot.cash ?? [],
        expenses: withDollarAmounts(snapshot.expenses ?? [], dollarExpenses),
        debtPayments: snapshot.debtPayments ?? [],
        barSales: snapshot.barSales ?? [],
        stockPurchases: snapshot.stockPurchases ?? [],
        exchanges: await withExchangeCreators(exchangeRows),
        reserveMoves,
        collections,
        opening,
        ...collectedRows,
      };
    }

    if (!isMissingDatabaseFunction(snapshotResult.error, 'get_money_report_snapshot')) {
      throw snapshotResult.error;
    }

    // Compatibility path while migration 047 is being deployed.
    const [cashResult, expenseResult, debtPaymentResult, barSalesResult, stockPurchaseResult] = await Promise.all([
      fetchAllRows<MoneyReportCashRow>(() => supabase
        .from('daily_cash_entries')
        .select('id,date,cash_income,terminal_income,card_income,playstation_income,comment,created_by,created_at')
        .eq('club_id', selectedClubId)
        .gte('date', range.from)
        .lte('date', range.to)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true })),
      fetchAllRows<ExpenseRow>(() => supabase
        .from('expenses')
        .select('id,date,amount,category,payment_method,payment_source,comment,created_by,created_at')
        .eq('club_id', selectedClubId)
        .gte('date', range.from)
        .lte('date', range.to)
        .order('date', { ascending: true })
        .order('id', { ascending: true })),
      fetchAllRows<MoneyReportDebtPaymentRow>(() => supabase
        .from('debt_payments')
        .select('id,date,amount,payment_method,comment,created_at')
        .eq('club_id', selectedClubId)
        .gte('date', range.from)
        .lte('date', range.to)
        .order('date', { ascending: true })
        .order('id', { ascending: true })),
      fetchAllRows<MoneyReportBarSalesRow>(() => supabase
        .from('daily_stock_counts')
        .select('date,bar_income')
        .eq('club_id', selectedClubId)
        .gte('date', range.from)
        .lte('date', range.to)
        .order('date', { ascending: true })
        .order('product_id', { ascending: true })),
      fetchAllRows<StockPurchaseCostRow>(() => supabase
        .from('stock_purchases')
        .select('date,quantity,cost_price')
        .eq('club_id', selectedClubId)
        .gte('date', range.from)
        .lte('date', range.to)
        .order('date', { ascending: true })
        .order('id', { ascending: true })),
    ]);

    const firstError = [
      cashResult.error,
      expenseResult.error,
      debtPaymentResult.error,
      barSalesResult.error,
      stockPurchaseResult.error,
    ].find(Boolean);
    if (firstError) throw firstError;

    const cashRows = (cashResult.data ?? []) as MoneyReportCashRow[];
    const expenseRows = withDollarAmounts((expenseResult.data ?? []) as ExpenseRow[], dollarExpenses);
    const creatorIds = Array.from(new Set([
      ...cashRows.map((row) => row.created_by),
      ...expenseRows.map((row) => row.created_by),
      ...exchangeRows.map((row) => row.created_by),
    ].filter((creatorId): creatorId is string => Boolean(creatorId))));
    // A superseded load skips the creator lookup.
    if (!isCurrent()) return emptyReportRows;
    const creatorNames = await fetchProfileNames(supabase, creatorIds);

    return {
      cash: cashRows.map((row) => ({
        ...row,
        creator_name: row.created_by ? creatorNames.get(row.created_by) ?? null : null,
      })),
      expenses: expenseRows.map((row) => ({
        ...row,
        creator_name: row.created_by ? creatorNames.get(row.created_by) ?? null : null,
      })),
      debtPayments: (debtPaymentResult.data ?? []) as MoneyReportDebtPaymentRow[],
      barSales: (barSalesResult.data ?? []) as MoneyReportBarSalesRow[],
      stockPurchases: (stockPurchaseResult.data ?? []) as StockPurchaseCostRow[],
      exchanges: exchangeRows.map((row) => ({
        ...row,
        creator_name: row.created_by ? creatorNames.get(row.created_by) ?? null : null,
      })),
      reserveMoves,
      collections,
      opening,
      ...collectedRows,
    };

    /**
     * Money is counted per month, so a period starting mid-month begins with
     * what the month's earlier days left in each method. Null before the
     * snapshot RPC (047) exists: the cards then show the period alone.
     */
    async function loadOpening(clubId: string): Promise<Pick<typeof emptyReportRows, 'opening'>> {
      const none = { opening: null };
      const earlier = openingBalanceRange(range.from);
      if (!earlier) return none;
      const [result, earlierExchanges, earlierMoves] = await Promise.all([
        supabase.rpc('get_money_report_snapshot', { p_club_id: clubId, p_range_from: earlier.from, p_range_to: earlier.to }),
        fetchMoneyExchanges(supabase, clubId, earlier.from, earlier.to),
        fetchReserveMoves(supabase, clubId, earlier.from, earlier.to),
      ]);
      if (result.error) {
        if (isMissingDatabaseFunction(result.error, 'get_money_report_snapshot')) return none;
        throw result.error;
      }
      const rows = result.data as MoneyReportSnapshotPayload;
      const earlierReport = buildMoneyReport(rows.cash ?? [], rows.expenses ?? [], rows.debtPayments ?? [], [], [], earlierExchanges, earlierMoves);
      return { opening: earlierReport.paymentMethods };
    }

    /** The snapshot names its own rows' creators; exchanges need the same lookup. */
    async function withExchangeCreators(rows: MoneyExchangeRow[]): Promise<MoneyExchangeRow[]> {
      const names = await fetchProfileNames(supabase, rows.map((row) => row.created_by));
      return rows.map((row) => ({ ...row, creator_name: row.created_by ? names.get(row.created_by) ?? null : null }));
    }
  }, [hasReportsAccess, isOwner, range.from, range.to, selectedClubId]);
  const reportQuery = useClubQuery<typeof emptyReportRows>(loadReport, emptyReportRows);
  const { loading, reload: reloadReport } = reportQuery;
  /** The report failed to load; shown with a Retry action instead of the empty state. */
  const loadFailed = reportQuery.error;
  // A failed load shows no figures, even after a silent reload.
  const reportRows = loadFailed ? emptyReportRows : reportQuery.data;
  // Summary and payment-method cards always describe the whole period: a category
  // filter narrows only the closeout table, so it cannot zero out bar sales or
  // stock purchases in the "left" figures.
  const report = useMemo(() => buildFilteredMoneyReport(
    reportRows.cash,
    reportRows.expenses,
    reportRows.debtPayments,
    'all',
    reportRows.barSales,
    reportRows.stockPurchases,
    reportRows.exchanges,
    reportRows.reserveMoves,
  ), [reportRows]);
  const filteredReport = useMemo(() => (categoryFilter === 'all' && !sourceFilter ? report : buildFilteredMoneyReport(
    reportRows.cash,
    expensesFromSource(reportRows.expenses, sourceFilter),
    reportRows.debtPayments,
    categoryFilter,
    reportRows.barSales,
    reportRows.stockPurchases,
    // Exchanges move Game Club money; a bar-only view has none.
    sourceFilter === 'bar' ? [] : reportRows.exchanges,
    sourceFilter ? reportRows.reserveMoves.filter((move) => move.source === sourceFilter) : reportRows.reserveMoves,
  )), [categoryFilter, report, reportRows, sourceFilter]);
  // The cards start from what each method already held when the period began.
  // Game Club money in and out per day, oldest first, for the day-by-day chart.
  const dailyFlow = useMemo(
    () => [...report.days]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => ({ date: day.date, label: formatDateShort(day.date, locale), income: day.income, expenses: day.gameClubExpenses })),
    [report.days, locale],
  );
  // Game Club spending by category for the period, each slice opening its entries.
  const spendingSlices = useMemo(() => toDonutSlices(
    expenseTotalsByCategory(reportRows.expenses, 'game_club').map(({ category, value }) => ({ key: category, label: expenseCategoryLabel(category), value })),
    { key: 'other', label: tg('other') },
    (category) => showCloseout(`expense:${category}`, 'game_club'),
  // Labels and the click handler only read stable translators and setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [reportRows.expenses, tg]);
  const paymentCardData = useMemo(
    () => withOpeningBalances(report.paymentMethods, reportRows.opening),
    [report.paymentMethods, reportRows.opening],
  );
  // Collected money over the same span as the cards' money left: the month's first day through the period's end.
  const collectedSummary = useMemo(() => summarizeCollectedMoney(reportRows.collectedMoves), [reportRows.collectedMoves]);
  const collectedByMethod = collectedSummary.held;
  // What the admin still holds: each method's money left, less what the collector holds of it.
  const kassaByMethod = useMemo(() => Object.fromEntries(COLLECTED_METHODS.map((method) => [
    method,
    moneyStillHeld(paymentCardData[method].left, collectedSummary.held[method]),
  ])) as Record<CollectedMethod, number>, [collectedSummary.held, paymentCardData]);
  const kassaTotal = COLLECTED_METHODS.reduce((sum, method) => sum + kassaByMethod[method], 0);
  const [collectDialogOpen, setCollectDialogOpen] = useState(false);
  /** Owner: the reserve deposit form, open with the day and amounts it starts from (none: today, all the till holds). */
  const [reserveDeposit, setReserveDeposit] = useState<{ date?: string; amounts?: ReserveDepositAmounts } | null>(null);

  // Dialogs belong to the club they were opened for: close them on a club switch.
  useEffect(() => {
    currentClubId.current = selectedClubId;
    setSelectedEntry(null);
    setDayBreakdown(null);
    setMethodDays(null);
    setExpenseDialogOpen(false);
    setExchangeDialogOpen(false);
    setCollectDialogOpen(false);
    setReserveDeposit(null);
    setActionError('');
  }, [selectedClubId]);

  /** Owner: give a collection back to the admin's kassa (a mistake). */
  async function handleUndoCollection(group: CollectionGroup) {
    if (!isOwner || !selectedClubId) return;
    const clubId = selectedClubId;
    const confirmed = await confirm({
      title: t('collectMoney.undo'),
      description: t('collectMoney.undoConfirm', {
        amount: `${formatCurrency(group.total)} ${tc('currency')}`,
        date: formatDateOnly(group.date, locale),
      }),
      confirmLabel: t('collectMoney.undo'),
    });
    if (!confirmed || currentClubId.current !== clubId) return;
    setActionError('');
    const { error } = await deleteMoneyCollection(createClient(), clubId, group.id);
    if (currentClubId.current !== clubId) return;
    if (error) {
      setActionError(isCollectedInsufficientError(error) ? t('collectMoney.undoSpent') : t('collectMoney.error'));
      return;
    }
    showToast(t('collectMoney.undone'));
    void reloadReport({ silent: true });
  }

  /** Owner: move collected money into the reserve. Resolves to an error message, or null when saved. */
  async function handleMoveCollectedToReserve(input: { method: CollectedMethod; amount: number; date: string }): Promise<string | null> {
    if (!isOwner || !selectedClubId) return tc('accessDeniedDescription');
    const { error } = await moveCollectedToReserve(createClient(), {
      clubId: selectedClubId,
      id: crypto.randomUUID(),
      date: input.date,
      method: input.method,
      amount: input.amount,
      comment: null,
    });
    if (error) {
      if (isCollectedInsufficientError(error)) return t('collectMoney.toReserveTooMuch', { amount: `${formatCurrency(collectedSummary.held[input.method])} ${tc('currency')}` });
      if ((error as { hint?: string }).hint === 'reserve_exceeds_available') return t('collectMoney.toReserveNoProfit');
      return t('collectMoney.error');
    }
    showToast(t('collectMoney.movedToReserveToast'));
    void reloadReport({ silent: true });
    return null;
  }

  async function handleDeleteActivity(activity: MoneyReportActivity, date: string) {
    if (!isOwner || !selectedClubId || !activity.id || activity.source === 'debt_payment') return;
    if (deletePending.current) return;
    const clubId = selectedClubId;
    const confirmed = await confirm({
      title: tc('delete'),
      description: t('deleteEntryConfirmDetailed', {
        type: activityTypeLabel(activity),
        category: categoryLabel(activity),
        amount: activity.exchange
          ? exchangeAmountLabel(activity.exchange.from, activity.exchange.fromAmount)
          : `${formatCurrency(Math.abs(activity.amount))} ${tc('currency')}`,
        date: formatDateOnly(date, locale),
      }),
      confirmLabel: tc('delete'),
    });
    // The dialog can outlive a club switch; never delete from a stale list.
    if (!confirmed || currentClubId.current !== clubId || deletePending.current) return;

    const key = `${activity.source}:${activity.id}`;
    deletePending.current = true;
    setDeletingKey(key);
    setActionError('');

    try {
      let deleteError: string | null = null;
      if (activity.source === 'exchange') {
        const response = await mutateFinanceRequest('/api/exchanges', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clubId, exchangeId: activity.id }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null) as { code?: string } | null;
          deleteError = result?.code === 'DAY_COLLECTED'
            ? tc('dayClosed')
            : result?.code === 'INSUFFICIENT_BALANCE'
            ? t('exchangeDeleteSpent')
            : response.status === 401 || response.status === 403
            ? tc('accessDeniedDescription')
            : t('deleteError');
        }
      } else if (activity.source === 'expense') {
        const response = await mutateFinanceRequest('/api/expenses', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clubId, expenseId: activity.id }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null) as { error?: string; code?: string } | null;
          deleteError = result?.code === 'SALARY_PAYMENT_IMMUTABLE'
            ? t('salaryPaymentProtected')
            : result?.code === 'SHORTAGE_IMMUTABLE'
            ? t('shortageProtected')
            : result?.code === 'DAY_COLLECTED'
              ? tc('dayClosed')
              : response.status === 401 || response.status === 403
              ? tc('accessDeniedDescription')
              : t('deleteError');
        }
      } else {
        const { status, code } = await requestDailyCashDeletion(clubId, activity.id);
        if (status !== 200) {
          deleteError = code === 'INSUFFICIENT_BALANCE'
            ? tc('incomeAlreadySpent')
            : status === 409
            ? tc('dayClosed')
            : status === 401 || status === 403 ? tc('accessDeniedDescription') : t('deleteError');
        }
      }

      if (currentClubId.current !== clubId) return;
      if (deleteError) {
        setActionError(deleteError);
        return;
      }

      setSelectedEntry(null);
      showToast(t('entryDeleted'));
      await reloadReport({ silent: true });
    } catch {
      if (currentClubId.current === clubId) setActionError(t('deleteError'));
    } finally {
      deletePending.current = false;
      setDeletingKey(null);
    }
  }

  /** Owners correct an ordinary expense's payment method, date or category; the club group message is edited server-side. */
  async function handleUpdateExpense(
    activity: MoneyReportActivity,
    change: ExpenseCorrection,
  ) {
    if (!isOwner || !selectedClubId || !activity.id || activity.source !== 'expense' || methodSaving) return;
    if ('paymentMethod' in change && change.paymentMethod === activity.paymentMethod) return;
    if ('date' in change && change.date === selectedEntry?.date) return;
    if ('category' in change && change.category === activity.category) return;
    const errorText = 'date' in change ? t('dateUpdateError') : 'category' in change ? t('categoryUpdateError') : t('paymentMethodUpdateError');
    const clubId = selectedClubId;
    setMethodSaving(true);
    setActionError('');
    try {
      const response = await mutateFinanceRequest('/api/expenses', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clubId, expenseId: activity.id, ...change }),
      });
      if (currentClubId.current !== clubId) return;
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { code?: string } | null;
        setActionError(result?.code === 'SALARY_PAYMENT_IMMUTABLE'
          ? t('salaryPaymentMethodProtected')
          : result?.code === 'DAY_COLLECTED'
            ? tc('dayClosed')
            : result?.code === 'INSUFFICIENT_BALANCE'
            ? tex('errors.insufficientBalance')
            : response.status === 401 || response.status === 403
            ? tc('accessDeniedDescription')
            : errorText);
        return;
      }
      setSelectedEntry((current) => (current?.activity.id === activity.id
        ? 'date' in change
          ? { ...current, date: change.date }
          : 'category' in change
            ? { ...current, activity: { ...current.activity, category: change.category } }
            : { ...current, activity: { ...current.activity, paymentMethod: change.paymentMethod } }
        : current));
      showToast('date' in change ? t('dateUpdated') : 'category' in change ? t('categoryUpdated') : t('paymentMethodUpdated'));
      await reloadReport({ silent: true });
    } catch {
      if (currentClubId.current === clubId) setActionError(errorText);
    } finally {
      setMethodSaving(false);
    }
  }

  const collectionsByDate = useMemo(
    () => new Map(reportRows.collections.map((collection) => [collection.date, collection])),
    [reportRows.collections],
  );

  /** A collector ticks a date as collected; an owner can also undo a tick. */
  async function handleToggleCollected(date: string) {
    if (!selectedClubId || collectingDate) return;
    const collected = collectionsByDate.has(date);
    if (collected ? !isOwner : !canCollect) return;
    const clubId = selectedClubId;
    const confirmed = await confirm(collected ? {
      title: t('collectionUndo'),
      description: t('collectionUndoConfirm', { date: formatDateOnly(date, locale) }),
      confirmLabel: t('collectionUndo'),
    } : {
      title: t('collectionMark'),
      description: t('collectionMarkConfirm', { date: formatDateOnly(date, locale) }),
      confirmLabel: t('collectionMark'),
      tone: 'primary',
    });
    if (!confirmed || currentClubId.current !== clubId) return;
    setCollectingDate(date);
    setActionError('');
    try {
      const status = await requestCollectionChange(clubId, date, !collected);
      if (currentClubId.current !== clubId) return;
      if (status !== 200) {
        setActionError(status === 403 ? tc('accessDeniedDescription') : t('collectionError'));
        return;
      }
      showToast(collected ? t('collectionUndone') : t('collectionSaved'));
      await reloadReport({ silent: true });
    } catch {
      if (currentClubId.current === clubId) setActionError(t('collectionError'));
    } finally {
      setCollectingDate(null);
    }
  }

  function collectionCell(date: string) {
    const collection = collectionsByDate.get(date);
    const dateLabel = formatDateOnly(date, locale);
    if (collection) {
      const label = t('collectedBy', { name: collection.collector_name || t('unknownCreator') });
      if (!isOwner) {
        return (
          <span className="inline-flex h-8 w-8 items-center justify-center text-success-600" title={label}>
            <CircleCheck size={18} aria-label={label} />
          </span>
        );
      }
      return (
        <IconButton
          variant="success"
          size="sm"
          label={`${label} · ${t('collectionUndo')}: ${dateLabel}`}
          icon={<CircleCheck size={18} aria-hidden="true" />}
          loading={collectingDate === date}
          disabled={collectingDate !== null && collectingDate !== date}
          onClick={(event) => {
            event.stopPropagation();
            void handleToggleCollected(date);
          }}
        />
      );
    }
    if (!canCollect) return null;
    return (
      <IconButton
        variant="outline"
        size="sm"
        label={`${t('collectionMark')}: ${dateLabel}`}
        icon={<Check size={15} aria-hidden="true" />}
        loading={collectingDate === date}
        disabled={collectingDate !== null && collectingDate !== date}
        onClick={(event) => {
          event.stopPropagation();
          void handleToggleCollected(date);
        }}
      />
    );
  }

  function categoryLabel(activity: MoneyReportActivity): string {
    if (activity.exchange) return `${exchangeMethodLabel(activity.exchange.from)} → ${exchangeMethodLabel(activity.exchange.to)}`;
    if (activity.kind === 'income') return t('dailyClubIncome');
    if (activity.kind === 'debt_payment') return t('debtPayment');
    const category = activity.category ?? 'other';
    const label = isKnownExpenseCategory(category) || category === 'other' ? te(category) : category;
    return activity.paymentSource === 'bar' ? `${t('bar')} · ${label}` : label;
  }

  function expenseCategoryLabel(category: string): string {
    return isKnownExpenseCategory(category) || category === 'other' ? te(category) : category;
  }

  /**
   * Hand-chosen categories its source may pay for (Bar money: cleaning and food/drinks),
   * plus the current one so an old category still displays.
   */
  function categoryOptions(activity: MoneyReportActivity): string[] {
    const current = activity.category;
    const categories = manualExpenseCategoriesFor(activity.paymentSource ?? 'game_club');
    return current && !categories.includes(current) ? [current, ...categories] : categories;
  }

  function canCorrectExpense(activity: MoneyReportActivity, date: string): boolean {
    // Payroll payments take their date and category from the salary entry; a collected day is closed.
    return canCorrectPaymentMethod(activity, date) && activity.category !== 'salary';
  }

  /** A payroll payment's method can be corrected too: its salary entry changes with it. */
  function canCorrectPaymentMethod(activity: MoneyReportActivity, date: string): boolean {
    // A cash shortage's expense mirrors its shortage (135): it changes and goes only on Owner Profit.
    return isOwner && activity.source === 'expense' && Boolean(activity.id) && activity.category !== 'shortage' && !collectionsByDate.has(date);
  }

  /** Methods this expense can use, plus the current one so a since-disabled method still displays. */
  function paymentMethodOptions(activity: MoneyReportActivity): string[] {
    const current = activity.paymentMethod;
    // Dollars are converted at their own rate when spent, so no expense moves into them later.
    // A salary entry records only cash, terminal or card.
    const methods: string[] = expensePaymentMethods(enabledPaymentMethods, activity.paymentSource === 'bar' ? 'bar' : 'game_club')
      .filter((method) => method !== 'usd' && (activity.category !== 'salary' || method !== 'playstation'));
    return current && !methods.includes(current) ? [current, ...methods] : methods;
  }

  function exchangeMethodLabel(method: ExchangeMethod): string {
    return method === 'usd' ? t('usd') : tc(`paymentMethods.${method}`);
  }

  /** "500 000 UZS" or "$40"; dollars keep cents. */
  function exchangeAmountLabel(method: ExchangeMethod, amount: number): string {
    return method === 'usd' ? formatDollars(amount) : `${formatCurrency(amount)} ${tc('currency')}`;
  }

  function activityTypeLabel(activity: MoneyReportActivity): string {
    if (activity.kind === 'exchange') return t('exchange');
    if (activity.kind === 'income') return t('income');
    if (activity.kind === 'debt_payment') return t('debtPayment');
    return t('expense');
  }

  function paymentLabel(method: string | null): string {
    if (!method) return t('mixedPayments');
    if (method === 'playstation') return t('playstation');
    if (method === 'usd') return t('usd');
    if (method === 'cash' || method === 'terminal' || method === 'card') {
      return tc(`paymentMethods.${method}`);
    }
    return method;
  }

  const paymentCards = [
    { method: 'cash' as const, label: t('cash'), icon: Banknote },
    { method: 'terminal' as const, label: t('terminal'), icon: Landmark },
    { method: 'card' as const, label: t('card'), icon: CreditCard },
    { method: 'playstation' as const, label: t('playstation'), icon: Gamepad2 },
  ];

  // Hide a method the club has turned off, unless it still carries money
  // in this period (recorded before it was turned off), so totals add up.
  const shownPaymentCards = paymentCards.filter((card) => {
    if (card.method === 'playstation') return true;
    if (enabledPaymentMethods.includes(card.method)) return true;
    const data = paymentCardData[card.method];
    return data.opening !== 0 || data.collected !== 0 || data.expenses !== 0 || data.exchangedIn !== 0 || data.exchangedOut !== 0
      || (data.reserved ?? 0) !== 0 || collectedByMethod[card.method] !== 0;
  });

  /** A payment method's icon and name, as on the payment method cards above the table. */
  function paymentMethodChip(method: string) {
    const Icon = paymentCards.find((card) => card.method === method)?.icon;
    return (
      <span key={method} className="inline-flex items-center gap-1.5 whitespace-nowrap text-gray-700">
        {Icon && <Icon size={14} className="shrink-0 text-gray-400" aria-hidden="true" />}
        {paymentLabel(method)}
      </span>
    );
  }

  const collectedDayCount = filteredReport.days.filter((day) => collectionsByDate.has(day.date)).length;
  const searchQuery = searchText(search.trim());
  function matchesSearch(activity: MoneyReportActivity): boolean {
    if (!searchQuery) return true;
    const amounts = activity.exchange
      ? [activity.exchange.fromAmount, activity.exchange.toAmount]
      : [Math.abs(activity.amount)];
    const methods = activity.paymentBreakdown
      ? (Object.keys(activity.paymentBreakdown) as Array<keyof typeof activity.paymentBreakdown>).filter((method) => activity.paymentBreakdown?.[method])
      : [activity.paymentMethod];
    return searchText([
      activity.comment ?? '',
      activity.createdByName ?? '',
      activityTypeLabel(activity),
      categoryLabel(activity),
      ...methods.map((method) => paymentLabel(method ?? null)),
      ...amounts.map((amount) => String(amount)),
    ].join(' ')).includes(searchQuery);
  }
  // Days in the chosen state, each with its entries that match the search; a day with none is left out while searching.
  const closeoutDays = filteredReport.days
    .filter((day) => collectionFilter === 'all' || collectionsByDate.has(day.date) === (collectionFilter === 'collected'))
    .map((day) => ({
      day,
      rows: day.activities.filter(matchesSearch).map((activity, index): CloseoutRow => ({
        key: activity.id ? `${activity.source}:${activity.id}` : `${day.date}-${activity.source}-${index}`,
        date: day.date,
        activity,
      })),
    }))
    .filter(({ rows }) => rows.length > 0);
  const closeoutRows = closeoutDays.flatMap(({ rows }) => rows);

  /** The entries of the closeout as filtered on screen, one row each; exchanges show what was given. */
  function exportCloseout(): ExportFile {
    const typeTone = { income: 'success', debt_payment: 'warning', expense: 'danger', exchange: 'muted' } as const;
    const rows = closeoutRows.map((row) => [
      row.date,
      { value: activityTypeLabel(row.activity), tone: typeTone[row.activity.kind] },
      categoryLabel(row.activity),
      row.activity.exchange ? row.activity.exchange.fromAmount : row.activity.amount,
      row.activity.exchange ? exchangeMethodLabel(row.activity.exchange.from) : paymentLabel(row.activity.paymentMethod),
      row.activity.comment ?? '',
      row.activity.createdByName ?? '',
    ]);
    return {
      fileName: sheetFileName('reports', range.from, range.to),
      sheets: [{
        name: t('dailyCloseout'),
        period: range.from === range.to ? formatDateOnly(range.from, locale) : `${formatDateOnly(range.from, locale)} – ${formatDateOnly(range.to, locale)}`,
        columns: [
          { header: t('date'), type: 'date' },
          { header: t('type') },
          { header: t('category') },
          { header: `${t('amount')} (${tc('currency')})`, type: 'money' },
          { header: tc('paymentMethod') },
          { header: t('descriptionLabel'), type: 'longText' },
          { header: tc('recordedBy') },
        ],
        rows,
      }],
    };
  }

  // Owners delete entries and undo ticks; collectors tick dates.
  const showActions = isOwner || canCollect;

  const dayFigureLabels: Record<DayFigure, string> = {
    income: t('income'),
    expenses: t('expenses'),
    barExpenses: `${t('bar')} · ${t('expenses')}`,
    cash: t('cash'),
    terminal: t('terminal'),
    card: t('card'),
    playstation: t('playstation'),
  };

  /** A day header figure that opens its entries; the header row itself stays inert. */
  function dayFigureButton(date: string, figure: DayFigure, children: ReactNode) {
    return (
      <Button
        key={figure}
        variant="ghost"
        size="sm"
        className="min-h-7 gap-1.5 px-2 text-xs font-medium text-gray-600"
        title={t('showDayFigure', { figure: dayFigureLabels[figure] })}
        onClick={(event) => {
          event.stopPropagation();
          setDayBreakdown({ date, figure });
        }}
      >
        {children}
      </Button>
    );
  }

  /** One line per day over its entries: date, day total, the figures that open their entries, and the collection tick. */
  function dayHeader(day: MoneyReport['days'][number]) {
    const closed = collectionsByDate.has(day.date);
    const left = { cash: day.cash, terminal: day.terminal, card: day.card, playstation: day.playstation };
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span className={closed ? 'text-danger-700' : 'text-gray-900'}>{formatDateOnly(day.date, locale)}</span>
          <Badge variant="outline" size="sm">{day.activities.length}</Badge>
          {closed && <Badge variant="danger" size="sm" icon={<Lock size={11} aria-hidden="true" />}>{t('dayClosed')}</Badge>}
        </span>
        <span className={cn('whitespace-nowrap tabular-nums', amountToneClassName(day.total))}>
          <Money amount={day.total} showPlus currency={null} />
        </span>
        {/* Income minus these game-club expenses is the day total; bar-paid
            expenses come out of bar cash, so they are listed separately.
            Each figure opens its entries, where some can be left out. */}
        <span className="flex flex-1 flex-wrap items-center gap-x-0.5 font-normal">
          {dayFigureButton(day.date, 'income', <>{t('income')} <Money amount={day.income} currency={null} className="text-gray-900" /></>)}
          {dayFigureButton(day.date, 'expenses', <>{t('expenses')} <Money amount={day.gameClubExpenses} currency={null} className="text-gray-900" /></>)}
          {day.barExpenses > 0 && dayFigureButton(day.date, 'barExpenses', <>{t('bar')} · {t('expenses')} <Money amount={day.barExpenses} currency={null} className="text-gray-900" /></>)}
          {paymentCards.filter((card) => left[card.method] !== 0).map(({ method, icon: Icon, label }) => (
            dayFigureButton(day.date, method, (
              <>
                <Icon size={13} className="shrink-0 text-gray-500" aria-hidden="true" />
                <span className="sr-only">{t('left')} · </span>{label}
                <Money amount={left[method]} currency={null} className={amountToneClassName(left[method])} />
              </>
            ))
          ))}
        </span>
        {showActions && <span className="ml-auto shrink-0">{collectionCell(day.date)}</span>}
      </div>
    );
  }

  const closeoutColumns: DataTableColumn<CloseoutRow>[] = [
    {
      key: 'date',
      header: t('dateAndTime'),
      className: 'w-52 whitespace-nowrap',
      render: (row) => (
        <span className="flex items-center gap-2.5">
          <CategoryIcon
            size="sm"
            category={row.activity.category}
            kind={row.activity.kind === 'debt_payment' ? 'debtPayment' : row.activity.kind}
            tone={row.activity.kind === 'expense' && row.activity.paymentSource === 'bar' ? 'bar' : undefined}
          />
          <span className="block min-w-0 leading-tight">
            <span className="block text-gray-700">{formatTime(row.activity.createdAt, locale)}</span>
            <span className="block max-w-36 truncate text-xs text-gray-500" title={row.activity.createdByName || t('unknownCreator')}>
              {row.activity.createdByName || t('unknownCreator')}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: 'type',
      header: t('type'),
      className: 'w-28',
      render: (row) => <Badge size="sm" variant={activityKindVariant(row.activity.kind)}>{activityTypeLabel(row.activity)}</Badge>,
    },
    {
      key: 'category',
      header: t('category'),
      className: 'w-44',
      render: (row) => <Badge size="sm" variant="neutral">{categoryLabel(row.activity)}</Badge>,
    },
    {
      key: 'amount',
      header: t('amount'),
      align: 'right',
      className: 'w-40 whitespace-nowrap',
      render: (row) => (row.activity.exchange ? (
        <span className="font-semibold text-gray-700">
          {exchangeAmountLabel(row.activity.exchange.from, row.activity.exchange.fromAmount)}
          {' → '}
          {exchangeAmountLabel(row.activity.exchange.to, row.activity.exchange.toAmount)}
        </span>
      ) : (
        <span className={cn('font-semibold', amountToneClassName(row.activity.amount))}>
          <Money amount={row.activity.amount} showPlus currency={null} />
        </span>
      )),
    },
    {
      key: 'payment',
      header: <span className="whitespace-nowrap">{t('paymentMethod')}</span>,
      className: 'w-48',
      render: (row) => {
        if (row.activity.exchange) return null;
        const { paymentBreakdown, paymentMethod } = row.activity;
        if (paymentBreakdown) {
          const used = (Object.keys(paymentBreakdown) as Array<keyof typeof paymentBreakdown>)
            .filter((method) => paymentBreakdown[method] !== 0);
          return used.length ? <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">{used.map(paymentMethodChip)}</span> : null;
        }
        return paymentMethod
          ? <span className="text-xs">{paymentMethodChip(paymentMethod)}</span>
          : <span className="text-gray-500">—</span>;
      },
    },
    {
      key: 'description',
      header: t('descriptionLabel'),
      className: 'min-w-48',
      mobile: 'full',
      render: (row) => (
        <span className="line-clamp-2 max-w-md break-words text-gray-600" title={row.activity.comment || undefined}>
          {row.activity.comment || <span className="text-gray-400">—</span>}
        </span>
      ),
    },
    ...(showActions ? [{
      key: 'actions',
      header: <span className="sr-only">{t('actions')}</span>,
      align: 'right' as const,
      className: 'w-14',
      render: (row: CloseoutRow) => {
        if (collectionsByDate.has(row.date)) {
          return (
            <span className="inline-flex h-8 w-8 items-center justify-center text-danger-400" title={t('dayClosedHint')}>
              <Lock size={14} aria-label={t('dayClosedHint')} />
            </span>
          );
        }
        if (!isOwner) return null;
        const deleteKey = row.activity.id ? `${row.activity.source}:${row.activity.id}` : null;
        const canDelete = row.activity.source !== 'debt_payment' && row.activity.category !== 'shortage' && Boolean(row.activity.id);
        if (!canDelete) return null;
        return (
          <IconButton
            variant="danger"
            size="sm"
            label={`${tc('delete')}: ${categoryLabel(row.activity)} · ${row.activity.exchange
              ? exchangeAmountLabel(row.activity.exchange.from, row.activity.exchange.fromAmount)
              : `${formatCurrency(Math.abs(row.activity.amount))} ${tc('currency')}`}`}
            icon={<Trash2 size={15} aria-hidden="true" />}
            loading={deletingKey === deleteKey}
            disabled={deletingKey !== null && deletingKey !== deleteKey}
            onClick={(event) => {
              event.stopPropagation();
              void handleDeleteActivity(row.activity, row.date);
            }}
          />
        );
      },
    }] : []),
  ];

  // Where the money is right now: on the closeout under the period totals, on Collected above its own.
  const whereabouts = (
    <MoneyWhereabouts
      loading={loading}
      title={t('collectMoney.whereTitle')}
      kassa={kassaTotal}
      collected={collectedSummary.held.total}
      reserve={reportRows.reserveSums}
      kassaLabel={t('collectMoney.inKassaCard')}
      kassaHelper={t('collectMoney.inKassaCardHelper')}
      collectedLabel={t('collectMoney.collectedCard')}
      collectedHelper={t('collectMoney.collectedCardHelper')}
      reserveLabel={t('collectMoney.reserveCard')}
      reserveHelper={t('collectMoney.reserveCardHelper')}
      onCollectedClick={() => setView('collected')}
      onKassaClick={showPendingDays}
      kassaSelected={view === 'closeout' && collectionFilter === 'pending'}
      reserveDepositLabel={tor('depositForm.button')}
      onReserveDeposit={isOwner ? () => setReserveDeposit({}) : undefined}
    />
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        tabs={hasReportsAccess ? <ReportsTabs value={view} onSelectView={setView} /> : undefined}
        action={hasReportsAccess || canRegisterExpenses ? (
          <>
            {/* Without Reports access the expense form is inline, below. */}
            {hasReportsAccess && canRegisterExpenses && (
              <Button variant="outline" onClick={() => setExpenseDialogOpen(true)} icon={<ReceiptText size={18} aria-hidden="true" />}>
                {t('registerExpense')}
              </Button>
            )}
            {hasReportsAccess && (canCollect || isOwner) && (
              <Button onClick={() => setCollectDialogOpen(true)} icon={<HandCoins size={18} aria-hidden="true" />}>
                {t('collectMoney.button')}
              </Button>
            )}
            {canRegisterExpenses && (
              <Button variant="outline" onClick={() => setExchangeDialogOpen(true)} icon={<ArrowRightLeft size={18} aria-hidden="true" />}>
                {t('exchangeMoney')}
              </Button>
            )}
            {hasReportsAccess && (
              <DateRangePicker
                from={range.from}
                to={range.to}
                fromLabel={t('from')}
                toLabel={t('to')}
                className="sm:w-80"
                onChange={setRange}
              />
            )}
          </>
        ) : undefined}
      />

      {!hasReportsAccess && canRegisterExpenses && (
        <Card as="section">
          <SectionHeading title={t('registerExpense')} className="mb-4" />
          <ExpenseRegistrationForm onSaved={() => showToast(t('expenseRegistered'))} />
        </Card>
      )}
      {!hasReportsAccess && !canRegisterExpenses && <InlineAlert variant="info">{tc('accessDeniedDescription')}</InlineAlert>}
      {hasReportsAccess && loadFailed && view !== 'writeOffs' && (
        <LoadErrorAlert retrying={loading} onRetry={() => void reloadReport()}>
          {t('loadError')}
        </LoadErrorAlert>
      )}
      {/* While the entry sheet is open it shows the error itself. */}
      {actionError && !selectedEntry && <InlineAlert variant="danger">{actionError}</InlineAlert>}
      {hasReportsAccess && view === 'closeout' && sourceFilter && (
        <InlineAlert
          variant="info"
          action={<Button variant="outline" size="sm" onClick={() => setSourceFilter(null)}>{t('showAllSources')}</Button>}
        >
          {t(sourceFilter === 'bar' ? 'sourceFilterBar' : 'sourceFilterGameClub')}
        </InlineAlert>
      )}

      {/* After a failed load the figures are unknown, not zero: show only the error. */}
      {hasReportsAccess && isOwner && view === 'writeOffs' && (
        <WriteOffsTab clubId={selectedClubId} from={range.from} to={range.to} />
      )}
      {hasReportsAccess && !loadFailed && view === 'collected' && whereabouts}
      {hasReportsAccess && !loadFailed && view === 'collected' && (
        <CollectedTab
          summary={collectedSummary}
          moves={reportRows.collectedMoves}
          collectorNames={reportRows.collectorNames}
          enabledPaymentMethods={enabledPaymentMethods}
          loading={loading}
          isOwner={isOwner}
          businessToday={businessToday}
          onUndo={(group) => void handleUndoCollection(group)}
          onMoveToReserve={handleMoveCollectedToReserve}
        />
      )}
      {hasReportsAccess && !loadFailed && view === 'closeout' && (
        <>
          <section className={cn(metricGridClassName, 'sm:grid-cols-2 xl:grid-cols-4')}>
            <SummaryCard loading={loading} onClick={() => showCloseout('money_in', null)} label={t('totalCollected')} value={report.totalCollected} icon={WalletCards} tone="success" />
            <SummaryCard loading={loading} onClick={() => showCloseout('expense', 'game_club')} label={t('gameClubExpenses')} value={report.gameClubExpenses} icon={ReceiptText} tone="danger" />
            <SummaryCard loading={loading} href={moneyDetailsHref('game_club', range)} label={t('gameClubLeft')} value={report.gameClubLeft} icon={CircleDollarSign} tone={toneForAmount(report.gameClubLeft, 'default')} />
            <SummaryCard loading={loading} href={moneyDetailsHref('bar', range)} label={t('barCashLeft')} value={report.barLeft} icon={Banknote} tone={toneForAmount(report.barLeft, 'default')} />
          </section>

          {whereabouts}

          <PaymentMethodTiles
            loading={loading}
            skeletonCount={enabledPaymentMethods.length + 1}
            title={t('moneyLeftByPaymentMethod')}
            description={t('moneyLeftDescription')}
            methods={shownPaymentCards}
            data={paymentCardData}
            usd={report.usd}
            usdLabel={t('usd')}
            usdNote={t('usdHeld')}
            onSelectMethod={setMethodDays}
            onSelectUsd={() => showCloseout('exchange', null)}
          />

          {(loading || dailyFlow.length > 1 || spendingSlices.length > 0) && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
              {(loading || dailyFlow.length > 1) && (
                <ChartCard title={t('dailyChartTitle')} description={t('dailyChartDesc')}>
                  <div className="mt-4">
                    {loading ? <InOutChartSkeleton /> : (
                      <DailyInOutChart
                        data={dailyFlow}
                        incomeLabel={t('dailyChartIncome')}
                        expensesLabel={t('gameClubExpenses')}
                        legendLabel={t('dailyChartTitle')}
                        incomeColor="rgb(var(--c-primary-600))"
                        currency={tc('currency')}
                        locale={locale}
                      />
                    )}
                  </div>
                </ChartCard>
              )}
              {(loading || spendingSlices.length > 0) && (
                <ChartCard title={tg('reports.spendingTitle')} description={tg('reports.spendingDescription')}>
                  <div className="mt-4">
                    {loading ? <DonutSkeleton /> : (
                      <DonutBreakdown
                        size="sm"
                        slices={spendingSlices}
                        total={spendingSlices.reduce((sum, slice) => sum + slice.value, 0)}
                        totalLabel={t('gameClubExpenses')}
                        currency={tc('currency')}
                        locale={locale}
                      />
                    )}
                  </div>
                </ChartCard>
              )}
            </div>
          )}

          <Card as="section" padding="none" className="scroll-mt-20 overflow-hidden" id="report-closeout">
            <CardHeader>
              <SectionHeading
                title={t('dailyCloseout')}
                description={t('dailyCloseoutDescription')}
                action={(
                  <ExportButton size="sm" build={exportCloseout} disabled={loading || closeoutRows.length === 0} />
                )}
              />
              <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
                <SearchInput
                  controlSize="sm"
                  value={search}
                  onChange={setSearch}
                  placeholder={t('searchEntries')}
                  className="lg:w-72"
                />
                <Select
                  controlSize="sm"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value as MoneyReportCategoryFilter)}
                  aria-label={t('filterByCategory')}
                  className="lg:w-52"
                >
                  <option value="all">{t('allCategories')}</option>
                  <optgroup label={t('incomeCategories')}>
                    <option value="money_in">{t('allIncome')}</option>
                    <option value="income">{t('dailyClubIncome')}</option>
                    <option value="debt_payment">{t('debtPayment')}</option>
                  </optgroup>
                  <option value="exchange">{t('exchanges')}</option>
                  <optgroup label={t('expenseCategories')}>
                    <option value="expense">{t('allExpenses')}</option>
                    {EXPENSE_CATEGORIES.map((category) => (
                      <option key={category} value={`expense:${category}`}>
                        {te(category)}
                      </option>
                    ))}
                  </optgroup>
                </Select>
                <SegmentedControl
                  variant="chips"
                  size="sm"
                  label={t('collectionFilter')}
                  value={collectionFilter}
                  onChange={setCollectionFilter}
                  className="lg:ml-auto"
                  options={[
                    { value: 'all', label: t('collectionFilterAll', { count: filteredReport.days.length }) },
                    { value: 'pending', label: t('collectionFilterPending', { count: filteredReport.days.length - collectedDayCount }) },
                    { value: 'collected', label: t('collectionFilterCollected', { count: collectedDayCount }) },
                  ]}
                />
              </div>
            </CardHeader>
            {loading ? (
              <TableSkeleton bare rows={8} columns={showActions ? 7 : 6} />
            ) : (
              <DataTable
                mobileCards
                bare
                dense
                label={t('dailyCloseout')}
                minWidth={showActions ? 980 : 920}
                columns={closeoutColumns}
                data={closeoutRows}
                groups={closeoutDays.map(({ day, rows }) => ({
                  key: day.date,
                  header: dayHeader(day),
                  rows,
                  className: collectionsByDate.has(day.date) ? CLOSED_DAY_HEADER : undefined,
                }))}
                keyExtractor={(row) => row.key}
                emptyState={<EmptyState compact title={searchQuery ? t('noSearchMatches') : t('noData')} />}
                rowClassName={(row) => (collectionsByDate.has(row.date)
                  // A collected day is closed: its header and entries read as one red block.
                  ? cn(CLOSED_DAY_ROW, 'bg-danger-50 hover:bg-danger-100/50')
                  : undefined)}
                onRowClick={(row) => setSelectedEntry({ activity: row.activity, date: row.date })}
              />
            )}
          </Card>
        </>
      )}

      <DayBreakdownModal
        day={dayBreakdown
          ? filteredReport.days.find((day) => day.date === dayBreakdown.date) ?? report.days.find((day) => day.date === dayBreakdown.date) ?? null
          : null}
        figure={dayBreakdown?.figure ?? 'income'}
        rows={reportRows}
        figureLabels={dayFigureLabels}
        activityTypeLabel={activityTypeLabel}
        categoryLabel={categoryLabel}
        onClose={() => setDayBreakdown(null)}
      />

      <MethodDaysModal
        method={dayBreakdown ? null : methodDays}
        label={paymentCards.find((card) => card.method === methodDays)?.label ?? ''}
        days={report.days}
        data={methodDays ? paymentCardData[methodDays] : null}
        taken={methodDays ? collectedByMethod[methodDays] : 0}
        onSelectDay={(date) => methodDays && setDayBreakdown({ date, figure: methodDays })}
        onClose={() => setMethodDays(null)}
      />

      {hasReportsAccess && (canCollect || isOwner) && (
        <CollectMoneyModal
          open={collectDialogOpen}
          onClose={() => setCollectDialogOpen(false)}
          onSaved={async () => {
            setCollectDialogOpen(false);
            showToast(t('collectMoney.saved'));
            await reloadReport({ silent: true });
          }}
        />
      )}

      {hasReportsAccess && isOwner && (
        <ReserveDepositModal
          open={reserveDeposit !== null}
          initialDate={reserveDeposit?.date}
          initialAmounts={reserveDeposit?.amounts}
          onClose={() => setReserveDeposit(null)}
          onSaved={async () => {
            setReserveDeposit(null);
            showToast(tor('depositedToast'));
            await reloadReport({ silent: true });
          }}
          // Some methods stored and another refused: the form stays open, the figures catch up.
          onChanged={() => void reloadReport({ silent: true })}
        />
      )}

      {hasReportsAccess && canRegisterExpenses && (
        <ExpenseModal
          open={expenseDialogOpen}
          onClose={() => setExpenseDialogOpen(false)}
          onSaved={async () => {
            setExpenseDialogOpen(false);
            showToast(t('expenseRegistered'));
            await reloadReport({ silent: true });
          }}
        />
      )}

      {canRegisterExpenses && (
        <ExchangeModal
          open={exchangeDialogOpen}
          onClose={() => setExchangeDialogOpen(false)}
          onSaved={async () => {
            setExchangeDialogOpen(false);
            showToast(t('exchangeSaved'));
            await reloadReport({ silent: true });
          }}
        />
      )}

      <EntryDetailsSheet
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
        error={actionError}
        closedBy={selectedEntry && collectionsByDate.has(selectedEntry.date)
          ? collectionsByDate.get(selectedEntry.date)?.collector_name || t('unknownCreator')
          : null}
        canCorrectExpense={Boolean(selectedEntry && canCorrectExpense(selectedEntry.activity, selectedEntry.date))}
        canCorrectPaymentMethod={Boolean(selectedEntry && canCorrectPaymentMethod(selectedEntry.activity, selectedEntry.date))}
        saving={methodSaving}
        businessToday={businessToday}
        categoryOptions={selectedEntry ? categoryOptions(selectedEntry.activity) : []}
        paymentMethodOptions={selectedEntry ? paymentMethodOptions(selectedEntry.activity) : []}
        activityTypeLabel={activityTypeLabel}
        categoryLabel={categoryLabel}
        expenseCategoryLabel={expenseCategoryLabel}
        paymentLabel={paymentLabel}
        exchangeAmountLabel={exchangeAmountLabel}
        onCorrect={(change) => selectedEntry && void handleUpdateExpense(selectedEntry.activity, change)}
        canMoveToReserve={isOwner}
        reservedThatDay={selectedEntry ? reservedFromGameClubOn(reportRows.reserveMoves, selectedEntry.date, reportRows.collectedMoves) : 0}
        onMoveToReserve={(amounts) => {
          if (!isOwner || !selectedEntry) return;
          // The deposit form takes over from the sheet: same day, the entry's amounts as the start.
          const { date } = selectedEntry;
          setSelectedEntry(null);
          setReserveDeposit({ date, amounts });
        }}
      />

      {toastElement}
      {confirmDialog}
    </div>
  );
}
