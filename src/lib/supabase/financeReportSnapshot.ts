import type { SupabaseClient } from '@supabase/supabase-js';
import type { DailyCashEntry, DailyStockCount, Expense, StockPurchase } from '@/types';
import { isMissingDatabaseFunction } from './errors';
import { fetchAllRows } from './pagination';

export type FinanceReportSection =
  | 'cash'
  | 'stock_totals'
  | 'stock_counts'
  | 'purchases'
  | 'expenses'
  | 'debts'
  | 'debt_payments';

export interface FinanceStockTotalRow {
  date: string;
  bar_income: number;
  bar_cost: number;
}

export interface FinanceStockCountRow extends DailyStockCount {
  product_name: string | null;
  sort_order: number | null;
}

export interface FinancePurchaseRow extends StockPurchase {
  product_name: string | null;
}

export interface FinanceDebtRow {
  id: string;
  date: string;
  amount: number;
}

export interface FinanceDebtPaymentRow {
  id: string;
  date: string;
  amount: number;
  payment_method: string;
}

export interface FinanceReportSnapshot {
  cashRows: DailyCashEntry[];
  stockTotalRows: FinanceStockTotalRow[];
  stockCountRows: FinanceStockCountRow[];
  purchaseRows: FinancePurchaseRow[];
  expenseRows: Expense[];
  debtRows: FinanceDebtRow[];
  debtPaymentRows: FinanceDebtPaymentRow[];
}

interface FinanceReportSnapshotResult {
  data: FinanceReportSnapshot | null;
  error: { message: string } | null;
  fallbackRequired: boolean;
}

/**
 * Loads the requested finance sections in one cross-region call. A missing RPC
 * falls back to the existing table reads so app and database deploys can roll
 * out independently.
 */
export async function fetchFinanceReportSnapshot(
  supabase: SupabaseClient,
  clubId: string,
  from: string,
  to: string,
  sections: FinanceReportSection[],
): Promise<FinanceReportSnapshotResult> {
  const result = await supabase.rpc('get_finance_report_snapshot', {
    p_club_id: clubId,
    p_range_from: from,
    p_range_to: to,
    p_sections: sections,
  });

  if (!result.error) {
    const snapshot = result.data as Partial<FinanceReportSnapshot> | null;
    return {
      data: {
        cashRows: snapshot?.cashRows ?? [],
        stockTotalRows: snapshot?.stockTotalRows ?? [],
        stockCountRows: snapshot?.stockCountRows ?? [],
        purchaseRows: snapshot?.purchaseRows ?? [],
        expenseRows: snapshot?.expenseRows ?? [],
        debtRows: snapshot?.debtRows ?? [],
        debtPaymentRows: snapshot?.debtPaymentRows ?? [],
      },
      error: null,
      fallbackRequired: false,
    };
  }

  if (isMissingDatabaseFunction(result.error, 'get_finance_report_snapshot')) {
    return { data: null, error: null, fallbackRequired: true };
  }

  return { data: null, error: result.error, fallbackRequired: false };
}

/**
 * `day` loads per-product stock counts for one date; `range` loads only the
 * per-row stock totals needed to build period summaries.
 */
export type FinanceReportDetail = 'day' | 'range';

export type FinanceReportRows = Omit<FinanceReportSnapshot, 'debtPaymentRows'>;

interface FinanceReportRowsResult {
  data: FinanceReportRows | null;
  error: { message: string } | null;
}

interface FallbackStockCountRow extends DailyStockCount {
  products: { name: string; sort_order?: number | null } | null;
}

function isMissingSortOrder(error: { message?: string } | null | undefined) {
  return error?.message?.includes('sort_order') ?? false;
}

/** Products in their configured order, then by name, matching the stock screens. */
export function sortStockCountRows<T extends Pick<FinanceStockCountRow, 'product_id' | 'product_name' | 'sort_order'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const orderA = a.sort_order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.sort_order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return (a.product_name ?? a.product_id).localeCompare(b.product_name ?? b.product_id);
  });
}

/** Expenses in the order they were recorded; ids only break ties. */
export function sortExpenseRows<T extends Pick<Expense, 'id' | 'created_at'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (
    (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id)
  ));
}

/**
 * Loads the cash, stock, purchase, expense, and new-debt rows behind the daily
 * and monthly reports for one club and date range. Uses the snapshot RPC when
 * it exists and the table reads otherwise (migration 049 compatibility), and
 * returns rows in the same order on both paths.
 */
export async function loadFinanceReportRows(
  supabase: SupabaseClient,
  clubId: string,
  from: string,
  to: string,
  detail: FinanceReportDetail,
): Promise<FinanceReportRowsResult> {
  const snapshotResult = await fetchFinanceReportSnapshot(
    supabase,
    clubId,
    from,
    to,
    ['cash', detail === 'day' ? 'stock_counts' : 'stock_totals', 'purchases', 'expenses', 'debts'],
  );

  if (snapshotResult.error) return { data: null, error: snapshotResult.error };

  if (snapshotResult.data) {
    const snapshot = snapshotResult.data;
    return {
      data: {
        cashRows: snapshot.cashRows,
        stockTotalRows: snapshot.stockTotalRows,
        stockCountRows: sortStockCountRows(snapshot.stockCountRows),
        purchaseRows: snapshot.purchaseRows,
        expenseRows: sortExpenseRows(snapshot.expenseRows),
        debtRows: snapshot.debtRows,
      },
      error: null,
    };
  }

  // Compatibility path while migration 049 is being deployed.
  const stockCountQuery = (withSortOrder: boolean) => fetchAllRows<FallbackStockCountRow>(() => {
    const table = supabase.from('daily_stock_counts');
    return (withSortOrder ? table.select('*, products(name, sort_order)') : table.select('*, products(name)'))
      .eq('club_id', clubId)
      .gte('date', from)
      .lte('date', to)
      .order('product_id', { ascending: true });
  });

  const [cashRes, initialStockCountRes, stockTotalRes, purchaseRes, expenseRes, debtRes] = await Promise.all([
    fetchAllRows<DailyCashEntry>(() => supabase
      .from('daily_cash_entries')
      .select('*')
      .eq('club_id', clubId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })),
    detail === 'day' ? stockCountQuery(true) : null,
    detail === 'range'
      ? fetchAllRows<FinanceStockTotalRow>(() => supabase
          .from('daily_stock_counts')
          .select('date,bar_income,bar_cost')
          .eq('club_id', clubId)
          .gte('date', from)
          .lte('date', to)
          .order('date', { ascending: true })
          .order('product_id', { ascending: true }))
      : null,
    fetchAllRows<FinancePurchaseRow>(() => supabase
      .from('stock_purchases')
      .select('*')
      .eq('club_id', clubId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<Expense>(() => supabase
      .from('expenses')
      .select('*')
      .eq('club_id', clubId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })),
    fetchAllRows<FinanceDebtRow>(() => supabase
      .from('new_debts')
      .select('id,date,amount')
      .eq('club_id', clubId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })),
  ]);

  // Databases older than the product sort order still return product names.
  const stockCountRes = isMissingSortOrder(initialStockCountRes?.error)
    ? await stockCountQuery(false)
    : initialStockCountRes;

  const error = [cashRes, stockCountRes, stockTotalRes, purchaseRes, expenseRes, debtRes]
    .find((result) => result?.error)?.error;
  if (error) return { data: null, error };

  return {
    data: {
      cashRows: cashRes.data ?? [],
      stockTotalRows: stockTotalRes?.data ?? [],
      stockCountRows: sortStockCountRows((stockCountRes?.data ?? []).map(({ products, ...row }) => ({
        ...row,
        product_name: products?.name ?? null,
        sort_order: products?.sort_order ?? null,
      }))),
      purchaseRows: (purchaseRes.data ?? []).map((row) => ({ ...row, product_name: row.product_name ?? null })),
      expenseRows: sortExpenseRows(expenseRes.data ?? []),
      debtRows: debtRes.data ?? [],
    },
    error: null,
  };
}
