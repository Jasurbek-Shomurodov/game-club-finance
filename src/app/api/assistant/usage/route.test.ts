import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authorizeAssistant: vi.fn(), load: vi.fn() }));

vi.mock('@/lib/assistant/access', () => ({ authorizeAssistant: mocks.authorizeAssistant }));
vi.mock('@/lib/assistant/usageStore', () => ({ createUsageStore: () => ({ load: mocks.load }) }));

import { GET } from './route';

const CLUB_ID = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const url = (clubId = CLUB_ID) => new Request(`https://example.test/api/assistant/usage?clubId=${clubId}`);

describe('GET /api/assistant/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeAssistant.mockResolvedValue({ ok: true });
    process.env.ASSISTANT_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ASSISTANT_PROVIDER;
    delete process.env.GEMINI_API_KEY;
  });

  it('requires assistant access in a valid club', async () => {
    mocks.authorizeAssistant.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await GET(url())).status).toBe(403);

    await GET(url('not-a-uuid'));
    expect(mocks.authorizeAssistant).toHaveBeenLastCalledWith(null);
  });

  it('summarises today\'s recorded Gemini requests', async () => {
    mocks.load.mockResolvedValue([{ model: 'gemini-3.8-flash', requests: 5, exhausted: false }]);

    const { quota } = await (await GET(url())).json();

    expect(mocks.authorizeAssistant).toHaveBeenCalledWith(CLUB_ID);
    expect(quota.currentModel).toMatchObject({ model: 'gemini-3.8-flash', remaining: 15 });
    expect(quota.requestsLeft).toBe(1095);
  });

  it('returns no quota for Claude or when usage cannot be read', async () => {
    mocks.load.mockResolvedValue(null);
    expect(await (await GET(url())).json()).toEqual({ quota: null });

    delete process.env.ASSISTANT_PROVIDER;
    expect(await (await GET(url())).json()).toEqual({ quota: null });
  });
});
