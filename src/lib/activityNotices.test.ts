import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announceActivity } from './activityNotices';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const OTHER = '11111111-2222-4333-8444-555555555555';

describe('announceActivity', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks the server once for a burst of saves of one club, and separately per club', async () => {
    announceActivity(CLUB);
    announceActivity(CLUB);
    announceActivity(OTHER);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    announceActivity(CLUB);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/activity', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ clubId: CLUB }), keepalive: true,
    }));
    expect(fetchMock).toHaveBeenCalledWith('/api/activity', expect.objectContaining({ body: JSON.stringify({ clubId: OTHER }) }));
  });

  it('does nothing without a club, and never throws when the request fails', async () => {
    announceActivity(null);
    announceActivity('');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    announceActivity(CLUB);
    await vi.advanceTimersByTimeAsync(1_000);
    fetchMock.mockImplementationOnce(() => { throw new Error('blocked'); });
    announceActivity(CLUB);
    await expect(vi.advanceTimersByTimeAsync(1_000)).resolves.not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
