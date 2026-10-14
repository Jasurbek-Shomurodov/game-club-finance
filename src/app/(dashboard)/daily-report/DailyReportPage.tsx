'use client';

// Route: /daily-report

import { useState, useEffect, useCallback, useRef } from 'react';
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
import { useBusinessToday } from '@/lib/useBusinessToday';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { calculateFinancialReportTotals, calculateManualIncome } from '@/lib/calculations/dailyReport';
import { loadFinanceReportRows, type FinanceStockCountRow } from '@/lib/supabase/financeReportSnapshot';
import { FileText, RefreshCcw, TrendingUp, TrendingDown, DollarSign, Users } from 'lucide-react';
import type { DailyCashEntry, Expense, StockPurchase } from '@/types';

export default function DailyReportPage() {
  const t = useTranslations('dailyReport');
  const tc = useTranslations('common');
  const te = useTranslations('expenses');
  const { selectedClubId, businessDayStartHour } = useClub();

  const businessToday = useBusinessToday(businessDayStartHour);
  const [date, setDate] = useState(() => businessToday);
  const [cashEntry, setCashEntry] = useState<DailyCashEntry | null>(null);
  const [stockCounts, setStockCounts] = useState<FinanceStockCountRow[]>([]);
  const [stockPurchases, setStockPurchases] = useState<StockPurchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [debtIncome, setDebtIncome] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const requestSequence = useRef(0);

  const clearReport = useCallback(() => {
    setCashEntry(null);
    setStockCounts([]);
    setStockPurchases([]);
    setExpenses([]);
    setDebtIncome(0);
  }, []);

  const fetchData = useCallback(async (selectedDate: string) => {
    const requestId = ++requestSequence.current;

    if (!selectedClubId) {
      clearReport();
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(false);
    try {
      const result = await loadFinanceReportRows(createClient(), selectedClubId, selectedDate, selectedDate, 'day');
      if (requestId !== requestSequence.current) return;
      if (!result.data) throw new Error(result.error?.message);

      setCashEntry(result.data.cashRows[0] ?? null);
      setStockCounts(result.data.stockCountRows);
      setStockPurchases(result.data.purchaseRows);
      setExpenses(result.data.expenseRows);
      setDebtIncome(result.data.debtRows.reduce((sum, debt) => sum + Number(debt.amount ?? 0), 0));
      setLoading(false);
    } catch {
      // A superseded load must not paint its failure over a newer request.
      if (requestId !== requestSequence.current) return;
      clearReport();
      setLoadError(true);
      setLoading(false);
    }
  }, [clearReport, selectedClubId]);

  useEffect(() => {
    void fetchData(date);
    return () => { requestSequence.current += 1; };
  }, [date, fetchData, reloadToken]);

  // A club switch opens the current business day; a day rollover moves the
  // report forward only if it was still showing the previous day.
  const previousBusinessToday = useRef(businessToday);
  const previousClubId = useRef(selectedClubId);
  useEffect(() => {
    const previousToday = previousBusinessToday.current;
    const clubChanged = previousClubId.current !== selectedClubId;
    previousBusinessToday.current = businessToday;
    previousClubId.current = selectedClubId;
    setDate((current) => (clubChanged || current === previousToday ? businessToday : current));
  }, [businessToday, selectedClubId]);

  const manualIncome = cashEntry ? calculateManualIncome(cashEntry) : 0;

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
                  { key: 'product', header: t('product'), className: 'sticky left-0 z-10 bg-gray-50', cellClassName: 'bg-surface', render: (row) => <span className="font-medium text-gray-900">{row.product_name ?? row.product_id}</span> },
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
