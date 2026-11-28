'use client';

// Route: /daily-report

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
  CategoryIcon,
  LoadErrorAlert,
  Modal,
  Money,
  PageHeader,
  SectionHeading,
  SkeletonStatus,
  StatTile,
  TappableSurface,
} from '@/components/PresentationFoundation';
import { ReportTotals } from '@/components/reports/ReportTotals';
import { DailyReportSkeleton } from './DailyReportSkeleton';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessPeriod } from '@/lib/useBusinessPeriod';
import { useClubQuery } from '@/lib/useClubQuery';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { isoDateParam } from '@/lib/utils';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { PaymentDetails } from '@/components/financial-analysis/PaymentDetails';
import { calculateFinancialReportTotals, calculateManualIncome, sumDebtIncome } from '@/lib/calculations/dailyReport';
import { canAccessPath } from '@/lib/permissions';
import { loadFinanceReportRows, type FinanceStockCountRow } from '@/lib/supabase/financeReportSnapshot';
import { fetchReserveMoves } from '@/lib/supabase/reserveMoves';
import type { ReserveMove } from '@/lib/calculations/reserveMoves';
import { ChevronRight, FileText } from 'lucide-react';
import type { DailyCashEntry, Expense, StockPurchase } from '@/types';
import { closingStockHref, dayRange, debtsHref, financialAnalysisHref, moneyDetailsHref, reportsHref } from '@/lib/detailLinks';

interface DailyReportData {
  cashEntry: DailyCashEntry | null;
  stockCounts: FinanceStockCountRow[];
  stockPurchases: StockPurchase[];
  expenses: Expense[];
  debtIncome: number;
  /** The day's owner reserve moves (156): bar cash left counts them as the dashboard does. */
  reserveMoves: ReserveMove[];
}

const EMPTY_REPORT: DailyReportData = { cashEntry: null, stockCounts: [], stockPurchases: [], expenses: [], debtIncome: 0, reserveMoves: [] };

export default function DailyReportPage() {
  const t = useTranslations('dailyReport');
  const tc = useTranslations('common');
  const te = useTranslations('expenses');
  const { selectedClubId, businessDayStartHour, role, featureAccess } = useClub();
  /** A figure opens its records only on a page this member may open. */
  const linkIfAllowed = (href: string) => (role && canAccessPath(role, featureAccess, href.split('?')[0]) ? href : undefined);

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
    const supabase = createClient();
    const [result, reserveMoves] = await Promise.all([
      loadFinanceReportRows(supabase, selectedClubId, date, date, 'day'),
      fetchReserveMoves(supabase, selectedClubId, date, date),
    ]);
    if (!result.data) throw new Error(result.error?.message);
    return {
      cashEntry: result.data.cashRows[0] ?? null,
      stockCounts: result.data.stockCountRows,
      stockPurchases: result.data.purchaseRows,
      expenses: result.data.expenseRows,
      debtIncome: sumDebtIncome(result.data.debtRows),
      reserveMoves,
    };
  }, [date, selectedClubId]);
  const report = useClubQuery<DailyReportData>(loadReport, EMPTY_REPORT);
  const { cashEntry, stockCounts, stockPurchases, expenses, debtIncome, reserveMoves } = report.data;
  const loading = report.loading;
  const loadError = report.error;

  const manualIncome = cashEntry ? calculateManualIncome(cashEntry) : 0;

  const reportTotals = calculateFinancialReportTotals({
    manualIncome,
    debtIncome,
    stockRows: stockCounts,
    purchaseRows: stockPurchases,
    expenseRows: expenses,
    reserveMoves,
  });

  // A bar reserve move alone still changes the day's bar cash left.
  const hasBarReserveMove = reserveMoves.some((move) => move.source === 'bar');
  const hasData = cashEntry !== null || stockCounts.length > 0 || stockPurchases.length > 0 || expenses.length > 0 || debtIncome > 0 || hasBarReserveMove;
  const currency = tc('currency');
  const expenseLabel = (category: string) => (te.has(`categories.${category}`) ? te(`categories.${category}` as Parameters<typeof te>[0]) : category);

  // The game club and the bar are separate businesses: one row each, never added together.
  const day = dayRange(date);
  // Profit is accounting profit: Financial Analysis of the day's month explains it. Money
  // details explain cash left, a different figure, so only the bar's cash figures open them.
  const profitHref = linkIfAllowed(financialAnalysisHref(date.slice(0, 7)));
  const barHref = linkIfAllowed(moneyDetailsHref('bar', day));
  const stockHref = linkIfAllowed(closingStockHref(date));
  const incomeHref = linkIfAllowed(reportsHref(day, { category: 'income' }));
  const totalFigures = {
    manualIncome: { href: incomeHref, label: t('manualIncome'), amount: manualIncome },
    // Debt income is new debt principal, not payments: it opens the debts themselves.
    debtIncome: { href: linkIfAllowed(debtsHref()), label: t('debtIncome'), amount: debtIncome },
    gameClubExpenses: { href: linkIfAllowed(reportsHref(day, { category: 'expense', source: 'game_club' })), label: t('gameClubExpenses'), amount: reportTotals.gameClubExpenses },
    gameClubProfit: { href: profitHref, label: t('gameClubProfit'), amount: reportTotals.gameClubProfit },
    barSales: { href: stockHref, label: t('barSales'), amount: reportTotals.barSales },
    costOfGoodsSold: { href: stockHref, label: t('costOfGoodsSold'), amount: reportTotals.barCost },
    barExpenses: { href: linkIfAllowed(reportsHref(day, { category: 'expense', source: 'bar' })), label: t('barExpenses'), amount: reportTotals.barExpenses },
    barProfit: { href: profitHref, label: t('barProfit'), amount: reportTotals.barProfit },
    inventoryPurchases: { href: barHref, label: t('inventoryPurchases'), amount: reportTotals.stockPurchaseCost },
    barCashLeft: { href: barHref, label: t('barCashLeft'), amount: reportTotals.barCashLeft },
  };

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
        action={<DatePicker ariaLabel={t('date')} value={date} max={businessToday} onChange={setDate} className="sm:w-64" />}
      />

      {loadError && (
        <LoadErrorAlert className="mb-4" retrying={loading} onRetry={() => void report.reload()}>
          {t('loadError')}
        </LoadErrorAlert>
      )}

      {loading ? (
        <SkeletonStatus><DailyReportSkeleton /></SkeletonStatus>
      ) : loadError ? null : !hasData ? (
        <Card><EmptyState icon={FileText} title={t('noData')} /></Card>
      ) : (
        <div className="space-y-6">
          <ReportTotals figures={totalFigures} currency={currency} barNote={t('barCashFormula')} />

          {cashEntry && (
            <Card>
              <SectionHeading size="sm" title={t('cashEntry')} />
              <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {cashBreakdown.map((item) => (
                  <StatTile key={item.label} href={incomeHref} label={item.label} value={formatCurrency(item.amount)} unit={currency} variant="soft" size="sm" />
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
                onRowClick={stockHref ? () => router.push(stockHref) : undefined}
                data={stockCounts}
                columns={[
                  { key: 'product', header: t('product'), sticky: true, render: (row) => <span className="font-medium text-gray-900">{row.product_name ?? row.product_id}</span> },
                  { key: 'sold', header: t('sold'), align: 'right', render: (row) => formatNumber(row.sold_quantity) },
                  { key: 'income', header: t('barSales'), align: 'right', render: (row) => <span className="text-success-600">{formatCurrency(row.bar_income)}</span> },
                  { key: 'cost', header: t('costOfGoodsSold'), align: 'right', render: (row) => <span className="text-danger-600">{formatCurrency(row.bar_cost)}</span> },
                  { key: 'profit', header: t('grossProfit'), align: 'right', render: (row) => <Money amount={row.bar_profit} currency={null} signed className={row.bar_profit >= 0 ? 'font-medium text-success-600' : 'font-medium'} /> },
                ]}
                footer={{
                  product: tc('total'),
                  sold: formatNumber(reportTotals.barUnitsSold),
                  income: <span className="text-success-600">{formatCurrency(reportTotals.barSales)}</span>,
                  cost: <span className="text-danger-600">{formatCurrency(reportTotals.barCost)}</span>,
                  profit: <Money amount={reportTotals.barGrossProfit} currency={null} signed className={reportTotals.barGrossProfit >= 0 ? 'text-success-600' : undefined} />,
                }}
              />
            </Card>
          )}

          {expenses.length > 0 && (
            <Card>
              <SectionHeading size="sm" title={t('expensesList')} />
              <ul className="mt-3 divide-y divide-gray-100">
                {expenses.map((e) => (
                  <li key={e.id} className="-mx-2">
                    <TappableSurface chevron={false} onClick={() => setSelectedExpense(e)} className="rounded-lg px-2 py-2 text-sm">
                      <span className="flex items-center gap-3">
                      <CategoryIcon category={e.category} tone={e.payment_source === 'bar' ? 'bar' : 'expense'} size="sm" />
                      <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:justify-between">
                        <span className="text-gray-600">
                          {expenseLabel(e.category)}
                          {e.comment ? ` · ${e.comment}` : ''}
                        </span>
                        <span className="font-medium text-danger-600"><Money amount={e.amount} /></span>
                      </span>
                      <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-gray-300" />
                      </span>
                    </TappableSurface>
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
