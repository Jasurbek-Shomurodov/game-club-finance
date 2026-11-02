import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingDatabaseFunction } from './errors';

export interface RecordStockPurchaseInput {
  /** Reused across retries of one submit, so a lost response records the purchase once. */
  requestId: string;
  clubId: string;
  date: string;
  productId: string;
  quantity: number;
  costPrice: number;
  salePrice: number | null;
  paymentMethod: string;
  comment: string | null;
}

/** Records a purchase atomically; databases before migration 119 use the signature without a request id. */
export async function recordStockPurchase(supabase: SupabaseClient, input: RecordStockPurchaseInput) {
  const params = {
    p_club_id: input.clubId,
    p_date: input.date,
    p_product_id: input.productId,
    p_quantity: input.quantity,
    p_cost_price: input.costPrice,
    p_sale_price: input.salePrice,
    p_payment_method: input.paymentMethod,
    p_comment: input.comment,
  };
  const result = await supabase.rpc('record_stock_purchase', { p_request_id: input.requestId, ...params });
  return isMissingDatabaseFunction(result.error, 'record_stock_purchase')
    ? supabase.rpc('record_stock_purchase', params)
    : result;
}
