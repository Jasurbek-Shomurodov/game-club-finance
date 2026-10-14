'use client';

// Route: /daily-report

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Button,
  Card,
  DataTable,
  DatePicker,
  EmptyState,
  Field,
  InlineAlert,
  MetricCard,
  MetricGridSkeleton,
  Money,
  PageHeader,
  SectionHeading,
  StatTile,
  TableSkeleton,
  toneForAmount,
  MetricMoney,
} from '@/components/PresentationFoundation';
import { todayIso } from '@/lib/utils';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { calculateFinancialReportTotals } from '@/lib/calculations/dailyReport';
import { calculateGameClubIncome } from '@/lib/calculations/dailyCash';
import { fetchFinanceReportSnapshot } from '@/lib/supabase/financeReportSnapshot';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { FileText, RefreshCcw, TrendingUp, TrendingDown, DollarSign, Users } from 'lucide-react';
import type { DailyCashEntry, DailyStockCount, Expense, StockPurchase } from '@/types';

interface ProductRow extends DailyStockCount {
  products: { name: string; sort_order?: number | null } | null;
}

function isMissingSortOrder(error: { message?: string } | null | undefined) {
  return error?.message?.includes('sort_order') ?? false;
}

export default function DailyReportPage() {
  const t = useTranslations('dailyReport');
  const tc = useTranslations('common');
  const te = useTranslations('expenses');
  const { selectedClubId, businessDayStartHour } = useClub();

  const businessToday = useMemo(() => todayIso(new Date(), businessDayStartHour), [businessDayStartHour]);
  const [date, setDate] = useState(() => businessToday);
  const [cashEntry, setCashEntry] = useState<DailyCashEntry | null>(null);
  const [stockCounts, setStockCounts] = useState<ProductRow[]>([]);
  const [stockPurchases, setStockPurchases] = useState<StockPurchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [debtIncome, setDebtIncome] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const requestSequence = useRef(0);

  const fetchData = useCallback(async (selectedDate: string) => {
    const requestId = ++requestSequence.current;

    if (!selectedClubId) {
      setCashEntry(null);
      setStockCounts([]);
      setStockPurchases([]);
      setExpenses([]);
      setDebtIncome(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(false);
    const supabase = createClient();

    const snapshotResult = await fetchFinanceReportSnapshot(
      supabase,
      selectedClubId,
      selectedDate,
      selectedDate,
      ['cash', 'stock_counts', 'purchases', 'expenses', 'debts'],
    );

    if (requestId !== requestSequence.current) return;

    if (snapshotResult.error) {
      setCashEntry(null);
      setStockCounts([]);
      setStockPurchases([]);
      setExpenses([]);
      setDebtIncome(0);
      setLoadError(true);
      setLoading(false);
      return;
    }

    if (snapshotResult.data) {
      const snapshot = snapshotResult.data;
      setCashEntry(snapshot.cashRows[0] ?? null);
      setStockCounts(snapshot.stockCountRows.map((row) => ({
        ...row,
        products: row.product_name
          ? { name: row.product_name, sort_order: row.sort_order }
          : null,
      })));
      setStockPurchases(snapshot.purchaseRows);
      setExpenses(snapshot.expenseRows);
      setDebtIncome(snapshot.debtRows.reduce(
        (sum, debt) => sum + Number(debt.amount ?? 0),
        0,
      ));
      setLoading(false);
      return;
    }

    // Compatibility path while migration 049 is being deployed.
    const [cashRes, initialStockRes, purchaseRes, expRes, debtRes] = await Promise.all([
      supabase
        .from('daily_cash_entries')
        .select('*')
        .eq('club_id', selectedClubId)
        .eq('date', selectedDate)
        .maybeSingle(),
      fetchAllRows<ProductRow>(() => supabase
        .from('daily_stock_counts')
        .select('*, products(name, sort_order)')
        .eq('club_id', selectedClubId)
        .eq('date', selectedDate)
        .order('product_id', { ascending: true })),
      fetchAllRows<StockPurchase>(() => supabase
        .from('stock_purchases')
        .select('*')
        .eq('club_id', selectedClubId)
        .eq('date', selectedDate)
        .order('id', { ascending: true })),
      fetchAllRows<Expense>(() => supabase
        .from('expenses')
        .select('*')
        .eq('club_id', selectedClubId)
        .eq('date', selectedDate)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })),
      fetchAllRows<{ amount: number | null }>(() => supabase
        .from('new_debts')
        .select('amount')
        .eq('club_id', selectedClubId)
        .eq('date', selectedDate)
        .order('id', { ascending: true })),
    ]);

    let stockRes = initialStockRes;
    if (isMissingSortOrder(stockRes.error)) {
      stockRes = await fetchAllRows<ProductRow>(() => supabase
        .from('daily_stock_counts')
        .select('*, products(name)')
        .eq('club_id', selectedClubId)
        .eq('date', selectedDate)
        .order('product_id', { ascending: true }));
    }

    if (requestId !== requestSequence.current) return;

    const firstError = [cashRes, stockRes, purchaseRes, expRes, debtRes]
      .find((result) => result.error)?.error;
    if (firstError) {
      setCashEntry(null);
      setStockCounts([]);
      setStockPurchases([]);
      setExpenses([]);
      setDebtIncome(0);
      setLoadError(true);
      setLoading(false);
      return;
    }

    setCashEntry(cashRes.data as DailyCashEntry | null);
    setStockCounts(
      ((stockRes.data as ProductRow[]) ?? []).sort((a, b) => {
        const orderA = a.products?.sort_order ?? Number.MAX_SAFE_INTEGER;
        const orderB = b.products?.sort_order ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return (a.products?.name ?? a.product_id).localeCompare(b.products?.name ?? b.product_id);
      }),
    );
    setStockPurchases((purchaseRes.data as StockPurchase[]) ?? []);
    setExpenses((expRes.data as Expense[]) ?? []);
    setDebtIncome(((debtRes.data ?? []) as Array<{ amount: number | null }>).reduce(
      (sum, debt) => sum + Number(debt.amount ?? 0),
      0,
    ));
    setLoadError(false);
    setLoading(false);
  }, [selectedClubId]);

  useEffect(() => {
    fetchData(date).catch(() => {
      setCashEntry(null);
      setStockCounts([]);
      setStockPurchases([]);
      setExpenses([]);
      setDebtIncome(0);
      setLoadError(true);
      setLoading(false);
    });
    return () => { requestSequence.current += 1; };
  }, [date, fetchData, reloadToken]);

  useEffect(() => {
    setDate(businessToday);
  }, [businessToday, selectedClubId]);

  const manualIncome = cashEntry
    ? calculateGameClubIncome({
        cashIncome: cashEntry.cash_income,
        terminalIncome: cashEntry.terminal_income,
        cardIncome: cashEntry.card_income,
        playstationIncome: cashEntry.playstation_income ?? 0,
      })
    : 0;

  const reportTotals = calculateFinancialReportTotals({
    manualIncome,
    debtIncome,
    stockRows: stockCounts,
    purchaseRows: stockPurchases,
    expenseRows: expenses,
  });

  const hasData = cashEntry !== null || stockCounts.length > 0 || stockPurchases.length > 0 || expenses.length > 0 || debtIncome > 0;
  const currency = tc('currency');

  const kpis = [
    { label: t('manualIncome'), amount: manualIncome, icon: TrendingUp, tone: 'success' as const },
    { label: t('barSales'), amount: reportTotals.barSales, icon: TrendingUp, tone: 'success' as const },
    { label: t('debtIncome'), amount: debtIncome, icon: Users, tone: 'warning' as const },
    { label: t('totalIncome'), amount: reportTotals.totalIncome, icon: TrendingUp, tone: 'success' as const },
    { label: t('costOfGoodsSold'), amount: reportTotals.barCost, icon: TrendingDown, tone: 'danger' as const },
    { label: t('totalExpenses'), amount: reportTotals.totalExpenses, icon: TrendingDown, tone: 'danger' as const },
    { label: t('inventoryPurchases'), amount: reportTotals.stockPurchaseCost, icon: TrendingDown, tone: 'danger' as const },
    { label: t('barExpenses'), amount: reportTotals.barExpenses, icon: TrendingDown, tone: 'danger' as const },
    { label: t('barCashLeft'), amount: reportTotals.barCashLeft, icon: DollarSign, tone: toneForAmount(reportTotals.barCashLeft) },
    { label: t('accountingNetProfit'), amount: reportTotals.accountingNetProfit, icon: DollarSign, tone: toneForAmount(reportTotals.accountingNetProfit) },
  ];

  const cashBreakdown = cashEntry
    ? [
        { label: tc('paymentMethods.cash'), amount: cashEntry.cash_income },
        { label: tc('paymentMethods.terminal'), amount: cashEntry.terminal_income },
        { label: t('card'), amount: cashEntry.card_income },
        { label: t('playstation'), amount: cashEntry.playstation_income ?? 0 },
      ].filter((item) => item.amount > 0)
    : [];

  return (
    <div>
      <PageHeader
        title={t('title')}
        action={(
          <Field label={t('date')} className="sm:w-64">
            <DatePicker ariaLabel={t('date')} value={date} max={businessToday} onChange={setDate} />
          </Field>
        )}
      />

      {loadError && (
        <InlineAlert
          variant="danger"
          className="mb-4"
          action={(
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => setReloadToken((token) => token + 1)}
              icon={<RefreshCcw size={15} aria-hidden="true" />}
            >
              {tc('retry')}
            </Button>
          )}
        >
          {t('loadError')}
        </InlineAlert>
      )}

      {loading ? (
        <div className="space-y-6">
          <MetricGridSkeleton count={10} className="xl:grid-cols-5" />
          <TableSkeleton rows={4} columns={5} />
        </div>
      ) : loadError ? null : !hasData ? (
        <Card><EmptyState icon={FileText} title={t('noData')} /></Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {kpis.map((kpi) => (
              <MetricCard key={kpi.label} label={kpi.label} value={<MetricMoney amount={kpi.amount} currency={currency} />} icon={kpi.icon} tone={kpi.tone} />
            ))}
          </div>
          <p className="text-xs text-gray-500">{t('barCashFormula')}</p>

          {cashEntry && (
            <Card>
              <SectionHeading size="sm" title={t('cashEntry')} />
              <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {cashBreakdown.map((item) => (
                  <StatTile key={item.label} label={item.label} value={formatCurrency(item.amount)} unit={currency} variant="soft" size="sm" />
                ))}
              </div>
              {cashEntry.comment && <p className="mt-3 text-sm text-gray-500">{cashEntry.comment}</p>}
            </Card>
          )}

          {stockCounts.length > 0 && (
            <Card padding="none">
              <div className="px-4 pt-4 sm:px-5 sm:pt-5">
                <SectionHeading size="sm" title={t('stockSummary')} />
              </div>
              <DataTable
                bare
                className="mt-3"
                label={t('stockSummary')}
                minWidth={680}
                keyExtractor={(row) => row.id}
                data={stockCounts}
                columns={[
                  { key: 'product', header: t('product'), className: 'sticky left-0 z-10 bg-gray-50', cellClassName: 'bg-surface', render: (row) => <span className="font-medium text-gray-900">{row.products?.name ?? row.product_id}</span> },
                  { key: 'sold', header: t('sold'), align: 'right', render: (row) => formatNumber(row.sold_quantity) },
                  { key: 'income', header: t('barSales'), align: 'right', render: (row) => <span className="text-success-600">{formatCurrency(row.bar_income)}</span> },
                  { key: 'cost', header: t('costOfGoodsSold'), align: 'right', render: (row) => <span className="text-danger-600">{formatCurrency(row.bar_cost)}</span> },
                  { key: 'profit', header: t('grossProfit'), align: 'right', render: (row) => <Money amount={row.bar_profit} currency={null} signed className={row.bar_profit >= 0 ? 'font-medium text-success-600' : 'font-medium'} /> },
                ]}
                footer={{
                  product: tc('total'),
                  sold: formatNumber(stockCounts.reduce((sum, row) => sum + row.sold_quantity, 0)),
                  income: <span className="text-success-600">{formatCurrency(reportTotals.barSales)}</span>,
                  cost: <span className="text-danger-600">{formatCurrency(reportTotals.barCost)}</span>,
                  profit: formatCurrency(stockCounts.reduce((s, r) => s + r.bar_profit, 0)),
                }}
              />
            </Card>
          )}

          {expenses.length > 0 && (
            <Card>
              <SectionHeading size="sm" title={t('expensesList')} />
              <ul className="mt-3 divide-y divide-gray-100">
                {expenses.map((e) => (
                  <li key={e.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:justify-between">
                    <span className="text-gray-600">
                      {te.has(`categories.${e.category}`) ? te(`categories.${e.category}` as Parameters<typeof te>[0]) : e.category}
                      {e.comment ? ` · ${e.comment}` : ''}
                    </span>
                    <span className="font-medium text-danger-600"><Money amount={e.amount} /></span>
                  </li>
                ))}
                <li className="flex flex-col gap-1 pt-3 text-sm font-semibold sm:flex-row sm:justify-between">
                  <span>{tc('total')}</span>
                  <span className="text-danger-600"><Money amount={reportTotals.totalExpenses} /></span>
                </li>
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
