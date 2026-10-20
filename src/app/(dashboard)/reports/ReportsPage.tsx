'use client';

// Route: /reports

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  CircleDollarSign,
  CreditCard,
  Gamepad2,
  Landmark,
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
import { formatCurrency, formatDateOnly, formatTime } from '@/lib/formatters';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { createClient, mutateFinanceRequest } from '@/lib/supabase/client';
import { isMissingDatabaseFunction } from '@/lib/supabase/errors';
import { deleteDailyCashEntry } from '@/lib/supabase/dailyCashEntries';
import { cn } from '@/lib/utils';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessPeriod } from '@/lib/useBusinessPeriod';
import { useClubQuery } from '@/lib/useClubQuery';
import { canAccessFeature } from '@/lib/permissions';
import ExpenseRegistrationForm from './ExpenseRegistrationForm';
import { EXPENSE_CATEGORIES, isKnownExpenseCategory } from '@/lib/expenseCategories';

const emptyReportRows = {
  cash: [] as MoneyReportCashRow[],
  expenses: [] as ExpenseRow[],
  debtPayments: [] as MoneyReportDebtPaymentRow[],
  barSales: [] as MoneyReportBarSalesRow[],
  stockPurchases: [] as StockPurchaseCostRow[],
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
  if (kind === 'debt_payment') return 'info';
  return 'danger';
}

/** The closeout table lists a subtle day header row followed by that day's entries. */
type CloseoutRow =
  | { kind: 'day'; key: string; date: string; income: number; gameClubExpenses: number; barExpenses: number; total: number; count: number }
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
  leftLabel,
}: {
  label: string;
  data: MoneyReportPaymentBreakdown;
  icon: LucideIcon;
  collectedLabel: string;
  expensesLabel: string;
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
      </dl>
    </Card>
  );
}

export default function ReportsPage() {
  const t = useTranslations('reports');
  const tc = useTranslations('common');
  const te = useTranslations('expenses.categories');
  const { locale } = useAppLocale();
  const { selectedClubId, businessDayStartHour, role, featureAccess } = useClub();
  const hasReportsAccess = canAccessFeature(role, featureAccess, 'reports');
  // Members with only the expenses feature land here to register expenses.
  const canRegisterExpenses = canAccessFeature(role, featureAccess, 'expenses');
  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const businessToday = useBusinessToday(businessDayStartHour);
  // A club switch opens the current month; a business-day rollover moves the
  // range forward only while it is still the previous day's default range.
  const defaultRange = useMemo(() => getDashboardRange('month', businessToday), [businessToday]);
  const [range, setRange] = useBusinessPeriod<ReportRange>(defaultRange, selectedClubId, sameRange);
  const [categoryFilter, setCategoryFilter] = useState<MoneyReportCategoryFilter>('all');
  /** Translated result of a failed delete. */
  const [actionError, setActionError] = useState('');
  const { showToast, toastElement } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<{ activity: MoneyReportActivity; date: string } | null>(null);
  const currentClubId = useRef(selectedClubId);
  const deletePending = useRef(false);
  const isOwner = role === 'owner';
  const loadReport = useCallback(async (isCurrent: () => boolean): Promise<typeof emptyReportRows> => {
    if (!selectedClubId || !hasReportsAccess) return emptyReportRows;

    const supabase = createClient();
    const snapshotResult = await supabase.rpc('get_money_report_snapshot', {
      p_club_id: selectedClubId,
      p_range_from: range.from,
      p_range_to: range.to,
    });

    if (!snapshotResult.error) {
      const snapshot = snapshotResult.data as MoneyReportSnapshotPayload;
      return {
        cash: snapshot.cash ?? [],
        expenses: snapshot.expenses ?? [],
        debtPayments: snapshot.debtPayments ?? [],
        barSales: snapshot.barSales ?? [],
        stockPurchases: snapshot.stockPurchases ?? [],
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
    };
  }, [hasReportsAccess, range.from, range.to, selectedClubId]);
  const reportQuery = useClubQuery<typeof emptyReportRows>(loadReport, emptyReportRows);
  const { loading, reload: reloadReport } = reportQuery;
  /** The report failed to load; shown with a Retry action instead of the empty state. */
  const loadFailed = reportQuery.error;
  // A failed load shows no figures, even after a silent reload.
  const reportRows = loadFailed ? emptyReportRows : reportQuery.data;
  const report = useMemo(() => buildFilteredMoneyReport(
    reportRows.cash,
    reportRows.expenses,
    reportRows.debtPayments,
    categoryFilter,
    reportRows.barSales,
    reportRows.stockPurchases,
  ), [categoryFilter, reportRows]);

  // Dialogs belong to the club they were opened for: close them on a club switch.
  useEffect(() => {
    currentClubId.current = selectedClubId;
    setSelectedEntry(null);
    setExpenseDialogOpen(false);
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
        amount: `${formatCurrency(Math.abs(activity.amount))} ${tc('currency')}`,
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
      if (activity.source === 'expense') {
        const response = await mutateFinanceRequest('/api/expenses', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ clubId, expenseId: activity.id }),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null) as { error?: string; code?: string } | null;
          deleteError = result?.code === 'SALARY_PAYMENT_IMMUTABLE'
            ? t('salaryPaymentProtected')
            : response.status === 401 || response.status === 403
              ? tc('accessDeniedDescription')
              : t('deleteError');
        }
      } else {
        const deleted = await deleteDailyCashEntry(createClient(), clubId, activity.id);
        if (!deleted) deleteError = t('deleteError');
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

  function categoryLabel(activity: MoneyReportActivity): string {
    if (activity.kind === 'income') return t('dailyClubIncome');
    if (activity.kind === 'debt_payment') return t('debtPayment');
    const category = activity.category ?? 'other';
    const label = isKnownExpenseCategory(category) || category === 'other' ? te(category) : category;
    return activity.paymentSource === 'bar' ? `${t('bar')} · ${label}` : label;
  }

  function activityTypeLabel(activity: MoneyReportActivity): string {
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

  const closeoutRows = useMemo<CloseoutRow[]>(() => report.days.flatMap((day) => [
    {
      kind: 'day' as const,
      key: `day:${day.date}`,
      date: day.date,
      income: day.income,
      gameClubExpenses: day.gameClubExpenses,
      barExpenses: day.barExpenses,
      total: day.total,
      count: day.activities.length,
    },
    ...day.activities.map((activity, index) => ({
      kind: 'activity' as const,
      key: activity.id ? `${activity.source}:${activity.id}` : `${day.date}-${activity.source}-${index}`,
      date: day.date,
      activity,
    })),
  ]), [report.days]);

  const closeoutColumns: DataTableColumn<CloseoutRow>[] = [
    {
      key: 'date',
      header: t('dateAndTime'),
      className: 'w-44 whitespace-nowrap',
      render: (row) => (row.kind === 'day' ? (
        <span className="flex items-center gap-2">
          <span className="font-semibold text-gray-900">{formatDateOnly(row.date, locale)}</span>
          <Badge variant="outline" size="sm">{row.count}</Badge>
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
      ) : (
        <span className={cn('font-semibold', amountToneClassName(row.activity.amount))}>
          <Money amount={row.activity.amount} showPlus currency={null} />
        </span>
      )),
    },
    {
      key: 'description',
      header: t('descriptionLabel'),
      className: 'min-w-[240px]',
      render: (row) => (row.kind === 'day' ? (
        <span className="text-xs text-gray-500">
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
        </span>
      ) : (
        <span className="block max-w-[320px] break-words text-gray-600">{row.activity.comment || t('noDescription')}</span>
      )),
    },
    ...(isOwner ? [{
      key: 'actions',
      header: <span className="sr-only">{t('actions')}</span>,
      align: 'right' as const,
      className: 'w-16',
      render: (row: CloseoutRow) => {
        if (row.kind !== 'activity') return null;
        const deleteKey = row.activity.id ? `${row.activity.source}:${row.activity.id}` : null;
        const canDelete = row.activity.source !== 'debt_payment' && Boolean(row.activity.id);
        if (!canDelete) return null;
        return (
          <IconButton
            variant="danger"
            size="sm"
            label={`${tc('delete')}: ${categoryLabel(row.activity)} · ${formatCurrency(Math.abs(row.activity.amount))} ${tc('currency')}`}
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
        action={hasReportsAccess ? (
          <>
            {canRegisterExpenses && (
              <Button variant="outline" onClick={() => setExpenseDialogOpen(true)} icon={<ReceiptText size={18} aria-hidden="true" />}>
                {t('registerExpense')}
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
            <Select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value as MoneyReportCategoryFilter)}
              aria-label={t('filterByCategory')}
              className="sm:w-60"
            >
              <option value="all">{t('allCategories')}</option>
              <optgroup label={t('incomeCategories')}>
                <option value="income">{t('dailyClubIncome')}</option>
                <option value="debt_payment">{t('debtPayment')}</option>
              </optgroup>
              <optgroup label={t('expenseCategories')}>
                <option value="expense">{t('allExpenses')}</option>
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={`expense:${category}`}>
                    {te(category)}
                  </option>
                ))}
              </optgroup>
            </Select>
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

      {/* After a failed load the figures are unknown, not zero: show only the error. */}
      {hasReportsAccess && !loadFailed && (
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
                {paymentCards.map((card) => (
                  <PaymentCard
                    key={card.method}
                    label={card.label}
                    icon={card.icon}
                    data={report.paymentMethods[card.method]}
                    collectedLabel={t('collected')}
                    expensesLabel={t('expenses')}
                    leftLabel={t('left')}
                  />
                ))}
              </div>
            )}
          </section>

          <Card as="section" padding="none" className="overflow-hidden">
            <CardHeader>
              <SectionHeading title={t('dailyCloseout')} description={t('dailyCloseoutDescription')} />
            </CardHeader>
            {loading ? (
              <TableSkeleton rows={6} columns={isOwner ? 6 : 5} className="rounded-none border-0 shadow-none" />
            ) : (
              <DataTable
                bare
                label={t('dailyCloseout')}
                minWidth={isOwner ? 900 : 840}
                columns={closeoutColumns}
                data={closeoutRows}
                keyExtractor={(row) => row.key}
                emptyState={<EmptyState compact title={t('noData')} />}
                rowClassName={(row) => (row.kind === 'day' ? 'bg-gray-50 hover:bg-gray-50 cursor-default' : undefined)}
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

      <Modal
        open={Boolean(selectedEntry)}
        onClose={() => setSelectedEntry(null)}
        title={t('entryDetails')}
        size="lg"
      >
        {selectedEntry && (
          <div className="space-y-5">
            <div>
              <Badge variant={activityKindVariant(selectedEntry.activity.kind)}>
                {activityTypeLabel(selectedEntry.activity)}
              </Badge>
              <p className={cn('mt-3 text-2xl font-bold tracking-tight tabular-nums', amountToneClassName(selectedEntry.activity.amount))}>
                <Money amount={selectedEntry.activity.amount} showPlus currencyClassName="text-sm font-medium tracking-normal text-gray-500" />
              </p>
            </div>

            <dl className="divide-y divide-gray-100 rounded-xl border border-gray-200 px-4">
              <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-3 text-sm">
                <dt className="text-gray-500">{t('dateAndTime')}</dt>
                <dd className="text-right font-semibold text-gray-900">
                  {formatDateOnly(selectedEntry.date, locale)} · {formatTime(selectedEntry.activity.createdAt, locale)}
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
                  ) : (
                    paymentLabel(selectedEntry.activity.paymentMethod)
                  )}
                </dd>
              </div>
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
