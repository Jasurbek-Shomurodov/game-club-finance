import { afterEach, describe, expect, it, vi } from 'vitest';

const { mutateFinanceRequest } = vi.hoisted(() => ({ mutateFinanceRequest: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ mutateFinanceRequest }));

import { requestReserveDelete, requestReserveDepositByMethod, requestReserveMove, requestReserveMoveParts, type ReserveMoveRequest } from './ownerReserveRequests';

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

describe('requestReserveMoveParts', () => {
  const putAllIn: ReserveMoveRequest = {
    ...move,
    comment: '',
    parts: [
      { id: 'cash-part', method: 'cash', amount: 500_000 },
      { id: 'terminal-part', method: 'terminal', amount: 200_000 },
    ],
  };

  it('names the stored parts and the refused ones with their reasons', async () => {
    // GIVEN a server that stored the cash part and refused the terminal one
    stubFetch(new Response(JSON.stringify({
      failure: 'day_balance',
      saved: [{ id: 'cash-part', method: 'cash', amount: 500_000 }],
      failed: [{ id: 'terminal-part', method: 'terminal', amount: 200_000, failure: 'day_balance' }],
    }), { status: 409 }));

    // WHEN the move is sent
    const result = await requestReserveMoveParts('club-1', putAllIn);

    // THEN each part is where the server put it, as it was sent
    expect(result).toEqual({
      saved: [putAllIn.parts[0]],
      failed: [{ ...putAllIn.parts[1], failure: 'day_balance' }],
    });
  });

  it('refuses every part when the request was refused as a whole, and stores every part on a bare success', async () => {
    // GIVEN a signed-out refusal without part lists
    stubFetch(new Response(JSON.stringify({ failure: 'forbidden' }), { status: 401 }));
    expect((await requestReserveMoveParts('club-1', putAllIn)).failed.map((part) => part.failure)).toEqual(['forbidden', 'forbidden']);

    // GIVEN an unknown code
    stubFetch(new Response('upstream down', { status: 502 }));
    expect((await requestReserveMoveParts('club-1', putAllIn)).failed.map((part) => part.failure)).toEqual(['failed', 'failed']);

    // GIVEN a success without part lists
    stubFetch(new Response(null, { status: 200 }));
    expect(await requestReserveMoveParts('club-1', putAllIn)).toEqual({ saved: putAllIn.parts, failed: [] });
  });
});

describe('requestReserveDepositByMethod', () => {
  const deposit = {
    month: '2026-11',
    date: '2026-11-20',
    comment: 'For new PCs',
    parts: [
      { id: 'id-cash', method: 'cash' as const, amount: 300_000 },
      { id: 'id-terminal', method: 'terminal' as const, amount: 200_000 },
      { id: 'id-card', method: 'card' as const, amount: 100_000 },
    ],
  };
  const sentParts = () => mutateFinanceRequest.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).parts);

  it('sends one Game Club deposit per method, in order, and reports every method saved', async () => {
    // GIVEN a server that accepts every request
    mutateFinanceRequest.mockImplementation(async () => new Response(null, { status: 200 }));
    const heard: string[] = [];

    // WHEN the split deposit is sent
    const result = await requestReserveDepositByMethod('club-1', deposit, (method) => heard.push(method));

    // THEN each method went alone, with its own id, as a deposit of that day
    expect(result).toEqual({ saved: ['cash', 'terminal', 'card'], failure: null });
    expect(heard).toEqual(['cash', 'terminal', 'card']);
    expect(sentParts()).toEqual([[deposit.parts[0]], [deposit.parts[1]], [deposit.parts[2]]]);
    expect(JSON.parse(String((mutateFinanceRequest.mock.calls[0][1] as RequestInit).body))).toMatchObject({
      clubId: 'club-1', kind: 'deposit', source: 'game_club', month: '2026-11', date: '2026-11-20', comment: 'For new PCs',
    });
  });

  it('stops at the first refusal and says which methods were stored before it', async () => {
    // GIVEN a server that stores cash and refuses the terminal
    mutateFinanceRequest
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ failure: 'day_balance' }), { status: 409 }));

    // WHEN the split deposit is sent
    const result = await requestReserveDepositByMethod('club-1', deposit);

    // THEN cash is stored, the terminal is refused and the card is never sent
    expect(result).toEqual({ saved: ['cash'], failure: { method: 'terminal', code: 'day_balance' } });
    expect(sentParts()).toEqual([[deposit.parts[0]], [deposit.parts[1]]]);
  });

  it('treats a request that did not come back as a failed method', async () => {
    // GIVEN a network failure on the first request
    mutateFinanceRequest.mockRejectedValueOnce(new Error('offline'));

    // WHEN the split deposit is sent
    const result = await requestReserveDepositByMethod('club-1', deposit);

    // THEN nothing is reported stored and the first method failed
    expect(result).toEqual({ saved: [], failure: { method: 'cash', code: 'failed' } });
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
