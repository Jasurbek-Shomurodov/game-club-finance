import { mutateFinanceRequest } from '@/lib/supabase/client';

export interface DailyCashDeletionResult {
  /** HTTP status; 200 means the entry was deleted. */
  status: number;
  /** The route's error code, e.g. DAY_COLLECTED or INSUFFICIENT_BALANCE; null when none. */
  code: string | null;
}

/**
 * Browser call that deletes a daily income entry through /api/daily-cash, so
 * the club's Telegram group is told about it.
 */
export async function requestDailyCashDeletion(clubId: string, entryId: string): Promise<DailyCashDeletionResult> {
  const response = await mutateFinanceRequest('/api/daily-cash', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clubId, entryId }),
  });
  if (response.ok) return { status: response.status, code: null };
  const body = await response.json().catch(() => null) as { code?: unknown } | null;
  return { status: response.status, code: typeof body?.code === 'string' ? body.code : null };
}
