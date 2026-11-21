'use client';

// Route: /monthly-report

import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useClub } from '@/components/layout/DashboardShell';
import { ReportsTabs } from '../reports/ReportsTabs';
import {
  Card,
  DataTable,
  EmptyState,
  Button,
  LoadErrorAlert,
  MonthPicker,
  PageHeader,
  SkeletonStatus,
} from '@/components/PresentationFoundation';
import { ReportTotals } from '../reports/ReportTotals';
import { MonthlyReportSkeleton } from './MonthlyReportSkeleton';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { monthRange } from '@/lib/utils';
import { useBusinessToday } from '@/lib/useBusinessToday';
import { useBusinessPeriod } from '@/lib/useBusinessPeriod';
import { useClubQuery } from '@/lib/useClubQuery';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { calculateFinancialReportTotals, calculateManualIncome, sumDebtIncome } from '@/lib/calculations/dailyReport';
import { canAccessPath } from '@/lib/permissions';
import { loadFinanceReportRows, type FinanceReportRows } from '@/lib/supabase/financeReportSnapshot';
import { BarChart2, Download } from 'lucide-react';
import { csvFileName, csvSeparatorForLocale, downloadCsv, toCsv } from '@/lib/csv';
import { dailyReportHref, moneyDetailsHref, reportsHref } from '@/lib/detailLinks';

interface DayRow {
  date: string;
  manualIncome: number;
  barSales: number;
  debtIncome: number;
  /** Entered income plus debt income. */
  gameClubIncome: number;
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
  gameClubIncome: 0,
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
    const debtIncome = sumDebtIncome(debtsByDate.get(date) ?? []);
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
      gameClubIncome: totals.gameClubIncome,
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
  const { selectedClubId, businessDayStartHour, role, featureAccess } = useClub();
  /** A figure or a day opens its records only on a page this member may open. */
  const linkIfAllowed = (href: string) => (role && canAccessPath(role, featureAccess, href.split('?')[0]) ? href : undefined);
  const { locale } = useAppLocale();
  // Business dates are ISO strings, so the business month is their YYYY-MM prefix.
  const businessYearMonth = useBusinessToday(businessDayStartHour).slice(0, 7);
  const [month, setMonth] = useBusinessPeriod(businessYearMonth, selectedClubId);
  const router = useRouter();

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
      gameClubIncome: sum.gameClubIncome + row.gameClubIncome,
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

  /** The table as shown: one row per day, then the totals row. */
  function exportMonth() {
    // Bar costs are weighted averages with long fractions: two decimals are plenty in a file.
    const cells = (row: DayTotals) => [
      row.manualIncome, row.debtIncome, row.gameClubExpenses, row.gameClubProfit, row.barSales,
      row.barCost, row.barExpenses, row.barProfit, row.stockPurchaseCost, row.barCashLeft,
    ].map((amount) => Math.round(amount * 100) / 100);
    const headers = [
      t('date'), t('manualIncome'), t('debtIncome'), t('gameClubExpenses'), t('gameClubProfit'), t('barSales'),
      t('costOfGoodsSold'), t('barExpenses'), t('barProfit'), t('inventoryPurchases'), t('barCashLeft'),
    ];
    const body = [...rows.map((row) => [row.date, ...cells(row)]), [t('totals'), ...cells(totals)]];
    const { from, to } = monthRange(month);
    downloadCsv(csvFileName('monthly-report', from, to), toCsv(headers, body, csvSeparatorForLocale(locale)));
  }
  const signed = (amount: number) => (
    <span className={amount >= 0 ? 'font-semibold text-success-600' : 'font-semibold text-danger-600'}>{formatCurrency(amount)}</span>
  );
  const danger = (amount: number) => <span className="text-danger-600">{formatCurrency(amount)}</span>;

  // The game club and the bar are separate businesses: one row each, never added together.
  const monthBounds = monthRange(month);
  const gameClubHref = linkIfAllowed(moneyDetailsHref('game_club', monthBounds));
  const barHref = linkIfAllowed(moneyDetailsHref('bar', monthBounds));
  const totalFigures = {
    gameClubIncome: { href: gameClubHref, label: t('gameClubIncome'), amount: totals.gameClubIncome },
    gameClubExpenses: { href: linkIfAllowed(reportsHref(monthBounds, { category: 'expense', source: 'game_club' })), label: t('gameClubExpenses'), amount: totals.gameClubExpenses },
    gameClubProfit: { href: gameClubHref, label: t('gameClubProfit'), amount: totals.gameClubProfit },
    barSales: { href: barHref, label: t('barSales'), amount: totals.barSales },
    costOfGoodsSold: { href: barHref, label: t('costOfGoodsSold'), amount: totals.barCost },
    barExpenses: { href: linkIfAllowed(reportsHref(monthBounds, { category: 'expense', source: 'bar' })), label: t('barExpenses'), amount: totals.barExpenses },
    barProfit: { href: barHref, label: t('barProfit'), amount: totals.barProfit },
    inventoryPurchases: { href: barHref, label: t('inventoryPurchases'), amount: totals.stockPurchaseCost },
    barCashLeft: { href: barHref, label: t('barCashLeft'), amount: totals.barCashLeft },
  };

  return (
    <div>
      <PageHeader
        title={t('title')}
        tabs={<ReportsTabs value="month" />}
        action={(
          <>
            <Button variant="outline" onClick={exportMonth} disabled={loading || rows.length === 0} icon={<Download size={16} aria-hidden="true" />}>
              {tc('export')}
            </Button>
            <MonthPicker value={month} max={businessYearMonth} onChange={setMonth} className="sm:w-64" />
          </>
        )}
      />

      {loadError && (
        <LoadErrorAlert className="mb-4" retrying={loading} onRetry={() => void report.reload()}>
          {t('loadError')}
        </LoadErrorAlert>
      )}

      {loading ? (
        <SkeletonStatus><MonthlyReportSkeleton /></SkeletonStatus>
      ) : loadError ? null : rows.length === 0 ? (
        <Card><EmptyState icon={BarChart2} title={t('noData')} /></Card>
      ) : (
        <div className="space-y-4">
          <ReportTotals figures={totalFigures} currency={currency} barNote={t('barCashFormula')} />

          {/* Compared across rows, so phones keep the wide scrolling table (PresentationFoundation README). */}
          <DataTable
            stickyHeader
            label={t('title')}
            minWidth={1460}
            keyExtractor={(row) => row.date}
            onRowClick={linkIfAllowed(dailyReportHref('')) ? (row) => router.push(dailyReportHref(row.date)) : undefined}
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
