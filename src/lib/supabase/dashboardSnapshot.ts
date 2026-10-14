import type { SupabaseClient } from '@supabase/supabase-js';
import type { Product } from '@/types';
import type {
  DailyCashRow,
  DebtPaymentValueRow,
  ExpenseRow,
  InventorySnapshotRow,
  StockCountRow,
} from '@/lib/calculations/dashboardMetrics';
import type {
  DashboardDebtRow,
  DashboardSnapshotPayload,
  DashboardSnapshotRanges,
  DashboardStockPurchaseRow,
} from '@/lib/calculations/dashboardSnapshot';
import { isMissingDatabaseFunction } from './errors';
import { fetchAllRows } from './pagination';

type Ranges = Pick<DashboardSnapshotRanges, 'range' | 'previousRange' | 'inventoryComparisonRange'>;

export interface DashboardSnapshotResult {
  data: DashboardSnapshotPayload | null;
  error: { message: string } | null;
  /** The RPC is not deployed yet; load the table-read fallback instead. */
  fallbackRequired: boolean;
}

/**
 * Older deployments of get_dashboard_snapshot return no inventoryRows; their
 * stockRows stand in for them, as before.
 */
export function normalizeDashboardSnapshotPayload(raw: unknown): DashboardSnapshotPayload {
  const snapshot = (raw ?? {}) as Partial<DashboardSnapshotPayload>;
  return {
    cashRows: snapshot.cashRows ?? [],
    stockRows: snapshot.stockRows ?? [],
    inventoryRows: snapshot.inventoryRows
      ?? (snapshot.stockRows as unknown as InventorySnapshotRow[] | undefined)
      ?? [],
    purchaseRows: snapshot.purchaseRows ?? [],
    expenseRows: snapshot.expenseRows ?? [],
    debtRows: snapshot.debtRows ?? [],
    debtPaymentRows: snapshot.debtPaymentRows ?? [],
    products: snapshot.products ?? [],
  };
}

/** Loads every dashboard ledger for one club in a single RPC (migration 030/035). */
export async function fetchDashboardSnapshot(
  supabase: SupabaseClient,
  clubId: string,
  { range, previousRange, inventoryComparisonRange }: Ranges,
): Promise<DashboardSnapshotResult> {
  const result = await supabase.rpc('get_dashboard_snapshot', {
    p_club_id: clubId,
    p_range_from: range.from,
    p_range_to: range.to,
    p_previous_from: previousRange.from,
    p_previous_to: previousRange.to,
    p_inventory_from: inventoryComparisonRange.from,
    p_inventory_to: inventoryComparisonRange.to,
  });

  if (!result.error) {
    return { data: normalizeDashboardSnapshotPayload(result.data), error: null, fallbackRequired: false };
  }
  if (isMissingDatabaseFunction(result.error, 'get_dashboard_snapshot')) {
    return { data: null, error: null, fallbackRequired: true };
  }
  return { data: null, error: result.error, fallbackRequired: false };
}

function isMissingSortOrder(error: { message?: string } | null | undefined) {
  return error?.message?.includes('sort_order') ?? false;
}

async function fetchActiveProductsOrdered(supabase: SupabaseClient, clubId: string) {
  const ordered = await fetchAllRows<Product>(() =>
    supabase
      .from('products')
      .select('*')
      .eq('club_id', clubId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .order('id', { ascending: true }),
  );

  if (!isMissingSortOrder(ordered.error)) return ordered;

  return fetchAllRows<Product>(() =>
    supabase
      .from('products')
      .select('*')
      .eq('club_id', clubId)
      .eq('is_active', true)
      .order('name', { ascending: true })
      .order('id', { ascending: true }),
  );
}

/**
 * Compatibility path for databases without get_dashboard_snapshot. Builds the
 * same payload from table reads, so totals come from the one
 * buildDashboardDataFromSnapshot path. Each table is read once for the union
 * of the current and comparison periods.
 */
export async function fetchDashboardSnapshotFromTables(
  supabase: SupabaseClient,
  clubId: string,
  { range, previousRange, inventoryComparisonRange }: Ranges,
): Promise<{ data: DashboardSnapshotPayload | null; error: { message: string } | null }> {
  const financeFrom = range.from < previousRange.from ? range.from : previousRange.from;
  const financeTo = range.to > previousRange.to ? range.to : previousRange.to;

  const [
    cashRes,
    stockRes,
    expenseRes,
    productRes,
    debtRes,
    debtPaymentRes,
    purchaseRes,
    inventoryRes,
  ] = await Promise.all([
    fetchAllRows<DailyCashRow>(() =>
      supabase
        .from('daily_cash_entries')
        .select('date,cash_income,terminal_income,card_income,playstation_income,created_at')
        .eq('club_id', clubId)
        .gte('date', financeFrom)
        .lte('date', financeTo)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
    ),
    fetchAllRows<StockCountRow>(() =>
      supabase
        .from('daily_stock_counts')
        .select('date,bar_income,bar_profit,bar_cost,sold_quantity,updated_at')
        .eq('club_id', clubId)
        .gte('date', financeFrom)
        .lte('date', financeTo)
        .order('date', { ascending: true })
        .order('product_id', { ascending: true }),
    ),
    fetchAllRows<ExpenseRow>(() =>
      supabase
        .from('expenses')
        .select('id,date,amount,category,payment_method,payment_source,comment,created_at')
        .eq('club_id', clubId)
        .gte('date', financeFrom)
        .lte('date', financeTo)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
    ),
    fetchActiveProductsOrdered(supabase, clubId),
    // Every debt: unpaid ones feed the active-debt total whatever their date.
    fetchAllRows<DashboardDebtRow>(() =>
      supabase
        .from('new_debts')
        .select('id,date,amount,remaining_amount,status')
        .eq('club_id', clubId)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
    ),
    fetchAllRows<DebtPaymentValueRow>(() =>
      supabase
        .from('debt_payments')
        .select('id,date,amount,payment_method')
        .eq('club_id', clubId)
        .gte('date', financeFrom)
        .lte('date', financeTo)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
    ),
    fetchAllRows<DashboardStockPurchaseRow>(() =>
      supabase
        .from('stock_purchases')
        .select('id,date,quantity,cost_price')
        .eq('club_id', clubId)
        .gte('date', financeFrom)
        .lte('date', financeTo)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
    ),
    fetchAllRows<InventorySnapshotRow>(() =>
      supabase
        .from('daily_stock_counts')
        .select('product_id,date,closing_stock,cost_price,products(tracks_inventory)')
        .eq('club_id', clubId)
        .gte('date', inventoryComparisonRange.from)
        .lte('date', inventoryComparisonRange.to)
        .order('date', { ascending: true })
        .order('product_id', { ascending: true }),
    ),
  ]);

  const error = [
    cashRes.error,
    stockRes.error,
    expenseRes.error,
    productRes.error,
    debtRes.error,
    debtPaymentRes.error,
    purchaseRes.error,
    inventoryRes.error,
  ].find(Boolean);
  if (error) return { data: null, error };

  return {
    data: {
      cashRows: cashRes.data ?? [],
      stockRows: stockRes.data ?? [],
      inventoryRows: inventoryRes.data ?? [],
      purchaseRows: purchaseRes.data ?? [],
      expenseRows: expenseRes.data ?? [],
      debtRows: debtRes.data ?? [],
      debtPaymentRows: debtPaymentRes.data ?? [],
      products: productRes.data ?? [],
    },
    error: null,
  };
}
