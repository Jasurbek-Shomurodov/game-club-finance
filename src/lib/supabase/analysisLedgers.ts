import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DailyCashRow,
  DebtPaymentValueRow,
  DebtValueRow,
  ExpenseRow,
  StockCountRow,
} from '@/lib/calculations/dashboardMetrics';
import type { AnalysisLedgers } from '@/lib/calculations/financialAnalysis';
import { isMissingDatabaseColumn } from './errors';
import { fetchFinanceReportSnapshot, type FinanceReportSection } from './financeReportSnapshot';
import { fetchAllRows } from './pagination';
import { fetchReserveMoves } from './reserveMoves';

const ANALYSIS_SECTIONS: FinanceReportSection[] = ['cash', 'stock_totals', 'expenses', 'debts', 'debt_payments'];

const EXPENSE_LEDGER_COLUMNS = 'id,date,amount,category,payment_method,payment_source,comment,created_at';

/**
 * A club's expenses between two dates for the compatibility (table-read)
 * paths, with `paid_from_reserve` so reserve purchases stay out of money
 * left as on the RPC paths (156). A database without that column (before
 * migration 136) has no reserve purchases, so its rows are read without it.
 */
export async function fetchExpenseLedgerRows(
  supabase: SupabaseClient,
  clubId: string,
  range: { from: string; to: string },
) {
  const read = (columns: string) => fetchAllRows<ExpenseRow>(() => supabase
    .from('expenses')
    .select(columns)
    .eq('club_id', clubId)
    .gte('date', range.from)
    .lte('date', range.to)
    .order('date', { ascending: true })
    .order('id', { ascending: true }) as never);
  const withReserve = await read(`${EXPENSE_LEDGER_COLUMNS},paid_from_reserve`);
  if (isMissingDatabaseColumn(withReserve.error, 'paid_from_reserve')) return read(EXPENSE_LEDGER_COLUMNS);
  return withReserve;
}

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
  const [snapshot, reserveMoves] = await Promise.all([
    fetchFinanceReportSnapshot(supabase, clubId, range.from, range.to, ANALYSIS_SECTIONS),
    // The reserve stays out of money left (156); nothing moves before that migration.
    fetchReserveMoves(supabase, clubId, range.from, range.to),
  ]);
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
      reserveMoves,
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
    fetchExpenseLedgerRows(supabase, clubId, range),
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
    reserveMoves,
  };
}
