'use client';

// Route: /monthly-report

import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Card,
  DataTable,
  EmptyState,
  Field,
  LoadErrorAlert,
  MetricCard,
  MetricGridSkeleton,
  MonthPicker,
  PageHeader,
  TableSkeleton,
  toneForAmount,
  MetricMoney,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { monthRange } from '@/lib/utils';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessPeriod } from '@/lib/useBusinessPeriod';
import { useClubQuery } from '@/lib/useClubQuery';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { calculateFinancialReportTotals, calculateManualIncome } from '@/lib/calculations/dailyReport';
import { loadFinanceReportRows, type FinanceReportRows } from '@/lib/supabase/financeReportSnapshot';
import { BarChart2 } from 'lucide-react';

interface DayRow {
  date: string;
  manualIncome: number;
  barSales: number;
  debtIncome: number;
  gameClubExpenses: number;
  gameClubProfit: number;
  barCost: number;
  stockPurchaseCost: number;
  barExpenses: number;
  barCashLeft: number;
  barProfit: number;
}

type DayTotals = Omit<DayRow, 'date'>;

const emptyTotals: DayTotals = {
  manualIncome: 0,
  barSales: 0,
  debtIncome: 0,
  gameClubExpenses: 0,
  gameClubProfit: 0,
  barCost: 0,
  stockPurchaseCost: 0,
  barExpenses: 0,
  barCashLeft: 0,
  barProfit: 0,
};

function groupRowsByDate<T extends { date: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const rows = grouped.get(item.date);
    if (rows) rows.push(item);
    else grouped.set(item.date, [item]);
  }
  return grouped;
}

/** One report row per date that has any cash, stock, purchase, expense, or debt activity, newest first. */
function buildDayRows(data: FinanceReportRows): DayRow[] {
  const cashByDate = groupRowsByDate(data.cashRows);
  const stockByDate = groupRowsByDate(data.stockTotalRows);
  const purchasesByDate = groupRowsByDate(data.purchaseRows);
  const expensesByDate = groupRowsByDate(data.expenseRows);
  const debtsByDate = groupRowsByDate(data.debtRows);
  const datesSet = new Set<string>([
    ...cashByDate.keys(),
    ...stockByDate.keys(),
    ...purchasesByDate.keys(),
    ...expensesByDate.keys(),
    ...debtsByDate.keys(),
  ]);
  const dates = Array.from(datesSet).sort().reverse();

  return dates.map((date) => {
    const cashEntry = cashByDate.get(date)?.[0];
    const manualIncome = cashEntry ? calculateManualIncome(cashEntry) : 0;
    const debtIncome = (debtsByDate.get(date) ?? [])
      .reduce((sum, debt) => sum + Number(debt.amount ?? 0), 0);
    const totals = calculateFinancialReportTotals({
      manualIncome,
      debtIncome,
      stockRows: stockByDate.get(date) ?? [],
      purchaseRows: purchasesByDate.get(date) ?? [],
      expenseRows: expensesByDate.get(date) ?? [],
    });
    return {
      date,
      manualIncome,
      barSales: totals.barSales,
      debtIncome,
      gameClubExpenses: totals.gameClubExpenses,
      gameClubProfit: totals.gameClubProfit,
      barCost: totals.barCost,
      stockPurchaseCost: totals.stockPurchaseCost,
      barExpenses: totals.barExpenses,
      barCashLeft: totals.barCashLeft,
      barProfit: totals.barProfit,
    };
  });
}

export default function MonthlyReportPage() {
  const t = useTranslations('monthlyReport');
  const tc = useTranslations('common');
  const { selectedClubId, businessDayStartHour } = useClub();
  const { locale } = useAppLocale();
  // Business dates are ISO strings, so the business month is their YYYY-MM prefix.
  const businessYearMonth = useBusinessToday(businessDayStartHour).slice(0, 7);
  const [month, setMonth] = useBusinessPeriod(businessYearMonth, selectedClubId);

  const loadRows = useCallback(async () => {
    if (!selectedClubId) return [];
    const { from, to } = monthRange(month);
    const result = await loadFinanceReportRows(createClient(), selectedClubId, from, to, 'range');
    if (!result.data) throw new Error(result.error?.message);
    return buildDayRows(result.data);
  }, [month, selectedClubId]);
  const report = useClubQuery<DayRow[]>(loadRows, []);
  const rows = report.data;
  const loading = report.loading;
  const loadError = report.error;

  const totals = useMemo(
    () => rows.reduce<DayTotals>((sum, row) => ({
      manualIncome: sum.manualIncome + row.manualIncome,
      barSales: sum.barSales + row.barSales,
      debtIncome: sum.debtIncome + row.debtIncome,
      gameClubExpenses: sum.gameClubExpenses + row.gameClubExpenses,
      gameClubProfit: sum.gameClubProfit + row.gameClubProfit,
      barCost: sum.barCost + row.barCost,
      stockPurchaseCost: sum.stockPurchaseCost + row.stockPurchaseCost,
      barExpenses: sum.barExpenses + row.barExpenses,
      barCashLeft: sum.barCashLeft + row.barCashLeft,
      barProfit: sum.barProfit + row.barProfit,
    }), emptyTotals),
    [rows],
  );
  const currency = tc('currency');
  const signed = (amount: number) => (
    <span className={amount >= 0 ? 'font-semibold text-success-600' : 'font-semibold text-danger-600'}>{formatCurrency(amount)}</span>
  );
  const danger = (amount: number) => <span className="text-danger-600">{formatCurrency(amount)}</span>;

  // The game club and the bar are separate businesses: one row each, never added together.
  const summaryCards = [
    { label: t('gameClubIncome'), amount: totals.manualIncome + totals.debtIncome, tone: 'success' as const },
    { label: t('gameClubExpenses'), amount: totals.gameClubExpenses, tone: 'danger' as const },
    { label: t('gameClubProfit'), amount: totals.gameClubProfit, tone: toneForAmount(totals.gameClubProfit) },
    { label: t('inventoryPurchases'), amount: totals.stockPurchaseCost, tone: 'danger' as const },
    { label: t('barSales'), amount: totals.barSales, tone: 'success' as const },
    { label: t('costOfGoodsSold'), amount: totals.barCost, tone: 'danger' as const },
    { label: t('barExpenses'), amount: totals.barExpenses, tone: 'danger' as const },
    { label: t('barProfit'), amount: totals.barProfit, tone: toneForAmount(totals.barProfit) },
    { label: t('barCashLeft'), amount: totals.barCashLeft, tone: toneForAmount(totals.barCashLeft) },
  ];

  return (
    <div>
      <PageHeader
        title={t('title')}
        action={(
          <Field label={t('selectMonth')} className="sm:w-72">
            <MonthPicker value={month} max={businessYearMonth} onChange={setMonth} />
          </Field>
        )}
      />

      {loadError && (
        <LoadErrorAlert className="mb-4" retrying={loading} onRetry={() => void report.reload()}>
          {t('loadError')}
        </LoadErrorAlert>
      )}

      {loading ? (
        <div className="space-y-4">
          <MetricGridSkeleton count={9} className="lg:grid-cols-4" />
          <TableSkeleton rows={8} columns={11} />
        </div>
      ) : loadError ? null : rows.length === 0 ? (
        <Card><EmptyState icon={BarChart2} title={t('noData')} /></Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {summaryCards.map((card) => (
              <MetricCard key={card.label} label={card.label} value={<MetricMoney amount={card.amount} currency={currency} />} tone={card.tone} />
            ))}
          </div>
          <p className="text-xs text-gray-500">{t('barCashFormula')}</p>

          <DataTable
            stickyHeader
            label={t('title')}
            minWidth={1460}
            keyExtractor={(row) => row.date}
            data={rows}
            columns={[
              { key: 'date', header: t('date'), className: 'sticky left-0 z-[25] bg-gray-50', cellClassName: 'z-10 bg-surface', render: (row) => <span className="font-medium text-gray-700">{formatDate(row.date, locale)}</span> },
              { key: 'manualIncome', header: t('manualIncome'), align: 'right', render: (row) => formatCurrency(row.manualIncome) },
              { key: 'debtIncome', header: t('debtIncome'), align: 'right', render: (row) => <span className="text-warning-600">{formatCurrency(row.debtIncome)}</span> },
              { key: 'gameClubExpenses', header: t('gameClubExpenses'), align: 'right', render: (row) => danger(row.gameClubExpenses) },
              { key: 'gameClubProfit', header: t('gameClubProfit'), align: 'right', render: (row) => signed(row.gameClubProfit) },
              { key: 'barSales', header: t('barSales'), align: 'right', render: (row) => formatCurrency(row.barSales) },
              { key: 'barCost', header: t('costOfGoodsSold'), align: 'right', render: (row) => danger(row.barCost) },
              { key: 'barExpenses', header: t('barExpenses'), align: 'right', render: (row) => danger(row.barExpenses) },
              { key: 'barProfit', header: t('barProfit'), align: 'right', render: (row) => signed(row.barProfit) },
              { key: 'stockPurchaseCost', header: t('inventoryPurchases'), align: 'right', render: (row) => danger(row.stockPurchaseCost) },
              { key: 'barCashLeft', header: t('barCashLeft'), align: 'right', render: (row) => signed(row.barCashLeft) },
            ]}
            footer={{
              date: t('totals'),
              manualIncome: formatCurrency(totals.manualIncome),
              debtIncome: <span className="text-warning-600">{formatCurrency(totals.debtIncome)}</span>,
              gameClubExpenses: danger(totals.gameClubExpenses),
              gameClubProfit: signed(totals.gameClubProfit),
              barSales: formatCurrency(totals.barSales),
              barCost: danger(totals.barCost),
              barExpenses: danger(totals.barExpenses),
              barProfit: signed(totals.barProfit),
              stockPurchaseCost: danger(totals.stockPurchaseCost),
              barCashLeft: signed(totals.barCashLeft),
            }}
          />
        </div>
      )}
    </div>
  );
}
