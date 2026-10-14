import type { SupabaseClient } from '@supabase/supabase-js';
import type { Product } from '@/types';
import type { ClosingStockExistingCount, ClosingStockPurchaseQuantity } from '../closingStock';
import { fetchActiveProductsOrdered, isMissingSortOrder } from './products';
import { fetchStockOpeningBalances, fetchStockPurchasesForDate } from './stockOpeningBalances';

type SavedProductRelation = Pick<
  Product,
  'id' | 'club_id' | 'name' | 'category' | 'current_stock' | 'tracks_inventory' | 'low_stock_threshold'
  | 'sort_order' | 'is_active' | 'is_deleted' | 'created_at' | 'updated_at'
>;

interface SavedStockCountRow {
  product_id: string;
  previous_stock: number;
  added_today: number;
  adjustment_quantity: number;
  adjustment_reason: string | null;
  closing_stock: number;
  sold_quantity: number;
  sale_price: number;
  cost_price: number;
  giveaway_quantity?: number | null;
  promotion_id?: string | null;
  products?: SavedProductRelation | SavedProductRelation[] | null;
}

const SAVED_COUNT_COLUMNS = 'product_id,previous_stock,added_today,adjustment_quantity,adjustment_reason,closing_stock,sold_quantity,sale_price,cost_price';
// Migration 078; older databases have no giveaway columns.
const GIVEAWAY_COLUMNS = 'giveaway_quantity,promotion_id';
const SAVED_PRODUCT_COLUMNS = 'id,club_id,name,category,current_stock,tracks_inventory,low_stock_threshold,is_active,is_deleted,created_at,updated_at';

/** Everything the closing-stock page needs to build its editable rows for one date. */
export interface ClosingStockDayData {
  products: Product[];
  counts: ClosingStockExistingCount[];
  purchases: ClosingStockPurchaseQuantity[];
  previousClosings: Record<string, number>;
  /** Open business day: purchases are live and saved rows refresh. */
  isCurrentDate: boolean;
  hasSavedCounts: boolean;
  /** A browser draft may be applied (nothing saved for this date yet). */
  draftEligible: boolean;
}

export type ClosingStockDayResult =
  | { data: ClosingStockDayData; error: null }
  | { data: null; error: { message?: string } };

export interface LoadClosingStockDayInput {
  clubId: string;
  date: string;
  /** The club's current business date. */
  today: string;
  isOwner: boolean;
  /** Display name for a saved count whose product row is not readable. */
  unknownProductName: string;
}

/** Product for a saved count; the snapshot's prices are the saved ones. */
function productFromSavedCount(count: SavedStockCountRow, clubId: string, unknownProductName: string): Product {
  const relation = Array.isArray(count.products) ? count.products[0] : count.products;
  return {
    id: relation?.id ?? count.product_id,
    club_id: relation?.club_id ?? clubId,
    name: relation?.name ?? unknownProductName,
    category: relation?.category ?? null,
    sale_price: Number(count.sale_price ?? 0),
    cost_price: Number(count.cost_price ?? 0),
    current_stock: relation?.current_stock ?? Number(count.closing_stock ?? 0),
    tracks_inventory: relation?.tracks_inventory ?? true,
    low_stock_threshold: relation?.low_stock_threshold ?? null,
    sort_order: relation?.sort_order ?? null,
    is_active: relation?.is_active ?? false,
    is_deleted: relation?.is_deleted ?? false,
    created_at: relation?.created_at ?? '',
    updated_at: relation?.updated_at ?? '',
  };
}

async function fetchSavedCountsWithProducts(supabase: SupabaseClient, clubId: string, date: string) {
  const query = (productColumns: string, countColumns = `${SAVED_COUNT_COLUMNS},${GIVEAWAY_COLUMNS}`) => supabase
    .from('daily_stock_counts')
    .select(`${countColumns},products(${productColumns})`)
    .eq('club_id', clubId)
    .eq('date', date)
    .order('updated_at', { ascending: false })
    .returns<SavedStockCountRow[]>();

  let result = await query(`${SAVED_PRODUCT_COLUMNS},sort_order`);
  if (isMissingGiveawayColumns(result.error)) result = await query(`${SAVED_PRODUCT_COLUMNS},sort_order`, SAVED_COUNT_COLUMNS);
  if (isMissingSortOrder(result.error)) {
    result = await query(SAVED_PRODUCT_COLUMNS);
    if (isMissingGiveawayColumns(result.error)) result = await query(SAVED_PRODUCT_COLUMNS, SAVED_COUNT_COLUMNS);
  }
  return result;
}

function isMissingGiveawayColumns(error: { message?: string } | null): boolean {
  return error?.message?.includes('giveaway_quantity') ?? false;
}

/**
 * A past date: the saved snapshot, or (for an owner, when nothing was saved)
 * the active catalog with that date's purchases and opening balances.
 */
async function loadHistoricalDay(
  supabase: SupabaseClient,
  { clubId, date, today, isOwner, unknownProductName }: LoadClosingStockDayInput,
): Promise<ClosingStockDayResult> {
  const saved = await fetchSavedCountsWithProducts(supabase, clubId, date);
  if (saved.error) return { data: null, error: saved.error };
  const savedCounts = saved.data ?? [];

  if (savedCounts.length === 0 && isOwner) {
    const [productsRes, purchasesRes, openingsRes] = await Promise.all([
      fetchActiveProductsOrdered(supabase, clubId),
      fetchStockPurchasesForDate(supabase, date, clubId),
      fetchStockOpeningBalances(supabase, date, clubId, date === today),
    ]);
    const error = productsRes.error ?? purchasesRes.error ?? openingsRes.error;
    if (error) return { data: null, error };
    return {
      data: {
        products: productsRes.data ?? [],
        counts: [],
        purchases: purchasesRes.data ?? [],
        previousClosings: openingsRes.data ?? {},
        isCurrentDate: false,
        hasSavedCounts: false,
        draftEligible: true,
      },
      error: null,
    };
  }

  const purchasesRes = await fetchStockPurchasesForDate(supabase, date, clubId);
  if (purchasesRes.error) return { data: null, error: purchasesRes.error };
  return {
    data: {
      products: savedCounts.map((count) => productFromSavedCount(count, clubId, unknownProductName)),
      counts: savedCounts,
      purchases: purchasesRes.data ?? [],
      previousClosings: {},
      isCurrentDate: false,
      hasSavedCounts: savedCounts.length > 0,
      draftEligible: false,
    },
    error: null,
  };
}

/**
 * The open business day: the active catalog plus any product that already has
 * a saved count today but is no longer active (inactive or archived), so its
 * recorded sales stay in the day's totals.
 */
async function loadOpenDay(
  supabase: SupabaseClient,
  { clubId, date, today }: LoadClosingStockDayInput,
): Promise<ClosingStockDayResult> {
  const [productsRes, countsRes, purchasesRes, openingsRes] = await Promise.all([
    fetchActiveProductsOrdered(supabase, clubId),
    supabase.from('daily_stock_counts').select('*').eq('club_id', clubId).eq('date', date)
      .returns<ClosingStockExistingCount[]>(),
    fetchStockPurchasesForDate(supabase, date, clubId),
    fetchStockOpeningBalances(supabase, date, clubId, date === today),
  ]);
  const error = productsRes.error ?? countsRes.error ?? purchasesRes.error ?? openingsRes.error;
  if (error) return { data: null, error };

  const activeProducts = productsRes.data ?? [];
  const counts = countsRes.data ?? [];
  const activeIds = new Set(activeProducts.map((product) => product.id));
  const missingIds = counts.map((count) => count.product_id).filter((id) => !activeIds.has(id));
  let savedProducts: Product[] = [];
  if (missingIds.length > 0) {
    const result = await supabase.from('products').select('*')
      .eq('club_id', clubId).in('id', missingIds).returns<Product[]>();
    if (result.error) return { data: null, error: result.error };
    savedProducts = result.data ?? [];
  }

  return {
    data: {
      products: [...activeProducts, ...savedProducts],
      counts,
      purchases: purchasesRes.data ?? [],
      previousClosings: openingsRes.data ?? {},
      isCurrentDate: date === today,
      hasSavedCounts: counts.length > 0,
      draftEligible: counts.length === 0,
    },
    error: null,
  };
}

/** Loads one club date for the closing-stock page; every read is club-scoped. */
export function loadClosingStockDay(
  supabase: SupabaseClient,
  input: LoadClosingStockDayInput,
): Promise<ClosingStockDayResult> {
  return input.date < input.today ? loadHistoricalDay(supabase, input) : loadOpenDay(supabase, input);
}
