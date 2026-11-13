import { beforeEach, describe, expect, it, vi } from 'vitest';

const mutateFinanceRequest = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/client', () => ({ mutateFinanceRequest }));

import { requestCollectionChange } from './collectionsApi';

beforeEach(() => mutateFinanceRequest.mockReset());

describe('requestCollectionChange', () => {
  it('posts the club and date to tick a day as collected', async () => {
    mutateFinanceRequest.mockResolvedValue(new Response('{}', { status: 200 }));

    await expect(requestCollectionChange('club-1', '2026-11-11', true)).resolves.toBe(200);

    expect(mutateFinanceRequest).toHaveBeenCalledTimes(1);
    const [url, init] = mutateFinanceRequest.mock.calls[0];
    expect(url).toBe('/api/collections');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ clubId: 'club-1', date: '2026-11-11' });
  });

  it('sends a DELETE for the same club and date to untick it', async () => {
    mutateFinanceRequest.mockResolvedValue(new Response('{}', { status: 200 }));

    await requestCollectionChange('club-1', '2026-11-11', false);

    const [url, init] = mutateFinanceRequest.mock.calls[0];
    expect(url).toBe('/api/collections');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ clubId: 'club-1', date: '2026-11-11' });
  });

  it('resolves to the refusal status instead of throwing', async () => {
    mutateFinanceRequest.mockResolvedValueOnce(new Response('{}', { status: 403 }));
    await expect(requestCollectionChange('club-1', '2026-11-11', false)).resolves.toBe(403);
    mutateFinanceRequest.mockResolvedValueOnce(new Response('{}', { status: 409 }));
    await expect(requestCollectionChange('club-1', '2026-11-11', true)).resolves.toBe(409);
  });
});
