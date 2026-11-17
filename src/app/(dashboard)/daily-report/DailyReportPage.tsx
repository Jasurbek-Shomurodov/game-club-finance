'use client';

// Route: /daily-report

import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useClub } from '@/components/layout/DashboardShell';
import { ReportsTabs } from '../reports/ReportsTabs';
import {
  Card,
  DataTable,
  DatePicker,
  EmptyState,
  Field,
  LoadErrorAlert,
  MetricCard,
  MetricGridSkeleton,
  Modal,
  Money,
  PageHeader,
  SectionHeading,
  StatTile,
  TableSkeleton,
  toneForAmount,
  MetricMoney,
  metricGridClassName,
} from '@/components/PresentationFoundation';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessPeriod } from '@/lib/useBusinessPeriod';
import { useClubQuery } from '@/lib/useClubQuery';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { isoDateParam } from '@/lib/utils';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { PaymentDetails } from '@/components/financial-analysis/PaymentDetails';
import { calculateFinancialReportTotals, calculateManualIncome } from '@/lib/calculations/dailyReport';
import { loadFinanceReportRows, type FinanceStockCountRow } from '@/lib/supabase/financeReportSnapshot';
import { ChevronRight, FileText, TrendingUp, TrendingDown, DollarSign, Users } from 'lucide-react';
import type { DailyCashEntry, Expense, StockPurchase } from '@/types';
import { closingStockHref, dayRange, moneyDetailsHref, reportsHref } from '@/lib/detailLinks';

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
  const router = useRouter();
  const { locale } = useAppLocale();
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  // `?date=YYYY-MM-DD` (from a Monthly Report row) opens that day once.
  const searchParams = useSearchParams();
  const linkedDate = useRef(isoDateParam(searchParams.get('date')));
  useEffect(() => {
    const linked = linkedDate.current;
    linkedDate.current = null;
    if (linked && linked <= businessToday) setDate(linked);
  }, [businessToday, setDate]);

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
  const expenseLabel = (category: string) => (te.has(`categories.${category}`) ? te(`categories.${category}` as Parameters<typeof te>[0]) : category);

  // The game club and the bar are separate businesses: one row each, never added together.
  const day = dayRange(date);
  const gameClubHref = moneyDetailsHref('game_club', day);
  const barHref = moneyDetailsHref('bar', day);
  const kpis = [
    { href: reportsHref(day, { category: 'income' }), label: t('manualIncome'), amount: manualIncome, icon: TrendingUp, tone: 'success' as const },
    { href: reportsHref(day, { category: 'debt_payment' }), label: t('debtIncome'), amount: debtIncome, icon: Users, tone: 'warning' as const },
    { href: reportsHref(day, { category: 'expense', source: 'game_club' }), label: t('gameClubExpenses'), amount: reportTotals.gameClubExpenses, icon: TrendingDown, tone: 'danger' as const },
    { href: gameClubHref, label: t('gameClubProfit'), amount: reportTotals.gameClubProfit, icon: DollarSign, tone: toneForAmount(reportTotals.gameClubProfit) },
    { href: closingStockHref(date), label: t('barSales'), amount: reportTotals.barSales, icon: TrendingUp, tone: 'success' as const },
    { href: closingStockHref(date), label: t('costOfGoodsSold'), amount: reportTotals.barCost, icon: TrendingDown, tone: 'danger' as const },
    { href: reportsHref(day, { category: 'expense', source: 'bar' }), label: t('barExpenses'), amount: reportTotals.barExpenses, icon: TrendingDown, tone: 'danger' as const },
    { href: barHref, label: t('barProfit'), amount: reportTotals.barProfit, icon: DollarSign, tone: toneForAmount(reportTotals.barProfit) },
    { href: barHref, label: t('inventoryPurchases'), amount: reportTotals.stockPurchaseCost, icon: TrendingDown, tone: 'danger' as const },
    { href: barHref, label: t('barCashLeft'), amount: reportTotals.barCashLeft, icon: DollarSign, tone: toneForAmount(reportTotals.barCashLeft) },
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
        tabs={<ReportsTabs value="day" />}
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
          <div className={cn(metricGridClassName, 'sm:grid-cols-2 sm:gap-4 lg:grid-cols-4')}>
            {kpis.map((kpi) => (
              <MetricCard key={kpi.label} href={kpi.href} label={kpi.label} value={<MetricMoney amount={kpi.amount} currency={currency} />} icon={kpi.icon} tone={kpi.tone} />
            ))}
          </div>
          <p className="text-xs text-gray-500">{t('barCashFormula')}</p>

          {cashEntry && (
            <Card>
              <SectionHeading size="sm" title={t('cashEntry')} />
              <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {cashBreakdown.map((item) => (
                  <StatTile key={item.label} href={reportsHref(day, { category: 'income' })} label={item.label} value={formatCurrency(item.amount)} unit={currency} variant="soft" size="sm" />
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
                mobileCards
                bare
                className="mt-3"
                label={t('stockSummary')}
                minWidth={680}
                keyExtractor={(row) => row.id}
                onRowClick={() => router.push(closingStockHref(date))}
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
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedExpense(e)}
                      className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-gray-50 focus-visible:bg-primary-50 focus-visible:outline-none"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:justify-between">
                        <span className="text-gray-600">
                          {expenseLabel(e.category)}
                          {e.comment ? ` · ${e.comment}` : ''}
                        </span>
                        <span className="font-medium text-danger-600"><Money amount={e.amount} /></span>
                      </span>
                      <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-gray-300" />
                    </button>
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

      <Modal open={Boolean(selectedExpense)} onClose={() => setSelectedExpense(null)} title={t('expenseDetails')}>
        {selectedExpense && (
          <PaymentDetails row={selectedExpense} labelFor={expenseLabel} locale={locale} currency={currency} />
        )}
      </Modal>
    </div>
  );
}
