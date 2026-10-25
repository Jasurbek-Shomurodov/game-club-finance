import { mutateFinanceRequest } from '@/lib/supabase/client';

/**
 * Browser call that deletes a daily income entry through /api/daily-cash, so
 * the club's Telegram group is told about it. Resolves to the HTTP status;
 * 200 means the entry was deleted.
 */
export async function requestDailyCashDeletion(clubId: string, entryId: string): Promise<number> {
  const response = await mutateFinanceRequest('/api/daily-cash', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clubId, entryId }),
  });
  return response.status;
}
