import type { SupabaseClient } from '@supabase/supabase-js';
import { sumProductSalesRows, type ProductSalesRow } from '@/lib/calculations/productSales';
import { isMissingDatabaseFunction } from './errors';
import { fetchAllRows } from './pagination';

type DailyCountRow = Parameters<typeof sumProductSalesRows>[0][number];

/**
 * What each product sold between two business dates. Migration 149 sums it in
 * the database; before that the daily counts are read and summed here.
 */
export async function fetchBarProductSales(
  supabase: SupabaseClient,
  clubId: string,
  from: string,
  to: string,
): Promise<ProductSalesRow[]> {
  const summed = await supabase.rpc('get_bar_product_sales', { p_club_id: clubId, p_from: from, p_to: to });
  if (!summed.error) return (summed.data ?? []) as ProductSalesRow[];
  if (!isMissingDatabaseFunction(summed.error, 'get_bar_product_sales')) throw summed.error;

  const counts = await fetchAllRows<DailyCountRow>(() => supabase
    .from('daily_stock_counts')
    .select('product_id,date,sold_quantity,bar_income,bar_cost')
    .eq('club_id', clubId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
    .order('product_id', { ascending: true }));
  if (counts.error) throw counts.error;
  return sumProductSalesRows(counts.data ?? []);
}
