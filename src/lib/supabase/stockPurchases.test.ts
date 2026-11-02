import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { recordStockPurchase } from './stockPurchases';

const input = {
  requestId: 'request', clubId: 'club', date: '2026-11-02', productId: 'cola', quantity: 3,
  costPrice: 2108.42, salePrice: null, paymentMethod: 'cash', comment: null,
};
const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient;

describe('recordStockPurchase', () => {
  it('sends the request id once when the database has migration 119', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'request', error: null });
    await expect(recordStockPurchase(client(rpc), input)).resolves.toMatchObject({ data: 'request', error: null });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_request_id: 'request', p_club_id: 'club', p_cost_price: 2108.42 });
  });

  it('falls back to the older signature when the overload is missing', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.record_stock_purchase' } })
      .mockResolvedValueOnce({ data: 'generated', error: null });
    await expect(recordStockPurchase(client(rpc), input)).resolves.toMatchObject({ data: 'generated' });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_request_id');
  });

  it('does not retry a real rejection through the older signature', async () => {
    const error = { code: '55000', message: 'Cannot add a purchase on or before a saved stock closing.' };
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    await expect(recordStockPurchase(client(rpc), input)).resolves.toMatchObject({ error });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
