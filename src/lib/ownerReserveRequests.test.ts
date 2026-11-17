import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutateFinanceRequest } = vi.hoisted(() => ({ mutateFinanceRequest: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ mutateFinanceRequest }));

import { requestReserveDelete, requestReserveMove, type ReserveMoveRequest } from './ownerReserveRequests';

const move: ReserveMoveRequest = {
  kind: 'deposit',
  month: '2026-11',
  source: 'game_club',
  comment: 'Moved into reserve for winter stock',
  parts: [{ id: 'part-1', method: 'cash', amount: 500000 }],
};

// Reserve writes go through mutateFinanceRequest so the browser read cache is cleared.
function stubFetch(response: Response) {
  mutateFinanceRequest.mockResolvedValue(response);
  return mutateFinanceRequest;
}

afterEach(() => {
  mutateFinanceRequest.mockReset();
});

describe('requestReserveMove', () => {
  it('posts the club id and move to /api/reserve and returns null on success', async () => {
    // GIVEN a server that accepts the move
    const fetchMock = stubFetch(new Response(null, { status: 200 }));

    // WHEN the move is requested
    const failure = await requestReserveMove('club-1', move);

    // THEN it posts the club id with the move and reports no failure
    expect(failure).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/reserve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clubId: 'club-1', ...move }),
    });
  });

  it('returns the server failure code when it is a known one', async () => {
    // GIVEN a server that refuses with a known failure code
    stubFetch(new Response(JSON.stringify({ failure: 'insufficient' }), { status: 409 }));

    // WHEN the move is requested
    const failure = await requestReserveMove('club-1', move);

    // THEN the specific code is returned
    expect(failure).toBe('insufficient');
  });

  it('falls back to "failed" for an unknown code or a body that is not JSON', async () => {
    // GIVEN a server error with an unrecognised code
    stubFetch(new Response(JSON.stringify({ failure: 'something_else' }), { status: 500 }));
    expect(await requestReserveMove('club-1', move)).toBe('failed');

    // GIVEN a server error with a non-JSON body
    stubFetch(new Response('upstream down', { status: 502 }));
    expect(await requestReserveMove('club-1', move)).toBe('failed');
  });
});

describe('requestReserveDelete', () => {
  it('sends a DELETE with the club and entry id', async () => {
    // GIVEN a server that accepts the delete
    const fetchMock = stubFetch(new Response(null, { status: 200 }));

    // WHEN the entry is deleted
    const failure = await requestReserveDelete('club-1', 'entry-9');

    // THEN it sends the ids and reports no failure
    expect(failure).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/reserve', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clubId: 'club-1', entryId: 'entry-9' }),
    });
  });
});
