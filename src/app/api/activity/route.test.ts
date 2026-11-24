import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  deliverActivityNotices: vi.fn(),
  afterTasks: [] as Promise<unknown>[],
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock('@/lib/telegram/activityDelivery', () => ({ deliverActivityNotices: mocks.deliverActivityNotices }));
vi.mock('next/server', () => ({ after: (task: () => unknown) => { mocks.afterTasks.push(Promise.resolve().then(task)); } }));

import { maxDuration, POST } from './route';

const CLUB = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const SERVICE = { service: true };

function mockSupabase({
  user = { id: 'u1' } as object | null,
  membership = { data: { role: 'admin' } as unknown, error: null as { message: string } | null },
} = {}) {
  const filters: Array<[string, ...unknown[]]> = [];
  const from = vi.fn((table: string) => {
    filters.push(['from', table]);
    const builder: Record<string, unknown> = {};
    builder.select = (...args: unknown[]) => { filters.push(['select', ...args]); return builder; };
    builder.eq = (...args: unknown[]) => { filters.push(['eq', ...args]); return builder; };
    builder.maybeSingle = () => Promise.resolve(membership);
    return builder;
  });
  mocks.createClient.mockResolvedValue({ auth: { getUser: () => Promise.resolve({ data: { user } }) }, from });
  return { filters };
}

async function call(body: unknown): Promise<Response> {
  const response = await POST(new Request('https://example.test/api/activity', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  await Promise.all(mocks.afterTasks.splice(0));
  return response;
}

describe('/api/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServiceClient.mockReturnValue(SERVICE);
    mocks.deliverActivityNotices.mockResolvedValue({ claimed: 0, sent: 0, failed: 0, unrouted: 0 });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('refuses a signed-out caller', async () => {
    mockSupabase({ user: null });
    expect((await call({ clubId: CLUB })).status).toBe(401);
    expect(mocks.deliverActivityNotices).not.toHaveBeenCalled();
  });

  it('refuses a malformed body', async () => {
    mockSupabase();
    expect((await call({ clubId: 'not-a-club' })).status).toBe(400);
    expect((await call('{')).status).toBe(400);
    expect(mocks.deliverActivityNotices).not.toHaveBeenCalled();
  });

  it('refuses someone who is not a member of the club', async () => {
    mockSupabase({ membership: { data: null, error: null } });
    expect((await call({ clubId: CLUB })).status).toBe(403);
    expect(mocks.deliverActivityNotices).not.toHaveBeenCalled();
  });

  it('fails closed when membership cannot be read', async () => {
    mockSupabase({ membership: { data: null, error: { message: 'down' } } });
    expect((await call({ clubId: CLUB })).status).toBe(500);
    expect(mocks.deliverActivityNotices).not.toHaveBeenCalled();
  });

  it('sends the club’s pending notices after answering a member', async () => {
    const { filters } = mockSupabase();
    const response = await call({ clubId: CLUB });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ queued: true });
    expect(filters).toEqual(expect.arrayContaining([['from', 'club_memberships'], ['eq', 'club_id', CLUB], ['eq', 'user_id', 'u1']]));
    expect(mocks.deliverActivityNotices).toHaveBeenCalledWith(SERVICE, CLUB, expect.objectContaining({
      batchSize: 10, maxBatches: 1, deadlineAt: expect.any(Number),
    }));
    // Every send ends well inside the function's 60 s.
    const { deadlineAt } = mocks.deliverActivityNotices.mock.calls[0][2] as { deadlineAt: number };
    expect(deadlineAt - Date.now()).toBeGreaterThan(40_000);
    expect(deadlineAt - Date.now()).toBeLessThanOrEqual(45_000);
    expect(maxDuration).toBe(60);
  });

  it('answers a member even when sending cannot start', async () => {
    mockSupabase();
    mocks.createServiceClient.mockImplementation(() => { throw new Error('Missing Supabase service environment variables'); });
    expect((await call({ clubId: CLUB })).status).toBe(200);
    expect(console.error).toHaveBeenCalledWith('[activity] delivery failed', expect.objectContaining({ clubId: CLUB }));
  });
});
