import { describe, expect, it, vi } from 'vitest';

const mutate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/client', () => ({ mutateFinanceRequest: mutate }));

import { requestDailyCashDeletion } from './dailyCashApi';

describe('requestDailyCashDeletion', () => {
  it('deletes through /api/daily-cash and returns the status', async () => {
    mutate.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(requestDailyCashDeletion('club-1', 'entry-1')).resolves.toBe(404);
    expect(mutate).toHaveBeenCalledWith('/api/daily-cash', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ clubId: 'club-1', entryId: 'entry-1' }),
    }));
  });
});
