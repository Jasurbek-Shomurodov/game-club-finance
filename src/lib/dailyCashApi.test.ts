import { describe, expect, it, vi } from 'vitest';

const mutate = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/client', () => ({ mutateFinanceRequest: mutate }));

import { requestDailyCashDeletion } from './dailyCashApi';

describe('requestDailyCashDeletion', () => {
  it('deletes through /api/daily-cash and returns the status', async () => {
    mutate.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(requestDailyCashDeletion('club-1', 'entry-1')).resolves.toEqual({ status: 404, code: null });
    expect(mutate).toHaveBeenCalledWith('/api/daily-cash', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ clubId: 'club-1', entryId: 'entry-1' }),
    }));
  });

  it('returns the refusal code so already-spent money is told apart from a closed day', async () => {
    mutate.mockResolvedValue(Response.json({ code: 'INSUFFICIENT_BALANCE' }, { status: 409 }));
    await expect(requestDailyCashDeletion('club-1', 'entry-1')).resolves.toEqual({ status: 409, code: 'INSUFFICIENT_BALANCE' });
    mutate.mockResolvedValue(new Response(null, { status: 200 }));
    await expect(requestDailyCashDeletion('club-1', 'entry-1')).resolves.toEqual({ status: 200, code: null });
  });
});
