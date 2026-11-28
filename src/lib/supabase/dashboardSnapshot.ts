import type { SupabaseClient } from '@supabase/supabase-js';
import type { Product } from '@/types';
import type {
  DailyCashRow,
  DebtPaymentValueRow,
  InventorySnapshotRow,
  ProductValueRow,
  StockCountRow,
} from '@/lib/calculations/dashboardMetrics';
import type {
  DashboardDebtRow,
  DashboardSnapshotPayload,
  DashboardSnapshotRanges,
  DashboardStockPurchaseRow,
  InventoryCatalogRow,
  LaterDebtPaymentRow,
} from '@/lib/calculations/dashboardSnapshot';
import { latestCountPerProduct, productsNeedingEarlierCounts } from '@/lib/calculations/dashboardSnapshot';
import { fetchExpenseLedgerRows } from './analysisLedgers';
import { isMissingDatabaseFunction } from './errors';
import { fetchAllRows } from './pagination';
import { fetchReserveMoves } from './reserveMoves';

type Ranges = Pick<DashboardSnapshotRanges, 'range' | 'previousRange' | 'inventoryComparisonRange'> & Partial<Pick<DashboardSnapshotRanges, 'period'>>;

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

type SnapshotExtras = Pick<DashboardSnapshotPayload, 'inactiveStockProducts' | 'laterDebtPayments' | 'laterPaidDebts'>;

/** Ids per `in` filter, so a long list never outgrows the request URL. */
const DEBT_ID_CHUNK = 100;

function chunked<T>(items: readonly T[], size = DEBT_ID_CHUNK): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

/** PostgREST errors are plain objects with a message, not Error instances. */
function asLoadError(error: unknown): { message: string } {
  return { message: (error as { message?: string } | null)?.message ?? String(error) };
}

/**
 * The club's whole catalog, deactivated and deleted products included, for the
 * stock values. Started beside the other reads; its failure surfaces where it is awaited.
 */
function fetchInventoryCatalog(supabase: SupabaseClient, clubId: string): Promise<InventoryCatalogRow[]> {
  const catalog = Promise.resolve().then(async () => {
    const result = await fetchAllRows<InventoryCatalogRow>(() =>
      supabase
        .from('products')
        .select('id,tracks_inventory,deleted_at')
        .eq('club_id', clubId)
        .order('id', { ascending: true }),
    );
    if (result.error) throw result.error;
    return result.data ?? [];
  });
  // Not awaited when the RPC turns out to be missing: never an unhandled rejection.
  catalog.catch(() => undefined);
  return catalog;
}

/**
 * The latest count before the comparison window of each product with none in
 * it (`productsNeedingEarlierCounts`), so last month's and a past month's
 * stock value use each product's latest count however old, as the Telegram
 * report does. Newest first, keeping one row per product.
 */
async function fetchEarlierInventoryRows(
  supabase: SupabaseClient,
  clubId: string,
  catalog: Promise<InventoryCatalogRow[]>,
  windowRows: InventorySnapshotRow[],
  window: { from: string; to: string },
): Promise<{ rows: InventorySnapshotRow[]; error: { message: string } | null }> {
  try {
    const ids = productsNeedingEarlierCounts(await catalog, windowRows, window);
    const results = await Promise.all(chunked(ids).map((chunk) => fetchAllRows<InventorySnapshotRow>(() =>
      supabase
        .from('daily_stock_counts')
        .select('product_id,date,closing_stock,cost_price,products(tracks_inventory,deleted_at)')
        .eq('club_id', clubId)
        .in('product_id', chunk)
        .lt('date', window.from)
        .order('date', { ascending: false })
        .order('product_id', { ascending: true }),
    )));
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
    return { rows: latestCountPerProduct(results.flatMap((result) => result.data ?? [])), error: null };
  } catch (error) {
    return { rows: [], error: asLoadError(error) };
  }
}

/**
 * What a past month's closing debt balances need beyond the snapshot: the
 * payments dated after the month and the since-paid debts they belong to
 * (the snapshot already holds every debt still open).
 */
async function fetchLaterDebtRows(supabase: SupabaseClient, clubId: string, monthEnd: string): Promise<SnapshotExtras> {
  const payments = await fetchAllRows<LaterDebtPaymentRow>(() =>
    supabase
      .from('debt_payments')
      .select('id,debt_id,date,amount')
      .eq('club_id', clubId)
      .gt('date', monthEnd)
      .order('date', { ascending: true })
      .order('id', { ascending: true }),
  );
  if (payments.error) throw payments.error;
  const laterDebtPayments = payments.data ?? [];
  const debtIds = [...new Set(laterDebtPayments.map((payment) => payment.debt_id))];
  const debts = await Promise.all(chunked(debtIds).map((ids) => fetchAllRows<DashboardDebtRow>(() =>
    supabase
      .from('new_debts')
      .select('id,person_name,date,amount,remaining_amount,status')
      .eq('club_id', clubId)
      .eq('status', 'paid')
      .lte('date', monthEnd)
      .in('id', ids)
      .order('id', { ascending: true }),
  )));
  const failed = debts.find((result) => result.error);
  if (failed?.error) throw failed.error;
  return { laterDebtPayments, laterPaidDebts: debts.flatMap((result) => result.data ?? []) };
}

/** Deactivated, not deleted products that still hold stock: they count in the current stock value. */
async function fetchInactiveStockProducts(supabase: SupabaseClient, clubId: string): Promise<SnapshotExtras> {
  const products = await fetchAllRows<ProductValueRow>(() =>
    supabase
      .from('products')
      .select('id,current_stock,cost_price,tracks_inventory')
      .eq('club_id', clubId)
      .eq('is_active', false)
      .eq('is_deleted', false)
      .gt('current_stock', 0)
      .order('id', { ascending: true }),
  );
  if (products.error) throw products.error;
  return { inactiveStockProducts: products.data ?? [] };
}

/**
 * The reads the snapshot RPC leaves out: a past month's closing debts, or the
 * current month's deactivated stock. Either is part of a figure on screen, so
 * a failed read fails the load rather than showing a wrong figure.
 */
async function fetchSnapshotExtras(
  supabase: SupabaseClient,
  clubId: string,
  { range, period }: Ranges,
): Promise<{ data: SnapshotExtras; error: { message: string } | null }> {
  try {
    const data = period === 'lastMonth'
      ? await fetchLaterDebtRows(supabase, clubId, range.to)
      : await fetchInactiveStockProducts(supabase, clubId);
    return { data, error: null };
  } catch (error) {
    return { data: {}, error: asLoadError(error) };
  }
}

/** Loads every dashboard ledger for one club in a single RPC (migration 030/035). */
export async function fetchDashboardSnapshot(
  supabase: SupabaseClient,
  clubId: string,
  ranges: Ranges,
): Promise<DashboardSnapshotResult> {
  const { range, previousRange, inventoryComparisonRange } = ranges;
  const movesFrom = range.from < previousRange.from ? range.from : previousRange.from;
  const movesTo = range.to > previousRange.to ? range.to : previousRange.to;
  const catalog = fetchInventoryCatalog(supabase, clubId);
  const [result, moves, extras] = await Promise.all([
    supabase.rpc('get_dashboard_snapshot', {
      p_club_id: clubId,
      p_range_from: range.from,
      p_range_to: range.to,
      p_previous_from: previousRange.from,
      p_previous_to: previousRange.to,
      p_inventory_from: inventoryComparisonRange.from,
      p_inventory_to: inventoryComparisonRange.to,
    }),
    // The reserve stays out of money left (156); read beside the snapshot, which predates it.
    fetchReserveMoves(supabase, clubId, movesFrom, movesTo)
      .then((rows) => ({ rows, error: null }), (error: Error) => ({ rows: [], error: { message: error.message } })),
    fetchSnapshotExtras(supabase, clubId, ranges),
  ]);

  if (!result.error) {
    if (moves.error) return { data: null, error: moves.error, fallbackRequired: false };
    if (extras.error) return { data: null, error: extras.error, fallbackRequired: false };
    const payload = normalizeDashboardSnapshotPayload(result.data);
    const earlier = await fetchEarlierInventoryRows(supabase, clubId, catalog, payload.inventoryRows, inventoryComparisonRange);
    if (earlier.error) return { data: null, error: earlier.error, fallbackRequired: false };
    return {
      data: { ...payload, reserveMoves: moves.rows, ...extras.data, earlierInventoryRows: earlier.rows },
      error: null,
      fallbackRequired: false,
    };
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
  ranges: Ranges,
): Promise<{ data: DashboardSnapshotPayload | null; error: { message: string } | null }> {
  const { range, previousRange, inventoryComparisonRange, period } = ranges;
  // An earlier month's inventory value is its own last closing stock, so its counts are read too.
  const inventoryTo = period === 'lastMonth' && range.to > inventoryComparisonRange.to ? range.to : inventoryComparisonRange.to;
  const financeFrom = range.from < previousRange.from ? range.from : previousRange.from;
  const financeTo = range.to > previousRange.to ? range.to : previousRange.to;
  const catalog = fetchInventoryCatalog(supabase, clubId);

  const [
    cashRes,
    stockRes,
    expenseRes,
    productRes,
    debtRes,
    debtPaymentRes,
    purchaseRes,
    inventoryRes,
    movesRes,
    extras,
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
    // With the reserve flag, as the RPC: reserve purchases stay out of money left (156).
    fetchExpenseLedgerRows(supabase, clubId, { from: financeFrom, to: financeTo }),
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
        .select('product_id,date,closing_stock,cost_price,products(tracks_inventory,deleted_at)')
        .eq('club_id', clubId)
        .gte('date', inventoryComparisonRange.from)
        .lte('date', inventoryTo)
        .order('date', { ascending: true })
        .order('product_id', { ascending: true }),
    ),
    // Money moved into or out of the reserve stays out of money left (156), as on the RPC path.
    fetchReserveMoves(supabase, clubId, financeFrom, financeTo)
      .then((rows) => ({ rows, error: null }), (error: Error) => ({ rows: [], error: { message: error.message } })),
    fetchSnapshotExtras(supabase, clubId, ranges),
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
    movesRes.error,
    extras.error,
  ].find(Boolean);
  if (error) return { data: null, error };
  const inventoryRows = inventoryRes.data ?? [];
  const earlier = await fetchEarlierInventoryRows(supabase, clubId, catalog, inventoryRows, inventoryComparisonRange);
  if (earlier.error) return { data: null, error: earlier.error };

  return {
    data: {
      cashRows: cashRes.data ?? [],
      stockRows: stockRes.data ?? [],
      inventoryRows,
      purchaseRows: purchaseRes.data ?? [],
      expenseRows: expenseRes.data ?? [],
      debtRows: debtRes.data ?? [],
      debtPaymentRows: debtPaymentRes.data ?? [],
      products: productRes.data ?? [],
      reserveMoves: movesRes.rows,
      ...extras.data,
      earlierInventoryRows: earlier.rows,
    },
    error: null,
  };
}
