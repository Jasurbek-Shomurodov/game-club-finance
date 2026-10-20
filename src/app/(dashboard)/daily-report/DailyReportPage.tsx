'use client';

// Route: /daily-report

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Card,
  DataTable,
  DatePicker,
  EmptyState,
  Field,
  LoadErrorAlert,
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
import { useBusinessPeriod } from '@/lib/useBusinessPeriod';
import { useClubQuery } from '@/lib/useClubQuery';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { calculateFinancialReportTotals, calculateManualIncome } from '@/lib/calculations/dailyReport';
import { loadFinanceReportRows, type FinanceStockCountRow } from '@/lib/supabase/financeReportSnapshot';
import { FileText, TrendingUp, TrendingDown, DollarSign, Users } from 'lucide-react';
import type { DailyCashEntry, Expense, StockPurchase } from '@/types';

interface DailyReportData {
  cashEntry: DailyCashEntry | null;
  stockCounts: FinanceStockCountRow[];
  stockPurchases: StockPurchase[];
  expenses: Expense[];
  debtIncome: number;
}

const EMPTY_REPORT: DailyReportData = { cashEntry: null, stockCounts: [], stockPurchases: [], expenses: [], debtIncome: 0 };

export default function DailyReportPage() {
  const t = useTranslations('dailyReport');
  const tc = useTranslations('common');
  const te = useTranslations('expenses');
  const { selectedClubId, businessDayStartHour } = useClub();

  const businessToday = useBusinessToday(businessDayStartHour);
  const [date, setDate] = useBusinessPeriod(businessToday, selectedClubId);

  const loadReport = useCallback(async () => {
    if (!selectedClubId) return EMPTY_REPORT;
    const result = await loadFinanceReportRows(createClient(), selectedClubId, date, date, 'day');
    if (!result.data) throw new Error(result.error?.message);
    return {
      cashEntry: result.data.cashRows[0] ?? null,
      stockCounts: result.data.stockCountRows,
      stockPurchases: result.data.purchaseRows,
      expenses: result.data.expenseRows,
      debtIncome: result.data.debtRows.reduce((sum, debt) => sum + Number(debt.amount ?? 0), 0),
    };
  }, [date, selectedClubId]);
  const report = useClubQuery<DailyReportData>(loadReport, EMPTY_REPORT);
  const { cashEntry, stockCounts, stockPurchases, expenses, debtIncome } = report.data;
  const loading = report.loading;
  const loadError = report.error;

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

  // The game club and the bar are separate businesses: one row each, never added together.
  const kpis = [
    { label: t('manualIncome'), amount: manualIncome, icon: TrendingUp, tone: 'success' as const },
    { label: t('debtIncome'), amount: debtIncome, icon: Users, tone: 'warning' as const },
    { label: t('gameClubExpenses'), amount: reportTotals.gameClubExpenses, icon: TrendingDown, tone: 'danger' as const },
    { label: t('gameClubProfit'), amount: reportTotals.gameClubProfit, icon: DollarSign, tone: toneForAmount(reportTotals.gameClubProfit) },
    { label: t('barSales'), amount: reportTotals.barSales, icon: TrendingUp, tone: 'success' as const },
    { label: t('costOfGoodsSold'), amount: reportTotals.barCost, icon: TrendingDown, tone: 'danger' as const },
    { label: t('barExpenses'), amount: reportTotals.barExpenses, icon: TrendingDown, tone: 'danger' as const },
    { label: t('barProfit'), amount: reportTotals.barProfit, icon: DollarSign, tone: toneForAmount(reportTotals.barProfit) },
    { label: t('inventoryPurchases'), amount: reportTotals.stockPurchaseCost, icon: TrendingDown, tone: 'danger' as const },
    { label: t('barCashLeft'), amount: reportTotals.barCashLeft, icon: DollarSign, tone: toneForAmount(reportTotals.barCashLeft) },
  ];

  const cashBreakdown = cashEntry
    ? [
        { label: tc('paymentMethods.cash'), amount: cashEntry.cash_income },
        { label: tc('paymentMethods.terminal'), amount: cashEntry.terminal_income },
        { label: tc('paymentMethods.card'), amount: cashEntry.card_income },
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
        <LoadErrorAlert className="mb-4" retrying={loading} onRetry={() => void report.reload()}>
          {t('loadError')}
        </LoadErrorAlert>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                  <span>{t('gameClubExpenses')}</span>
                  <span className="text-danger-600"><Money amount={reportTotals.gameClubExpenses} /></span>
                </li>
                <li className="flex flex-col gap-1 pt-1 text-sm font-semibold sm:flex-row sm:justify-between">
                  <span>{t('barExpenses')}</span>
                  <span className="text-danger-600"><Money amount={reportTotals.barExpenses} /></span>
                </li>
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
