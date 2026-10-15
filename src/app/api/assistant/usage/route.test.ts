import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), from: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
// The quota table is read with the service client; members never read it directly.
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: mocks.from, rpc: vi.fn() }) }));

const CLUB_ID = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const url = (context: unknown = { clubId: CLUB_ID, locale: 'en' }) => new Request(
  `https://example.test/api/assistant/usage?context=${encodeURIComponent(JSON.stringify(context))}`,
);

function mockMember(membership: unknown, user: unknown = { id: 'user-1' }) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: membership, error: null }) };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  mocks.createClient.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) }, from: () => query });
}

function mockUsageRows(rows: unknown[]) {
  const query = { select: vi.fn(), eq: vi.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockResolvedValue({ data: rows, error: null });
  mocks.from.mockReturnValue(query);
}

const owner = { role: 'owner', feature_access: null, clubs: null };

async function loadRoute() {
  vi.resetModules();
  return (await import('./route')).GET;
}

describe('GET /api/assistant/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ASSISTANT_PROVIDER', 'gemini');
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    vi.stubEnv('ASSISTANT_ALLOW_FREE_GEMINI', 'true');
    vi.stubEnv('ASSISTANT_MODEL', '');
  });

  it('requires a signed-in member with assistant access', async () => {
    const GET = await loadRoute();
    mockMember(owner, null);
    expect((await GET(url())).status).toBe(401);
    mockMember({ role: 'admin', feature_access: ['dashboard'], clubs: null });
    expect((await GET(url())).status).toBe(403);
    mockMember(owner);
    expect((await GET(url({ clubId: 'nope', locale: 'en' }))).status).toBe(400);
  });

  it('summarises today\'s free Gemini requests', async () => {
    const GET = await loadRoute();
    mockMember(owner);
    mockUsageRows([{ model: 'gemini-3.8-flash', requests: 5, exhausted: false }]);

    const { quota } = await (await GET(url())).json();

    expect(quota.currentModel).toMatchObject({ model: 'gemini-3.8-flash', remaining: 15 });
  });

  it('returns no quota for Claude', async () => {
    vi.stubEnv('ASSISTANT_PROVIDER', 'anthropic');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const GET = await loadRoute();
    mockMember(owner);
    expect(await (await GET(url())).json()).toMatchObject({ quota: null });
  });
});
