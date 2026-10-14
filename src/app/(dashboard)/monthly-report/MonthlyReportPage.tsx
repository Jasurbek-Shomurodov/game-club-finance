'use client';

// Route: /monthly-report

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { createClient } from '@/lib/supabase/client';
import { useClub } from '@/components/layout/DashboardShell';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  InlineAlert,
  MetricCard,
  MetricGridSkeleton,
  MonthPicker,
  PageHeader,
  TableSkeleton,
  toneForAmount,
  MetricMoney,
} from '@/components/PresentationFoundation';
import { useAppLocale } from '@/components/i18n/AppLocaleContext';
import { currentYearMonth, monthRange } from '@/lib/utils';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { calculateFinancialReportTotals } from '@/lib/calculations/dailyReport';
import { calculateGameClubIncome } from '@/lib/calculations/dailyCash';
import { fetchFinanceReportSnapshot } from '@/lib/supabase/financeReportSnapshot';
import { fetchAllRows } from '@/lib/supabase/pagination';
import { BarChart2, RefreshCcw } from 'lucide-react';

interface DayRow {
  date: string;
  manualIncome: number;
  barSales: number;
  debtIncome: number;
  totalIncome: number;
  barCost: number;
  stockPurchaseCost: number;
  barExpenses: number;
  expenses: number;
  barCashLeft: number;
  accountingNetProfit: number;
}

type DayTotals = Omit<DayRow, 'date'>;

const emptyTotals: DayTotals = {
  manualIncome: 0,
  barSales: 0,
  debtIncome: 0,
  totalIncome: 0,
  barCost: 0,
  stockPurchaseCost: 0,
  barExpenses: 0,
  expenses: 0,
  barCashLeft: 0,
  accountingNetProfit: 0,
};

interface MonthlyCashRow {
  date: string;
  cash_income: number;
  terminal_income: number;
  card_income: number;
  playstation_income: number | null;
}

interface MonthlyAmountRow {
  date: string;
  amount: number;
}

interface MonthlyStockRow {
  date: string;
  bar_income: number;
  bar_cost: number;
}

interface MonthlyPurchaseRow {
  date: string;
  quantity: number;
  cost_price: number;
}

interface MonthlyExpenseRow extends MonthlyAmountRow {
  payment_source: 'game_club' | 'bar' | null;
}

function groupRowsByDate<T extends { date: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const rows = grouped.get(item.date);
    if (rows) rows.push(item);
    else grouped.set(item.date, [item]);
  }
  return grouped;
}

export default function MonthlyReportPage() {
  const t = useTranslations('monthlyReport');
  const tc = useTranslations('common');
  const { selectedClubId, businessDayStartHour } = useClub();
  const { locale } = useAppLocale();
  const businessYearMonth = useMemo(() => currentYearMonth(new Date(), businessDayStartHour), [businessDayStartHour]);
  const [month, setMonth] = useState(() => businessYearMonth);
  const [rows, setRows] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const requestSequence = useRef(0);

  const fetchData = useCallback(async (selectedMonth: string) => {
    const requestId = ++requestSequence.current;

    if (!selectedClubId) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(false);
    const supabase = createClient();
    const { from, to } = monthRange(selectedMonth);

    const snapshotResult = await fetchFinanceReportSnapshot(
      supabase,
      selectedClubId,
      from,
      to,
      ['cash', 'stock_totals', 'purchases', 'expenses', 'debts'],
    );

    if (requestId !== requestSequence.current) return;

    if (snapshotResult.error) {
      setRows([]);
      setLoadError(true);
      setLoading(false);
      return;
    }

    let cashEntries: MonthlyCashRow[];
    let stockCounts: MonthlyStockRow[];
    let stockPurchases: MonthlyPurchaseRow[];
    let expenses: MonthlyExpenseRow[];
    let debts: MonthlyAmountRow[];

    if (snapshotResult.data) {
      cashEntries = snapshotResult.data.cashRows;
      stockCounts = snapshotResult.data.stockTotalRows;
      stockPurchases = snapshotResult.data.purchaseRows;
      expenses = snapshotResult.data.expenseRows;
      debts = snapshotResult.data.debtRows;
    } else {
      // Compatibility path while migration 049 is being deployed.
      const [cashRes, stockRes, purchaseRes, expRes, debtRes] = await Promise.all([
        fetchAllRows<MonthlyCashRow>(() => supabase
          .from('daily_cash_entries')
          .select('date,cash_income,terminal_income,card_income,playstation_income')
          .eq('club_id', selectedClubId)
          .gte('date', from)
          .lte('date', to)
          .order('date', { ascending: true })),
        fetchAllRows<MonthlyStockRow>(() => supabase
          .from('daily_stock_counts')
          .select('date,bar_income,bar_cost')
          .eq('club_id', selectedClubId)
          .gte('date', from)
          .lte('date', to)
          .order('date', { ascending: true })
          .order('product_id', { ascending: true })),
        fetchAllRows<MonthlyPurchaseRow>(() => supabase
          .from('stock_purchases')
          .select('date,quantity,cost_price')
          .eq('club_id', selectedClubId)
          .gte('date', from)
          .lte('date', to)
          .order('date', { ascending: true })
          .order('id', { ascending: true })),
        fetchAllRows<MonthlyExpenseRow>(() => supabase
          .from('expenses')
          .select('date,amount,payment_source')
          .eq('club_id', selectedClubId)
          .gte('date', from)
          .lte('date', to)
          .order('date', { ascending: true })
          .order('id', { ascending: true })),
        fetchAllRows<MonthlyAmountRow>(() => supabase
          .from('new_debts')
          .select('date,amount')
          .eq('club_id', selectedClubId)
          .gte('date', from)
          .lte('date', to)
          .order('date', { ascending: true })
          .order('id', { ascending: true })),
      ]);

      if (requestId !== requestSequence.current) return;

      const firstError = [cashRes, stockRes, purchaseRes, expRes, debtRes]
        .find((result) => result.error)?.error;
      if (firstError) {
        setRows([]);
        setLoadError(true);
        setLoading(false);
        return;
      }

      cashEntries = (cashRes.data ?? []) as MonthlyCashRow[];
      stockCounts = (stockRes.data ?? []) as MonthlyStockRow[];
      stockPurchases = (purchaseRes.data ?? []) as MonthlyPurchaseRow[];
      expenses = (expRes.data ?? []) as MonthlyExpenseRow[];
      debts = (debtRes.data ?? []) as MonthlyAmountRow[];
    }

    const cashByDate = groupRowsByDate(cashEntries);
    const stockByDate = groupRowsByDate(stockCounts);
    const purchasesByDate = groupRowsByDate(stockPurchases);
    const expensesByDate = groupRowsByDate(expenses);
    const debtsByDate = groupRowsByDate(debts);
    const datesSet = new Set<string>([
      ...cashByDate.keys(),
      ...stockByDate.keys(),
      ...purchasesByDate.keys(),
      ...expensesByDate.keys(),
      ...debtsByDate.keys(),
    ]);
    const dates = Array.from(datesSet).sort().reverse();

    const dayRows: DayRow[] = dates.map((date) => {
      const cashEntry = cashByDate.get(date)?.[0];
      const manualIncome = cashEntry
        ? calculateGameClubIncome({
            cashIncome: cashEntry.cash_income,
            terminalIncome: cashEntry.terminal_income,
            cardIncome: cashEntry.card_income,
            playstationIncome: cashEntry.playstation_income ?? 0,
          })
        : 0;
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
        totalIncome: totals.totalIncome,
        barCost: totals.barCost,
        stockPurchaseCost: totals.stockPurchaseCost,
        barExpenses: totals.barExpenses,
        expenses: totals.totalExpenses,
        barCashLeft: totals.barCashLeft,
        accountingNetProfit: totals.accountingNetProfit,
      };
    });

    setRows(dayRows);
    setLoadError(false);
    setLoading(false);
  }, [selectedClubId]);

  useEffect(() => {
    fetchData(month).catch(() => {
      setRows([]);
      setLoadError(true);
      setLoading(false);
    });
    return () => { requestSequence.current += 1; };
  }, [month, fetchData, reloadToken]);

  useEffect(() => {
    setMonth(businessYearMonth);
  }, [businessYearMonth, selectedClubId]);

  const totals = useMemo(
    () => rows.reduce<DayTotals>((sum, row) => ({
      manualIncome: sum.manualIncome + row.manualIncome,
      barSales: sum.barSales + row.barSales,
      debtIncome: sum.debtIncome + row.debtIncome,
      totalIncome: sum.totalIncome + row.totalIncome,
      barCost: sum.barCost + row.barCost,
      stockPurchaseCost: sum.stockPurchaseCost + row.stockPurchaseCost,
      barExpenses: sum.barExpenses + row.barExpenses,
      expenses: sum.expenses + row.expenses,
      barCashLeft: sum.barCashLeft + row.barCashLeft,
      accountingNetProfit: sum.accountingNetProfit + row.accountingNetProfit,
    }), emptyTotals),
    [rows],
  );
  const currency = tc('currency');
  const signed = (amount: number) => (
    <span className={amount >= 0 ? 'font-semibold text-success-600' : 'font-semibold text-danger-600'}>{formatCurrency(amount)}</span>
  );
  const danger = (amount: number) => <span className="text-danger-600">{formatCurrency(amount)}</span>;

  const summaryCards = [
    { label: t('totalIncome'), amount: totals.totalIncome, tone: 'success' as const },
    { label: t('costOfGoodsSold'), amount: totals.barCost, tone: 'danger' as const },
    { label: t('inventoryPurchases'), amount: totals.stockPurchaseCost, tone: 'danger' as const },
    { label: t('barExpenses'), amount: totals.barExpenses, tone: 'danger' as const },
    { label: t('expenses'), amount: totals.expenses, tone: 'danger' as const },
    { label: t('barCashLeft'), amount: totals.barCashLeft, tone: toneForAmount(totals.barCashLeft) },
    { label: t('accountingNetProfit'), amount: totals.accountingNetProfit, tone: toneForAmount(totals.accountingNetProfit) },
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
        <div className="space-y-4">
          <MetricGridSkeleton count={7} className="lg:grid-cols-4" />
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
              { key: 'manualIncome', header: t('gameClubIncome'), align: 'right', render: (row) => formatCurrency(row.manualIncome) },
              { key: 'barSales', header: t('barSales'), align: 'right', render: (row) => formatCurrency(row.barSales) },
              { key: 'debtIncome', header: t('debtIncome'), align: 'right', render: (row) => <span className="text-warning-600">{formatCurrency(row.debtIncome)}</span> },
              { key: 'totalIncome', header: t('totalIncome'), align: 'right', render: (row) => <span className="font-medium text-success-600">{formatCurrency(row.totalIncome)}</span> },
              { key: 'barCost', header: t('costOfGoodsSold'), align: 'right', render: (row) => danger(row.barCost) },
              { key: 'stockPurchaseCost', header: t('inventoryPurchases'), align: 'right', render: (row) => danger(row.stockPurchaseCost) },
              { key: 'barExpenses', header: t('barExpenses'), align: 'right', render: (row) => danger(row.barExpenses) },
              { key: 'expenses', header: t('expenses'), align: 'right', render: (row) => danger(row.expenses) },
              { key: 'barCashLeft', header: t('barCashLeft'), align: 'right', render: (row) => signed(row.barCashLeft) },
              { key: 'accountingNetProfit', header: t('accountingNetProfit'), align: 'right', render: (row) => signed(row.accountingNetProfit) },
            ]}
            footer={{
              date: t('totals'),
              manualIncome: formatCurrency(totals.manualIncome),
              barSales: formatCurrency(totals.barSales),
              debtIncome: <span className="text-warning-600">{formatCurrency(totals.debtIncome)}</span>,
              totalIncome: <span className="text-success-600">{formatCurrency(totals.totalIncome)}</span>,
              barCost: danger(totals.barCost),
              stockPurchaseCost: danger(totals.stockPurchaseCost),
              barExpenses: danger(totals.barExpenses),
              expenses: danger(totals.expenses),
              barCashLeft: signed(totals.barCashLeft),
              accountingNetProfit: signed(totals.accountingNetProfit),
            }}
          />
        </div>
      )}
    </div>
  );
}
