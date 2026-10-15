import type { SupabaseClient } from '@supabase/supabase-js';
import type { StockPurchaseCostRow } from '@/lib/calculations/barMoney';
import type { ExpenseRow } from '@/lib/calculations/dashboardMetrics';
import { buildFinancialAnalysis, buildMonthlyAnalysis, type AnalysisLedgers } from '@/lib/calculations/financialAnalysis';
import {
  buildMoneyReport,
  type MoneyReportBarSalesRow,
  type MoneyReportCashRow,
  type MoneyReportDebtPaymentRow,
} from '@/lib/calculations/moneyReport';
import { fetchAnalysisLedgers } from '@/lib/supabase/analysisLedgers';
import { loadFinanceReportRows } from '@/lib/supabase/financeReportSnapshot';
import { isMissingDatabaseFunction } from '@/lib/supabase/errors';
import { fetchAllRows } from '@/lib/supabase/pagination';
import {
  categoriesTable,
  dailyTable,
  debtsTable,
  expensesTable,
  moneyTable,
  monthlyTable,
  productSalesTable,
  stockTable,
  summaryTable,
  RANGED_DATASETS,
  type AssistantDataset,
  type DataTable,
  type DebtInputRow,
  type StockInputRow,
} from './datasets';
import { clampMonths, resolveRange, trendWindow } from './ranges';

export interface AssistantDataContext {
  /** The member's own server client: RLS authorizes every read. */
  supabase: SupabaseClient;
  clubId: string;
  businessToday: string;
}

export interface DatasetQuery {
  dataset: AssistantDataset;
  from?: string;
  to?: string;
  months?: number;
  category?: string;
  debtStatus?: 'open' | 'paid' | 'all';
}

export class DatasetQueryError extends Error {}

interface MoneyReportRows {
  cash: MoneyReportCashRow[];
  expenses: ExpenseRow[];
  debtPayments: MoneyReportDebtPaymentRow[];
  barSales: MoneyReportBarSalesRow[];
  stockPurchases: StockPurchaseCostRow[];
}

/**
 * The Reports page's money rows: the get_money_report_snapshot RPC, or the
 * same ledgers read directly while migration 047 is not yet applied.
 */
async function fetchMoneyReportRows(
  supabase: SupabaseClient,
  clubId: string,
  range: { from: string; to: string },
): Promise<MoneyReportRows> {
  const snapshot = await supabase.rpc('get_money_report_snapshot', {
    p_club_id: clubId,
    p_range_from: range.from,
    p_range_to: range.to,
  });
  if (!snapshot.error) {
    const data = (snapshot.data ?? {}) as Partial<MoneyReportRows>;
    return {
      cash: data.cash ?? [],
      expenses: data.expenses ?? [],
      debtPayments: data.debtPayments ?? [],
      barSales: data.barSales ?? [],
      stockPurchases: data.stockPurchases ?? [],
    };
  }
  if (!isMissingDatabaseFunction(snapshot.error, 'get_money_report_snapshot')) throw new Error(snapshot.error.message);

  const [cash, expenses, debtPayments, barSales, stockPurchases] = await Promise.all([
    fetchAllRows<MoneyReportCashRow>(() => supabase
      .from('daily_cash_entries')
      .select('id,date,cash_income,terminal_income,card_income,playstation_income')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<ExpenseRow>(() => supabase
      .from('expenses')
      .select('id,date,amount,category,payment_method,payment_source,comment,created_at')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<MoneyReportDebtPaymentRow>(() => supabase
      .from('debt_payments')
      .select('id,date,amount,payment_method')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<MoneyReportBarSalesRow>(() => supabase
      .from('daily_stock_counts')
      .select('date,bar_income')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<StockPurchaseCostRow>(() => supabase
      .from('stock_purchases')
      .select('date,quantity,cost_price')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
  ]);
  const failed = [cash, expenses, debtPayments, barSales, stockPurchases].find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);
  return {
    cash: cash.data ?? [],
    expenses: expenses.data ?? [],
    debtPayments: debtPayments.data ?? [],
    barSales: barSales.data ?? [],
    stockPurchases: stockPurchases.data ?? [],
  };
}

/**
 * Reads one dataset for the selected club. Ledgers are cached per range for
 * the lifetime of one assistant request, so a summary and an export of the
 * same period share one database read.
 */
export function createDatasetLoader(context: AssistantDataContext) {
  const ledgerCache = new Map<string, Promise<AnalysisLedgers>>();

  function ledgers(range: { from: string; to: string }) {
    const key = `${range.from}|${range.to}`;
    let promise = ledgerCache.get(key);
    if (!promise) {
      promise = fetchAnalysisLedgers(context.supabase, context.clubId, range);
      ledgerCache.set(key, promise);
    }
    return promise;
  }

  function rangeFor(query: DatasetQuery) {
    const range = resolveRange(query.from, query.to, context.businessToday);
    if ('error' in range) throw new DatasetQueryError(range.error);
    return range;
  }

  async function load(query: DatasetQuery): Promise<{ table: DataTable; period?: { from: string; to: string } }> {
    const range = RANGED_DATASETS.has(query.dataset) ? rangeFor(query) : undefined;

    switch (query.dataset) {
      case 'summary':
      case 'daily':
      case 'categories':
      case 'expenses': {
        const rows = await ledgers(range!);
        if (query.dataset === 'expenses') return { table: expensesTable(rows.expenseRows, query.category), period: range };
        const analysis = buildFinancialAnalysis(range!, rows);
        if (query.dataset === 'summary') return { table: summaryTable(analysis), period: range };
        if (query.dataset === 'daily') return { table: dailyTable(analysis.daily), period: range };
        return { table: categoriesTable(analysis), period: range };
      }
      case 'money': {
        const rows = await fetchMoneyReportRows(context.supabase, context.clubId, range!);
        const report = buildMoneyReport(rows.cash, rows.expenses, rows.debtPayments, rows.barSales, rows.stockPurchases);
        return { table: moneyTable(report), period: range };
      }
      case 'monthly': {
        const months = clampMonths(query.months);
        const window = trendWindow(context.businessToday, months);
        const rows = await ledgers(window);
        return { table: monthlyTable(buildMonthlyAnalysis(context.businessToday, rows, months)), period: window };
      }
      case 'product_sales': {
        const result = await loadFinanceReportRows(context.supabase, context.clubId, range!.from, range!.to, 'day');
        if (result.error || !result.data) throw new Error(result.error?.message ?? 'Product sales read failed');
        return { table: productSalesTable(result.data.stockCountRows), period: range };
      }
      case 'stock': {
        const result = await fetchAllRows<StockInputRow>(() => context.supabase
          .from('products')
          .select('name,category,sale_price,current_stock,low_stock_threshold,tracks_inventory,is_active,is_deleted')
          .eq('club_id', context.clubId)
          .order('name', { ascending: true })
          .order('id', { ascending: true }));
        if (result.error) throw new Error(result.error.message);
        return { table: stockTable(result.data ?? []) };
      }
      case 'debts': {
        const status = query.debtStatus ?? 'open';
        const result = await fetchAllRows<DebtInputRow>(() => {
          let request = context.supabase
            .from('new_debts')
            .select('person_name,date,amount,paid_amount,status,comment')
            .eq('club_id', context.clubId);
          if (status === 'open') request = request.neq('status', 'paid');
          if (status === 'paid') request = request.eq('status', 'paid');
          return request.order('date', { ascending: true }).order('id', { ascending: true });
        });
        if (result.error) throw new Error(result.error.message);
        return { table: debtsTable(result.data ?? []) };
      }
    }
  }

  return { load };
}
