import { mutateFinanceRequest } from '@/lib/supabase/client';

/**
 * Browser call that ticks (or, for an owner, unticks) a business date as
 * collected through /api/collections, so the club's Telegram group is told.
 * Resolves to the HTTP status; 200 means the change was saved.
 */
export async function requestCollectionChange(clubId: string, date: string, collected: boolean): Promise<number> {
  const response = await mutateFinanceRequest('/api/collections', {
    method: collected ? 'POST' : 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clubId, date }),
  });
  return response.status;
}
