import type { SupabaseClient } from '@supabase/supabase-js';
import type { FinancialReportInput, FinancialReportStockRow, FinancialReportExpenseRow } from '@/lib/calculations/dailyReport';
import { fetchFinanceReportSnapshot } from './financeReportSnapshot';
import { fetchAllRows } from './pagination';

export type DailyCashSummary = Omit<FinancialReportInput, 'manualIncome'>;
export const emptyDailyCashSummary: DailyCashSummary = { stockRows: [], expenseRows: [], purchaseRows: [], debtIncome: 0 };

/** Only request full profit inputs when the member can read all finance ledgers. */
export async function loadDailyCashSummary(db: SupabaseClient, clubId: string, date: string, includeProfit: boolean): Promise<DailyCashSummary> {
  // One call for the three profit inputs. Members without them need only the
  // bar totals, which the single stock read below already is.
  if (includeProfit) {
    const snapshot = await fetchFinanceReportSnapshot(db, clubId, date, date, ['stock_totals', 'expenses', 'debts']);
    if (snapshot.error) throw new Error(snapshot.error.message);
    if (snapshot.data) {
      return {
        stockRows: snapshot.data.stockTotalRows,
        expenseRows: snapshot.data.expenseRows,
        purchaseRows: [],
        debtIncome: snapshot.data.debtRows.reduce((sum, row) => sum + Number(row.amount), 0),
      };
    }
    // Compatibility path while migration 049 is being deployed: the table reads below.
  }
  const [stock, expenses, debts] = await Promise.all([
    fetchAllRows<FinancialReportStockRow>(() => db.from('daily_stock_counts')
      .select('bar_income,bar_cost').eq('club_id', clubId).eq('date', date).order('id')),
    includeProfit ? fetchAllRows<FinancialReportExpenseRow>(() => db.from('expenses')
      .select('amount,payment_source').eq('club_id', clubId).eq('date', date).order('id')) : null,
    includeProfit ? fetchAllRows<{ amount: number }>(() => db.from('new_debts')
      .select('amount').eq('club_id', clubId).eq('date', date).order('id')) : null,
  ]);
  const error = [stock.error, expenses?.error, debts?.error].find(Boolean);
  if (error) throw new Error(error.message);
  return {
    stockRows: stock.data ?? [], expenseRows: expenses?.data ?? [], purchaseRows: [],
    debtIncome: (debts?.data ?? []).reduce((sum, row) => sum + Number(row.amount), 0),
  };
}
