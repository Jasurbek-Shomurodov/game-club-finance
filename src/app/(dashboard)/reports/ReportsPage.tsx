'use client';

// Route: /reports

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRightLeft,
  Banknote,
  Check,
  CircleCheck,
  CircleDollarSign,
  CreditCard,
  Gamepad2,
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
  DataTable,
  DateRangePicker,
  EmptyState,
  IconButton,
  InlineAlert,
  LoadErrorAlert,
  MetricCard,
  MetricGridSkeleton,
  Modal,
  Money,
  PageHeader,
  SectionHeading,
  Select,
  SegmentedControl,
  DatePicker,
  TableSkeleton,
  toneForAmount,
  useConfirm,
  useToast,
  type BadgeVariant,
  type DataTableColumn,
  type MetricTone,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import {
  buildFilteredMoneyReport,
  expensesFromSource,
  type MoneyReportActivity,
  type MoneyReportCategoryFilter,
  type MoneyReportCashRow,
  type MoneyReportBarSalesRow,
  type MoneyReportDebtPaymentRow,
  type MoneyReportPaymentBreakdown,
} from '@/lib/calculations/moneyReport';
import type { StockPurchaseCostRow } from '@/lib/calculations/barMoney';
import {
  getDashboardRange,
  type ExpenseRow,
} from '@/lib/calculations/dashboardMetrics';
import { formatCurrency, formatDateOnly, formatTime, formatUnitCurrency } from '@/lib/formatters';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { createClient, mutateFinanceRequest } from '@/lib/supabase/client';
import { requestDailyCashDeletion } from '@/lib/dailyCashApi';
import { isMissingDatabaseFunction } from '@/lib/supabase/errors';
import { cn } from '@/lib/utils';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessPeriod } from '@/lib/useBusinessPeriod';
import { useClubQuery } from '@/lib/useClubQuery';
import { canAccessFeature } from '@/lib/permissions';
import ExpenseRegistrationForm from './ExpenseRegistrationForm';
import ExchangeForm from './ExchangeForm';
import CollectedTab from './CollectedTab';
import { fetchMoneyExchanges } from '@/lib/supabase/moneyExchanges';
import { requestCollectionChange } from '@/lib/collectionsApi';
import { fetchDailyCashCollections, type DailyCashCollection } from '@/lib/supabase/dailyCashCollections';
import type { ExchangeMethod, MoneyExchangeRow } from '@/lib/calculations/moneyExchanges';
import { EXPENSE_CATEGORIES, isKnownExpenseCategory } from '@/lib/expenseCategories';

const emptyReportRows = {
  cash: [] as MoneyReportCashRow[],
  expenses: [] as ExpenseRow[],
  debtPayments: [] as MoneyReportDebtPaymentRow[],
  barSales: [] as MoneyReportBarSalesRow[],
  stockPurchases: [] as StockPurchaseCostRow[],
  exchanges: [] as MoneyExchangeRow[],
  collections: [] as DailyCashCollection[],
};

type ReportRange = { from: string; to: string };

function sameRange(a: ReportRange, b: ReportRange): boolean {
  return a.from === b.from && a.to === b.to;
}

interface ReportProfileRow {
  id: string;
  full_name: string;
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

function activityKindVariant(kind: MoneyReportActivity['kind']): BadgeVariant {
  if (kind === 'income') return 'success';
  if (kind === 'debt_payment' || kind === 'exchange') return 'info';
  return 'danger';
}

/** The closeout table lists a subtle day header row followed by that day's entries. */
type CloseoutRow =
  | {
    kind: 'day';
    key: string;
    date: string;
    income: number;
    gameClubExpenses: number;
    barExpenses: number;
    total: number;
    /** Game-club money left on the day in each payment method. */
    left: Record<'cash' | 'terminal' | 'card' | 'playstation', number>;
    count: number;
  }
  | { kind: 'activity'; key: string; date: string; activity: MoneyReportActivity };

function SummaryCard({
  label,
  value,
  icon,
  tone,
  loading = false,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: MetricTone;
  loading?: boolean;
}) {
  return (
    <MetricCard
      label={label}
      value={<Money amount={value} currencyClassName="text-sm font-medium tracking-normal text-gray-500" />}
      tone={tone}
      icon={icon}
      loading={loading}
    />
  );
}

function PaymentCard({
  label,
  data,
  icon: Icon,
  collectedLabel,
  expensesLabel,
  exchangedLabel,
  leftLabel,
}: {
  label: string;
  data: MoneyReportPaymentBreakdown;
  icon: LucideIcon;
  collectedLabel: string;
  expensesLabel: string;
  exchangedLabel: string;
  leftLabel: string;
}) {
  return (
    <Card as="article">
      <div className="flex items-center gap-2">
        <Icon size={15} className="shrink-0 text-gray-400" aria-hidden="true" />
        <h3 className="text-[13px] font-medium text-gray-500">{label}</h3>
      </div>
      <p className={cn('mt-2.5 break-words text-[1.375rem] font-bold leading-none tracking-tight tabular-nums sm:text-2xl', amountToneClassName(data.left))}>
        <Money amount={data.left} currencyClassName="text-sm font-medium tracking-normal text-gray-500" />
      </p>
      <p className="mt-1 text-xs text-gray-500">{leftLabel}</p>
      <dl className="mt-4 space-y-2 border-t border-gray-100 pt-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-gray-500">{collectedLabel}</dt>
          <dd className="shrink-0 font-semibold tabular-nums text-gray-900">
            <Money amount={data.collected} currency={null} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-gray-500">{expensesLabel}</dt>
          <dd className="shrink-0 font-semibold tabular-nums text-danger-600">
            <Money amount={data.expenses} currency={null} />
          </dd>
        </div>
        {data.exchanged !== 0 && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-gray-500">{exchangedLabel}</dt>
            <dd className={cn('shrink-0 font-semibold tabular-nums', amountToneClassName(data.exchanged))}>
              <Money amount={data.exchanged} showPlus currency={null} />
            </dd>
          </div>
        )}
      </dl>
    </Card>
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
  if (category === 'income' || category === 'debt_payment' || category === 'expense' || category === 'exchange') return category;
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

type ReportsView = 'closeout' | 'collected';

/** A red edge down the left of every row of a closed (collected) day. */
const CLOSED_DAY_ROW = '[&>td:first-child]:shadow-[inset_4px_0_0_rgb(var(--c-danger-500))]';

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
  const { locale } = useAppLocale();
  const { selectedClubId, businessDayStartHour, role, featureAccess, enabledPaymentMethods } = useClub();
  const hasReportsAccess = canAccessFeature(role, featureAccess, 'reports');
  // Members with only the expenses feature land here to register expenses.
  const canRegisterExpenses = canAccessFeature(role, featureAccess, 'expenses');
  // Collectors tick a date once they have the money; only an owner can undo it.
  const canCollect = canAccessFeature(role, featureAccess, 'collection');
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
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
  const [view, setView] = useState<ReportsView>(requestedView === 'collected' ? 'collected' : 'closeout');
  // Keep the tab shareable without dropping the rest of the link.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (view === 'collected') params.set('view', 'collected');
    else params.delete('view');
    const query = params.toString();
    if (query !== window.location.search.replace(/^\?/, '')) {
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }
  }, [view]);
  const [sourceFilter, setSourceFilter] = useState<ExpenseSourceFilter>(() => requestedSourceFilter(requestedSource));
  useEffect(() => {
    setSourceFilter(requestedSourceFilter(requestedSource));
  }, [requestedSource]);
  /** Translated result of a failed delete. */
  const [actionError, setActionError] = useState('');
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<{ activity: MoneyReportActivity; date: string } | null>(null);
  const currentClubId = useRef(selectedClubId);
  const deletePending = useRef(false);
  const [methodSaving, setMethodSaving] = useState(false);
  const [collectingDate, setCollectingDate] = useState<string | null>(null);
  const isOwner = role === 'owner';
  const loadReport = useCallback(async (isCurrent: () => boolean): Promise<typeof emptyReportRows> => {
    if (!selectedClubId || !hasReportsAccess) return emptyReportRows;

    const supabase = createClient();
    const [snapshotResult, exchangeRows, collections] = await Promise.all([
      supabase.rpc('get_money_report_snapshot', {
        p_club_id: selectedClubId,
        p_range_from: range.from,
        p_range_to: range.to,
      }),
      // Exchanges (092) are read beside the snapshot, which predates them.
      fetchMoneyExchanges(supabase, selectedClubId, range.from, range.to),
      fetchDailyCashCollections(supabase, selectedClubId, range.from, range.to),
    ]);

    if (!snapshotResult.error) {
      const snapshot = snapshotResult.data as MoneyReportSnapshotPayload;
      return {
        cash: snapshot.cash ?? [],
        expenses: snapshot.expenses ?? [],
        debtPayments: snapshot.debtPayments ?? [],
        barSales: snapshot.barSales ?? [],
        stockPurchases: snapshot.stockPurchases ?? [],
        exchanges: await withExchangeCreators(exchangeRows),
        collections,
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
    const expenseRows = (expenseResult.data ?? []) as ExpenseRow[];
    const creatorIds = Array.from(new Set([
      ...cashRows.map((row) => row.created_by),
      ...expenseRows.map((row) => row.created_by),
      ...exchangeRows.map((row) => row.created_by),
    ].filter((creatorId): creatorId is string => Boolean(creatorId))));
    // A superseded load skips the creator lookup.
    if (!isCurrent()) return emptyReportRows;
    const profileResult = creatorIds.length > 0
      ? await supabase.from('profiles').select('id,full_name').in('id', creatorIds)
      : { data: [] as ReportProfileRow[], error: null };

    if (profileResult.error) throw profileResult.error;

    const creatorNames = new Map(
      ((profileResult.data ?? []) as ReportProfileRow[]).map((profile) => [profile.id, profile.full_name]),
    );

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
      collections,
    };

    /** The snapshot names its own rows' creators; exchanges need the same lookup. */
    async function withExchangeCreators(rows: MoneyExchangeRow[]): Promise<MoneyExchangeRow[]> {
      const ids = Array.from(new Set(rows.map((row) => row.created_by).filter((id): id is string => Boolean(id))));
      if (ids.length === 0) return rows;
      const { data, error } = await supabase.from('profiles').select('id,full_name').in('id', ids);
      if (error) throw error;
      const names = new Map(((data ?? []) as ReportProfileRow[]).map((profile) => [profile.id, profile.full_name]));
      return rows.map((row) => ({ ...row, creator_name: row.created_by ? names.get(row.created_by) ?? null : null }));
    }
  }, [hasReportsAccess, range.from, range.to, selectedClubId]);
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
  )), [categoryFilter, report, reportRows, sourceFilter]);

  // Dialogs belong to the club they were opened for: close them on a club switch.
  useEffect(() => {
    currentClubId.current = selectedClubId;
    setSelectedEntry(null);
    setExpenseDialogOpen(false);
    setExchangeDialogOpen(false);
    setActionError('');
  }, [selectedClubId]);

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
          deleteError = response.status === 401 || response.status === 403
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
            : result?.code === 'DAY_COLLECTED'
              ? tc('dayClosed')
              : response.status === 401 || response.status === 403
              ? tc('accessDeniedDescription')
              : t('deleteError');
        }
      } else {
        const status = await requestDailyCashDeletion(clubId, activity.id);
        if (status !== 200) {
          deleteError = status === 401 || status === 403 ? tc('accessDeniedDescription') : t('deleteError');
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

  /** Owners correct an ordinary expense's payment method or date; the club group message is edited server-side. */
  async function handleUpdateExpense(activity: MoneyReportActivity, change: { paymentMethod: string } | { date: string }) {
    if (!isOwner || !selectedClubId || !activity.id || activity.source !== 'expense' || methodSaving) return;
    if ('paymentMethod' in change && change.paymentMethod === activity.paymentMethod) return;
    if ('date' in change && change.date === selectedEntry?.date) return;
    const errorText = 'date' in change ? t('dateUpdateError') : t('paymentMethodUpdateError');
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
            : response.status === 401 || response.status === 403
            ? tc('accessDeniedDescription')
            : errorText);
        return;
      }
      setSelectedEntry((current) => (current?.activity.id === activity.id
        ? 'date' in change
          ? { ...current, date: change.date }
          : { ...current, activity: { ...current.activity, paymentMethod: change.paymentMethod } }
        : current));
      showToast('date' in change ? t('dateUpdated') : t('paymentMethodUpdated'));
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
          variant="ghost"
          size="sm"
          label={`${label} · ${t('collectionUndo')}: ${dateLabel}`}
          icon={<CircleCheck size={18} aria-hidden="true" />}
          className="text-success-600 hover:bg-success-50 hover:text-success-700"
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

  function canCorrectExpense(activity: MoneyReportActivity, date: string): boolean {
    // Payroll payments take their method and date from the salary entry; a collected day is closed.
    return isOwner && activity.source === 'expense' && Boolean(activity.id) && activity.category !== 'salary'
      && !collectionsByDate.has(date);
  }

  /** Enabled methods, plus the current one so a since-disabled method still displays. */
  function paymentMethodOptions(current: string | null): string[] {
    const methods: string[] = [...enabledPaymentMethods];
    return current && !methods.includes(current) ? [current, ...methods] : methods;
  }

  function exchangeMethodLabel(method: ExchangeMethod): string {
    return method === 'usd' ? t('usd') : tc(`paymentMethods.${method}`);
  }

  /** "500 000 UZS" or "$40"; dollars keep cents. */
  function exchangeAmountLabel(method: ExchangeMethod, amount: number): string {
    return method === 'usd' ? `$${formatUnitCurrency(amount)}` : `${formatCurrency(amount)} ${tc('currency')}`;
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
  const closeoutRows = useMemo<CloseoutRow[]>(() => filteredReport.days.filter((day) => (
    collectionFilter === 'all' || collectionsByDate.has(day.date) === (collectionFilter === 'collected')
  )).flatMap((day) => [
    {
      kind: 'day' as const,
      key: `day:${day.date}`,
      date: day.date,
      income: day.income,
      gameClubExpenses: day.gameClubExpenses,
      barExpenses: day.barExpenses,
      total: day.total,
      left: { cash: day.cash, terminal: day.terminal, card: day.card, playstation: day.playstation },
      count: day.activities.length,
    },
    ...day.activities.map((activity, index) => ({
      kind: 'activity' as const,
      key: activity.id ? `${activity.source}:${activity.id}` : `${day.date}-${activity.source}-${index}`,
      date: day.date,
      activity,
    })),
  ]), [collectionFilter, collectionsByDate, filteredReport.days]);

  // Owners delete entries and undo ticks; collectors tick dates.
  const showActions = isOwner || canCollect;
  const closeoutColumns: DataTableColumn<CloseoutRow>[] = [
    {
      key: 'date',
      header: t('dateAndTime'),
      className: 'w-44 whitespace-nowrap',
      render: (row) => (row.kind === 'day' ? (
        <span className="block">
          <span className="flex items-center gap-2">
            <span className={cn('font-semibold', collectionsByDate.has(row.date) ? 'text-danger-700' : 'text-gray-900')}>
              {formatDateOnly(row.date, locale)}
            </span>
            <Badge variant="outline" size="sm">{row.count}</Badge>
          </span>
          {collectionsByDate.has(row.date) && (
            <Badge variant="danger" size="sm" icon={<Lock size={11} aria-hidden="true" />} className="mt-1.5">{t('dayClosed')}</Badge>
          )}
        </span>
      ) : (
        <span className="block">
          <span className="block text-gray-700">{formatTime(row.activity.createdAt, locale)}</span>
          <span className="mt-0.5 block max-w-40 truncate text-xs text-gray-500" title={row.activity.createdByName || t('unknownCreator')}>
            {row.activity.createdByName || t('unknownCreator')}
          </span>
        </span>
      )),
    },
    {
      key: 'type',
      header: t('type'),
      className: 'w-32',
      render: (row) => (row.kind === 'activity'
        ? <Badge variant={activityKindVariant(row.activity.kind)}>{activityTypeLabel(row.activity)}</Badge>
        : null),
    },
    {
      key: 'category',
      header: t('category'),
      className: 'w-48',
      render: (row) => (row.kind === 'activity'
        ? <Badge variant="neutral">{categoryLabel(row.activity)}</Badge>
        : null),
    },
    {
      key: 'amount',
      header: t('amount'),
      align: 'right',
      className: 'w-44 whitespace-nowrap',
      render: (row) => (row.kind === 'day' ? (
        <span className={cn('font-semibold', amountToneClassName(row.total))}>
          <Money amount={row.total} showPlus currency={null} />
        </span>
      ) : row.activity.exchange ? (
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
      className: 'w-36',
      render: (row) => {
        if (row.kind !== 'activity' || row.activity.exchange) return null;
        const { paymentBreakdown, paymentMethod } = row.activity;
        if (paymentBreakdown) {
          const used = (Object.keys(paymentBreakdown) as Array<keyof typeof paymentBreakdown>)
            .filter((method) => paymentBreakdown[method] !== 0);
          return used.length ? <span className="flex flex-col gap-1 text-xs">{used.map(paymentMethodChip)}</span> : null;
        }
        return paymentMethod
          ? <span className="text-xs">{paymentMethodChip(paymentMethod)}</span>
          : <span className="text-gray-400">—</span>;
      },
    },
    {
      key: 'description',
      header: t('descriptionLabel'),
      className: 'min-w-[240px]',
      render: (row) => (row.kind === 'day' ? (
        <span className="block text-xs text-gray-500">
          {/* Income minus these game-club expenses is the day total; bar-paid
              expenses come out of bar cash, so they are listed separately. */}
          {t('income')}: <Money amount={row.income} currency={null} className="text-gray-700" />
          {' · '}
          {t('expenses')}: <Money amount={row.gameClubExpenses} currency={null} className="text-gray-700" />
          {row.barExpenses > 0 && (
            <>
              {' · '}
              {t('bar')} · {t('expenses')}: <Money amount={row.barExpenses} currency={null} className="text-gray-700" />
            </>
          )}
          {paymentCards.some((card) => row.left[card.method] !== 0) && (
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{t('left')}:</span>
              {paymentCards.filter((card) => row.left[card.method] !== 0).map(({ method, icon: Icon, label }) => (
                <span key={method} className="inline-flex items-center gap-1 whitespace-nowrap" title={label}>
                  <Icon size={13} className="shrink-0 text-gray-400" aria-hidden="true" />
                  {label}
                  <Money amount={row.left[method]} currency={null} className={cn('font-medium', amountToneClassName(row.left[method]))} />
                </span>
              ))}
            </span>
          )}
        </span>
      ) : (
        <span className="block max-w-[320px] break-words text-gray-600">{row.activity.comment || t('noDescription')}</span>
      )),
    },
    ...(showActions ? [{
      key: 'actions',
      header: <span className="sr-only">{t('actions')}</span>,
      align: 'right' as const,
      className: 'w-16',
      render: (row: CloseoutRow) => {
        if (row.kind === 'day') return collectionCell(row.date);
        if (collectionsByDate.has(row.date)) {
          return (
            <span className="inline-flex h-8 w-8 items-center justify-center text-danger-400" title={t('dayClosedHint')}>
              <Lock size={14} aria-label={t('dayClosedHint')} />
            </span>
          );
        }
        if (!isOwner) return null;
        const deleteKey = row.activity.id ? `${row.activity.source}:${row.activity.id}` : null;
        const canDelete = row.activity.source !== 'debt_payment' && Boolean(row.activity.id);
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

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('title')}
        tabs={hasReportsAccess ? (
          <SegmentedControl
            variant="tabs"
            label={t('viewSwitcher')}
            options={[
              { value: 'closeout', label: t('title') },
              { value: 'collected', label: t('collectedTab') },
            ]}
            value={view}
            onChange={setView}
          />
        ) : undefined}
        action={hasReportsAccess ? (
          <>
            {canRegisterExpenses && (
              <Button variant="outline" onClick={() => setExpenseDialogOpen(true)} icon={<ReceiptText size={18} aria-hidden="true" />}>
                {t('registerExpense')}
              </Button>
            )}
            {canRegisterExpenses && (
              <Button variant="outline" onClick={() => setExchangeDialogOpen(true)} icon={<ArrowRightLeft size={18} aria-hidden="true" />}>
                {t('exchangeMoney')}
              </Button>
            )}
            <DateRangePicker
              from={range.from}
              to={range.to}
              fromLabel={t('from')}
              toLabel={t('to')}
              className="sm:w-80"
              onChange={setRange}
            />
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
      {hasReportsAccess && loadFailed && (
        <LoadErrorAlert retrying={loading} onRetry={() => void reloadReport()}>
          {t('loadError')}
        </LoadErrorAlert>
      )}
      {actionError && <InlineAlert variant="danger">{actionError}</InlineAlert>}
      {hasReportsAccess && view === 'closeout' && sourceFilter && (
        <InlineAlert
          variant="info"
          action={<Button variant="outline" size="sm" onClick={() => setSourceFilter(null)}>{t('showAllSources')}</Button>}
        >
          {t(sourceFilter === 'bar' ? 'sourceFilterBar' : 'sourceFilterGameClub')}
        </InlineAlert>
      )}

      {/* After a failed load the figures are unknown, not zero: show only the error. */}
      {hasReportsAccess && !loadFailed && view === 'collected' && (
        <CollectedTab
          days={report.days}
          collections={reportRows.collections}
          enabledPaymentMethods={enabledPaymentMethods}
          loading={loading}
        />
      )}
      {hasReportsAccess && !loadFailed && view === 'closeout' && (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard loading={loading} label={t('totalCollected')} value={report.totalCollected} icon={WalletCards} tone="success" />
            <SummaryCard loading={loading} label={t('gameClubExpenses')} value={report.gameClubExpenses} icon={ReceiptText} tone="danger" />
            <SummaryCard loading={loading} label={t('gameClubLeft')} value={report.gameClubLeft} icon={CircleDollarSign} tone={toneForAmount(report.gameClubLeft, 'default')} />
            <SummaryCard loading={loading} label={t('barCashLeft')} value={report.barLeft} icon={Banknote} tone={toneForAmount(report.barLeft, 'default')} />
          </section>

          <section>
            <SectionHeading size="lg" title={t('moneyLeftByPaymentMethod')} description={t('moneyLeftDescription')} className="mb-3" />
            {loading ? (
              <MetricGridSkeleton count={4} className="gap-3" />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {paymentCards.filter((card) => {
                  // Hide a method the club has turned off, unless it still carries money
                  // in this period (recorded before it was turned off), so totals add up.
                  if (card.method === 'playstation') return true;
                  if (enabledPaymentMethods.includes(card.method)) return true;
                  const data = report.paymentMethods[card.method];
                  return data.collected !== 0 || data.expenses !== 0 || data.exchanged !== 0;
                }).map((card) => (
                  <PaymentCard
                    key={card.method}
                    label={card.label}
                    icon={card.icon}
                    data={report.paymentMethods[card.method]}
                    collectedLabel={t('collected')}
                    expensesLabel={t('expenses')}
                    exchangedLabel={t('exchanged')}
                    leftLabel={t('left')}
                  />
                ))}
                {report.usd !== 0 && (
                  <Card as="article">
                    <div className="flex items-center gap-2">
                      <CircleDollarSign size={15} className="shrink-0 text-gray-400" aria-hidden="true" />
                      <h3 className="text-[13px] font-medium text-gray-500">{t('usd')}</h3>
                    </div>
                    <p className={cn('mt-2.5 break-words text-[1.375rem] font-bold leading-none tracking-tight tabular-nums sm:text-2xl', amountToneClassName(report.usd))}>
                      {report.usd < 0 ? '−' : ''}${formatUnitCurrency(Math.abs(report.usd))}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{t('usdHeld')}</p>
                  </Card>
                )}
              </div>
            )}
          </section>

          <Card as="section" padding="none" className="overflow-hidden">
            <CardHeader>
              <SectionHeading
                title={t('dailyCloseout')}
                description={t('dailyCloseoutDescription')}
                action={(
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                    <SegmentedControl
                      variant="chips"
                      size="sm"
                      label={t('collectionFilter')}
                      value={collectionFilter}
                      onChange={setCollectionFilter}
                      options={[
                        { value: 'all', label: t('collectionFilterAll', { count: filteredReport.days.length }) },
                        { value: 'pending', label: t('collectionFilterPending', { count: filteredReport.days.length - collectedDayCount }) },
                        { value: 'collected', label: t('collectionFilterCollected', { count: collectedDayCount }) },
                      ]}
                    />
                    <Select
                      value={categoryFilter}
                      onChange={(event) => setCategoryFilter(event.target.value as MoneyReportCategoryFilter)}
                      aria-label={t('filterByCategory')}
                      className="sm:w-56"
                    >
                      <option value="all">{t('allCategories')}</option>
                      <optgroup label={t('incomeCategories')}>
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
                  </div>
                )}
              />
            </CardHeader>
            {loading ? (
              <TableSkeleton rows={6} columns={showActions ? 7 : 6} className="rounded-none border-0 shadow-none" />
            ) : (
              <DataTable
                bare
                label={t('dailyCloseout')}
                minWidth={showActions ? 1040 : 980}
                columns={closeoutColumns}
                data={closeoutRows}
                keyExtractor={(row) => row.key}
                emptyState={<EmptyState compact title={t('noData')} />}
                rowClassName={(row) => {
                  // A collected day is closed: its header and entries read as one red block.
                  if (collectionsByDate.has(row.date)) {
                    return cn(CLOSED_DAY_ROW, row.kind === 'day'
                      ? 'bg-danger-100/70 hover:bg-danger-100/70 cursor-default'
                      : 'bg-danger-50 hover:bg-danger-100/50');
                  }
                  return row.kind === 'day' ? 'bg-gray-50 hover:bg-gray-50 cursor-default' : undefined;
                }}
                onRowClick={(row) => {
                  if (row.kind === 'activity') setSelectedEntry({ activity: row.activity, date: row.date });
                }}
              />
            )}
          </Card>
        </>
      )}

      {hasReportsAccess && canRegisterExpenses && (
        <Modal
          open={expenseDialogOpen}
          onClose={() => setExpenseDialogOpen(false)}
          title={t('registerExpense')}
          size="xl"
        >
          <ExpenseRegistrationForm
            onSaved={async () => {
              setExpenseDialogOpen(false);
              showToast(t('expenseRegistered'));
              await reloadReport({ silent: true });
            }}
          />
        </Modal>
      )}

      {hasReportsAccess && canRegisterExpenses && (
        <Modal
          open={exchangeDialogOpen}
          onClose={() => setExchangeDialogOpen(false)}
          title={t('exchangeMoney')}
          size="xl"
        >
          <ExchangeForm
            onSaved={async () => {
              setExchangeDialogOpen(false);
              showToast(t('exchangeSaved'));
              await reloadReport({ silent: true });
            }}
          />
        </Modal>
      )}

      <Modal
        open={Boolean(selectedEntry)}
        onClose={() => setSelectedEntry(null)}
        title={t('entryDetails')}
        size="lg"
      >
        {selectedEntry && (
          <div className="space-y-5">
            {actionError && <InlineAlert variant="danger">{actionError}</InlineAlert>}
            {collectionsByDate.has(selectedEntry.date) && (
              <InlineAlert variant="danger" title={t('dayClosed')}>
                {t('dayClosedDetails', {
                  name: collectionsByDate.get(selectedEntry.date)?.collector_name || t('unknownCreator'),
                })}
              </InlineAlert>
            )}
            <div>
              <Badge variant={activityKindVariant(selectedEntry.activity.kind)}>
                {activityTypeLabel(selectedEntry.activity)}
              </Badge>
              {selectedEntry.activity.exchange ? (
                <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums text-gray-900">
                  {exchangeAmountLabel(selectedEntry.activity.exchange.from, selectedEntry.activity.exchange.fromAmount)}
                  {' → '}
                  {exchangeAmountLabel(selectedEntry.activity.exchange.to, selectedEntry.activity.exchange.toAmount)}
                </p>
              ) : (
                <p className={cn('mt-3 text-2xl font-bold tracking-tight tabular-nums', amountToneClassName(selectedEntry.activity.amount))}>
                  <Money amount={selectedEntry.activity.amount} showPlus currencyClassName="text-sm font-medium tracking-normal text-gray-500" />
                </p>
              )}
            </div>

            <dl className="divide-y divide-gray-100 rounded-xl border border-gray-200 px-4">
              <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-3 text-sm">
                <dt className="text-gray-500">{t('dateAndTime')}</dt>
                <dd className="text-right font-semibold text-gray-900">
                  {canCorrectExpense(selectedEntry.activity, selectedEntry.date) ? (
                    <div className="ml-auto flex max-w-60 flex-col items-end gap-1">
                      <DatePicker
                        ariaLabel={t('date')}
                        value={selectedEntry.date}
                        max={businessToday}
                        disabled={methodSaving}
                        className="w-full"
                        onChange={(date) => void handleUpdateExpense(selectedEntry.activity, { date })}
                      />
                      <span className="text-xs font-normal text-gray-500">
                        {t('addedAt', { time: formatTime(selectedEntry.activity.createdAt, locale) })}
                      </span>
                    </div>
                  ) : (
                    <>{formatDateOnly(selectedEntry.date, locale)} · {formatTime(selectedEntry.activity.createdAt, locale)}</>
                  )}
                </dd>
              </div>
              <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-3 text-sm">
                <dt className="text-gray-500">{t('category')}</dt>
                <dd className="break-words text-right font-semibold text-gray-900">{categoryLabel(selectedEntry.activity)}</dd>
              </div>
              <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-3 text-sm">
                <dt className="text-gray-500">{t('addedBy')}</dt>
                <dd className="break-words text-right font-semibold text-gray-900">
                  {selectedEntry.activity.createdByName || t('unknownCreator')}
                </dd>
              </div>
              {selectedEntry.activity.exchange?.rate != null && (
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-3 text-sm">
                  <dt className="text-gray-500">{t('exchangeRate')}</dt>
                  <dd className="text-right font-semibold tabular-nums text-gray-900">
                    1 $ = {formatUnitCurrency(selectedEntry.activity.exchange.rate)} {tc('currency')}
                  </dd>
                </div>
              )}
              {!selectedEntry.activity.exchange && (
                <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-3 text-sm">
                  <dt className="text-gray-500">{t('paymentMethod')}</dt>
                  <dd className="text-right font-semibold text-gray-900">
                    {selectedEntry.activity.paymentBreakdown ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {Object.entries(selectedEntry.activity.paymentBreakdown)
                          .filter(([, amount]) => amount !== 0)
                          .map(([method, amount]) => (
                            <Badge key={method} variant="outline">
                              {paymentLabel(method)} · <Money amount={amount} />
                            </Badge>
                          ))}
                      </div>
                    ) : canCorrectExpense(selectedEntry.activity, selectedEntry.date) ? (
                      <Select
                        value={selectedEntry.activity.paymentMethod ?? ''}
                        onChange={(event) => void handleUpdateExpense(selectedEntry.activity, { paymentMethod: event.target.value })}
                        disabled={methodSaving}
                        aria-label={t('paymentMethod')}
                        className="ml-auto w-40"
                      >
                        {paymentMethodOptions(selectedEntry.activity.paymentMethod).map((method) => (
                          <option key={method} value={method}>{paymentLabel(method)}</option>
                        ))}
                      </Select>
                    ) : (
                      paymentLabel(selectedEntry.activity.paymentMethod)
                    )}
                  </dd>
                </div>
              )}
              <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-3 text-sm">
                <dt className="text-gray-500">{t('descriptionLabel')}</dt>
                <dd className="break-words text-right text-gray-700">
                  {selectedEntry.activity.comment || t('noDescription')}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </Modal>

      {toastElement}
      {confirmDialog}
    </div>
  );
}
