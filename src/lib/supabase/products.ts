import type { SupabaseClient } from '@supabase/supabase-js';
import type { Product } from '@/types';

type ErrorLike = { message?: string } | null | undefined;

/** Databases before the product ordering migration have no sort_order column. */
export function isMissingSortOrder(error: ErrorLike): boolean {
  return error?.message?.includes('sort_order') ?? false;
}

/** Databases before the product archive migration have no is_deleted column. */
export function isMissingDeletedColumn(error: ErrorLike): boolean {
  return error?.message?.includes('is_deleted') ?? false;
}

export interface ProductListFilters {
  /** Only products currently offered for sale. */
  activeOnly?: boolean;
  /** Only products with a carried stock balance (not made to order). */
  tracksInventoryOnly?: boolean;
}

/**
 * A club's non-archived products in catalog order (sort_order, then name).
 * Older databases may lack sort_order or is_deleted; only the missing column
 * is dropped from the query, so every page falls back the same way.
 */
export async function fetchProductsOrdered(
  supabase: SupabaseClient,
  clubId: string,
  filters: ProductListFilters = {},
) {
  const run = (withSortOrder: boolean, withDeletedFilter: boolean) => {
    let query = supabase.from('products').select('*').eq('club_id', clubId);
    if (filters.activeOnly) query = query.eq('is_active', true);
    if (filters.tracksInventoryOnly) query = query.eq('tracks_inventory', true);
    if (withDeletedFilter) query = query.eq('is_deleted', false);
    if (withSortOrder) query = query.order('sort_order', { ascending: true });
    return query.order('name', { ascending: true }).returns<Product[]>();
  };

  let withSortOrder = true;
  let withDeletedFilter = true;
  let result = await run(withSortOrder, withDeletedFilter);
  while (result.error) {
    if (withSortOrder && isMissingSortOrder(result.error)) withSortOrder = false;
    else if (withDeletedFilter && isMissingDeletedColumn(result.error)) withDeletedFilter = false;
    else break;
    result = await run(withSortOrder, withDeletedFilter);
  }
  return result;
}

/** Active, non-archived products in catalog order. */
export function fetchActiveProductsOrdered(
  supabase: SupabaseClient,
  clubId: string,
  filters: Omit<ProductListFilters, 'activeOnly'> = {},
) {
  return fetchProductsOrdered(supabase, clubId, { ...filters, activeOnly: true });
}

/**
 * Writes catalog positions planned by planProductReorder (normally the two
 * swapped products). Each write is club-scoped; zero updated rows is a
 * failure because RLS silently filters rows the user may not update.
 */
export async function updateProductSortOrders(
  supabase: SupabaseClient,
  clubId: string,
  writes: Array<{ id: string; sort_order: number }>,
  updatedAt = new Date().toISOString(),
) {
  const results = await Promise.all(writes.map((write) => supabase
    .from('products')
    .update({ sort_order: write.sort_order, updated_at: updatedAt })
    .eq('club_id', clubId)
    .eq('id', write.id)
    .select('id')));
  const failed = results.find((result) => result.error || (result.data?.length ?? 0) === 0);
  return { error: failed ? (failed.error ?? { message: 'no rows updated' }) : null };
}

/** Escapes LIKE wildcards so a typed "%" or "_" matches literally. */
/** Escapes LIKE wildcards so a search term matches literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Upper bound on ids passed on to a follow-up `in (...)` filter. */
const PRODUCT_NAME_MATCH_LIMIT = 100;

/**
 * Ids of every club product whose name contains `needle`, including inactive
 * and archived products, so history searches still find their rows.
 */
export async function fetchProductIdsByName(
  supabase: SupabaseClient,
  clubId: string,
  needle: string,
  limit = PRODUCT_NAME_MATCH_LIMIT,
): Promise<{ data: string[]; error: { message?: string } | null }> {
  const trimmed = needle.trim();
  if (!trimmed) return { data: [], error: null };
  const result = await supabase
    .from('products')
    .select('id')
    .eq('club_id', clubId)
    .ilike('name', `%${escapeLikePattern(trimmed)}%`)
    .limit(limit);
  if (result.error) return { data: [], error: result.error };
  return { data: (result.data ?? []).map((row: { id: string }) => row.id), error: null };
}
