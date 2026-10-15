import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  stream: vi.fn(),
  load: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/assistant/loaders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/assistant/loaders')>()),
  createDatasetLoader: () => ({ load: mocks.load }),
}));
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status?: number;
  }
  class RateLimitError extends APIError {}
  class InternalServerError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static RateLimitError = RateLimitError;
    static InternalServerError = InternalServerError;
    beta = { messages: { stream: mocks.stream } };
  }
  return { default: Anthropic };
});

import { POST } from './route';

const CLUB_ID = '290c5c33-9dfa-464a-a072-ef5a231f5308';

function request(body: unknown = {
  clubId: CLUB_ID,
  locale: 'en',
  messages: [{ role: 'user', content: 'How many products are low?' }],
}) {
  return new Request('https://example.test/api/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockSupabase(membership: unknown, user: unknown = { id: 'user-1' }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: membership, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn(() => query),
  };
  mocks.createClient.mockResolvedValue(supabase);
  return supabase;
}

function modelTurn(message: { stop_reason: string; content: unknown[] }, text = '') {
  return {
    on: vi.fn((event: string, handler: (delta: string) => void) => {
      if (event === 'text' && text) handler(text);
    }),
    finalMessage: vi.fn().mockResolvedValue(message),
  };
}

async function readEvents(response: Response) {
  return (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
}

const owner = { role: 'owner', feature_access: null, clubs: { name: 'Pixel', business_day_start_hour: 6 } };

describe('POST /api/assistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    delete process.env.ASSISTANT_PROVIDER;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('rejects anonymous requests', async () => {
    mockSupabase(owner, null);
    expect((await POST(request())).status).toBe(401);
  });

  it('rejects malformed chat history', async () => {
    mockSupabase(owner);
    const response = await POST(request({ clubId: CLUB_ID, locale: 'en', messages: [{ role: 'assistant', content: 'hi' }] }));
    expect(response.status).toBe(400);
  });

  it('forbids members without the assistant feature', async () => {
    mockSupabase({ role: 'admin', feature_access: null, clubs: null });
    expect((await POST(request())).status).toBe(403);

    mockSupabase({ role: 'admin', feature_access: ['dashboard'], clubs: null });
    expect((await POST(request())).status).toBe(403);
  });

  it('forbids non-members of the club', async () => {
    mockSupabase(null);
    expect((await POST(request())).status).toBe(403);
  });

  it('reports a missing API key without calling the model', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    mockSupabase(owner);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'NOT_CONFIGURED' });
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it('runs read-only tools and streams the answer', async () => {
    mockSupabase({ role: 'viewer', feature_access: ['inventory', 'assistant'], clubs: { name: 'Pixel' } });
    mocks.load.mockResolvedValue({
      table: { dataset: 'stock', columns: [{ key: 'product', type: 'text' }], rows: [{ product: 'Cola' }] },
    });
    mocks.stream
      .mockReturnValueOnce(modelTurn({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'get_data', input: { dataset: 'stock' } }],
      }))
      .mockReturnValueOnce(modelTurn({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Cola is low.' }] }, 'Cola is low.'));

    const response = await POST(request());
    const events = await readEvents(response);

    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(events).toEqual([
      { type: 'tool', name: 'get_data' },
      { type: 'text', text: 'Cola is low.' },
      { type: 'done' },
    ]);
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ dataset: 'stock' }));

    const firstCall = mocks.stream.mock.calls[0][0];
    // Only the datasets this member may read are offered to the model.
    expect(firstCall.tools[0].input_schema.properties.dataset.enum).toEqual(['stock']);
    expect(firstCall.system[1].text).toContain('Selected club: Pixel.');

    const secondCall = mocks.stream.mock.calls[1][0];
    expect(secondCall.messages.at(-1)).toEqual({
      role: 'user',
      content: [expect.objectContaining({ type: 'tool_result', tool_use_id: 'tool-1' })],
    });
  });

  it('refuses datasets outside the member access even if the model asks', async () => {
    mockSupabase({ role: 'viewer', feature_access: ['inventory', 'assistant'], clubs: null });
    mocks.stream
      .mockReturnValueOnce(modelTurn({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'get_data', input: { dataset: 'debts' } }],
      }))
      .mockReturnValueOnce(modelTurn({ stop_reason: 'end_turn', content: [] }));

    await readEvents(await POST(request()));

    expect(mocks.load).not.toHaveBeenCalled();
    const toolResult = mocks.stream.mock.calls[1][0].messages.at(-1).content[0];
    expect(toolResult.is_error).toBe(true);
  });

  it('streams a refusal as an error event', async () => {
    mockSupabase(owner);
    mocks.stream.mockReturnValueOnce(modelTurn({ stop_reason: 'refusal', content: [] }));

    const events = await readEvents(await POST(request()));

    expect(events).toEqual([{ type: 'error', code: 'REFUSED' }, { type: 'done' }]);
  });
});
