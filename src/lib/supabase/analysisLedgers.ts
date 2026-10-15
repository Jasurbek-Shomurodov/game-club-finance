import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DailyCashRow,
  DebtPaymentValueRow,
  DebtValueRow,
  ExpenseRow,
  StockCountRow,
} from '@/lib/calculations/dashboardMetrics';
import type { AnalysisLedgers } from '@/lib/calculations/financialAnalysis';
import { fetchFinanceReportSnapshot, type FinanceReportSection } from './financeReportSnapshot';
import { fetchAllRows } from './pagination';

const ANALYSIS_SECTIONS: FinanceReportSection[] = ['cash', 'stock_totals', 'expenses', 'debts', 'debt_payments'];

/**
 * Reads every ledger the analysis needs for one date window, scoped to the
 * club. Bar sales arrive as per-day totals from get_finance_report_snapshot;
 * per-product stock counts are read only when that RPC is not deployed yet.
 */
export async function fetchAnalysisLedgers(
  supabase: SupabaseClient,
  clubId: string,
  range: { from: string; to: string },
): Promise<AnalysisLedgers> {
  const snapshot = await fetchFinanceReportSnapshot(supabase, clubId, range.from, range.to, ANALYSIS_SECTIONS);
  if (snapshot.error) throw snapshot.error;
  if (snapshot.data) {
    return {
      cashRows: snapshot.data.cashRows,
      // The analysis reads only sales and cost of goods sold from these rows.
      stockRows: snapshot.data.stockTotalRows.map((row) => ({
        date: row.date,
        bar_income: Number(row.bar_income ?? 0),
        bar_cost: Number(row.bar_cost ?? 0),
        bar_profit: Number(row.bar_income ?? 0) - Number(row.bar_cost ?? 0),
        sold_quantity: 0,
      })),
      purchaseRows: [],
      expenseRows: snapshot.data.expenseRows.map((row) => ({ ...row, payment_source: row.payment_source ?? null })),
      // Debts count as income on their issue date; balances are not used here.
      debtRows: snapshot.data.debtRows.map((row) => ({ ...row, remaining_amount: 0, status: 'unknown' })),
      debtPaymentRows: snapshot.data.debtPaymentRows,
    };
  }

  // Compatibility path while migration 049 is being deployed.
  const [cashRes, stockRes, expenseRes, debtRes, debtPaymentRes] = await Promise.all([
    fetchAllRows<DailyCashRow>(() => supabase
      .from('daily_cash_entries')
      .select('date,cash_income,terminal_income,card_income,playstation_income')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<StockCountRow>(() => supabase
      .from('daily_stock_counts')
      .select('date,bar_income,bar_cost,bar_profit,sold_quantity,product_id')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('product_id', { ascending: true })),
    fetchAllRows<ExpenseRow>(() => supabase
      .from('expenses')
      .select('id,date,amount,category,payment_method,payment_source,comment,created_at')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<DebtValueRow & { id: string }>(() => supabase
      .from('new_debts')
      .select('id,date,amount,remaining_amount,status')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<DebtPaymentValueRow & { id: string }>(() => supabase
      .from('debt_payments')
      .select('id,date,amount,payment_method')
      .eq('club_id', clubId)
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
  ]);
  const error = [cashRes.error, stockRes.error, expenseRes.error, debtRes.error, debtPaymentRes.error].find(Boolean);
  if (error) throw error;
  return {
    cashRows: (cashRes.data ?? []) as DailyCashRow[],
    stockRows: (stockRes.data ?? []) as StockCountRow[],
    purchaseRows: [],
    expenseRows: (expenseRes.data ?? []) as ExpenseRow[],
    debtRows: (debtRes.data ?? []) as DebtValueRow[],
    debtPaymentRows: (debtPaymentRes.data ?? []) as DebtPaymentValueRow[],
  };
}
