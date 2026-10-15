import { MockLanguageModelV4 } from 'ai/test';
import { readEventStream, type AssistantEvent } from 'hoggish-assistant';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  load: vi.fn(),
  model: null as unknown,
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/assistant/loaders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/assistant/loaders')>()),
  createDatasetLoader: () => ({ load: mocks.load }),
}));
// Real providers call the network; tests swap in a scripted model when one is set.
vi.mock('hoggish-assistant/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('hoggish-assistant/server')>();
  return {
    ...actual,
    providerFromEnv: (...args: Parameters<typeof actual.providerFromEnv>) => (mocks.model
      ? actual.customProvider({ name: 'mock', models: [{ model: 'mock', languageModel: mocks.model as never }] })
      : actual.providerFromEnv(...args)),
  };
});

import { POST } from './route';
import { assistantProvider } from '@/lib/assistant/handler';

const CLUB_ID = '290c5c33-9dfa-464a-a072-ef5a231f5308';
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

type Step = { text?: string; call?: { id: string; name: string; input: unknown } };

/** A model that plays back one scripted step per call and records its prompts. */
function scriptedModel(steps: Step[]) {
  let index = 0;
  return new MockLanguageModelV4({
    modelId: 'mock',
    doStream: async () => {
      const step = steps[Math.min(index++, steps.length - 1)];
      const chunks: unknown[] = [{ type: 'stream-start', warnings: [] }];
      if (step.text) {
        chunks.push({ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: step.text }, { type: 'text-end', id: 't' });
      }
      if (step.call) {
        chunks.push({ type: 'tool-call', toolCallId: step.call.id, toolName: step.call.name, input: JSON.stringify(step.call.input) });
      }
      const unified = step.call ? 'tool-calls' : 'stop';
      chunks.push({ type: 'finish', finishReason: { unified, raw: unified }, usage });
      return { stream: new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk as never)); controller.close(); } }) };
    },
  });
}

function request(body: unknown = {
  context: { clubId: CLUB_ID, locale: 'en' },
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
  return { supabase, query };
}

async function readEvents(response: Response) {
  const events: AssistantEvent[] = [];
  for await (const event of readEventStream(response.body!)) events.push(event);
  return events;
}

const owner = { role: 'owner', feature_access: null, clubs: { name: 'Pixel', business_day_start_hour: 6 } };

describe('POST /api/assistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.model = scriptedModel([{ text: 'Hello.' }]);
    vi.stubEnv('ASSISTANT_PROVIDER', 'anthropic');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubEnv('GEMINI_API_KEY', '');
  });

  it('rejects anonymous requests', async () => {
    mockSupabase(owner, null);
    expect((await POST(request())).status).toBe(401);
  });

  it('rejects a missing or malformed club context', async () => {
    mockSupabase(owner);
    expect((await POST(request({ messages: [{ role: 'user', content: 'hi' }] }))).status).toBe(400);
    expect((await POST(request({ context: { clubId: 'nope', locale: 'en' }, messages: [{ role: 'user', content: 'hi' }] }))).status).toBe(400);
  });

  it('rejects malformed chat history', async () => {
    mockSupabase(owner);
    const response = await POST(request({ context: { clubId: CLUB_ID, locale: 'en' }, messages: [{ role: 'assistant', content: 'hi' }] }));
    expect(response.status).toBe(400);
  });

  it('checks membership of the requested club for the signed-in user', async () => {
    const { query } = mockSupabase(owner);
    await readEvents(await POST(request()));
    expect(query.eq).toHaveBeenCalledWith('club_id', CLUB_ID);
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-1');
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

  it('reports a missing API key without calling a model', async () => {
    mocks.model = null;
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    mockSupabase(owner);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'NOT_CONFIGURED' });
  });

  it('runs read-only tools with the member\'s datasets and streams the answer', async () => {
    mockSupabase({ role: 'viewer', feature_access: ['inventory', 'assistant'], clubs: { name: 'Pixel' } });
    mocks.load.mockResolvedValue({
      table: { dataset: 'stock', columns: [{ key: 'product', type: 'text' }], rows: [{ product: 'Cola' }] },
    });
    const model = scriptedModel([
      { call: { id: 'tool-1', name: 'get_data', input: { dataset: 'stock' } } },
      { text: 'Cola is low.' },
    ]);
    mocks.model = model;

    const response = await POST(request());
    const events = await readEvents(response);

    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(events).toEqual([
      expect.objectContaining({ type: 'tool', name: 'get_data' }),
      { type: 'text', text: 'Cola is low.' },
      { type: 'done' },
    ]);
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ dataset: 'stock' }));

    const firstCall = model.doStreamCalls[0];
    const getData = firstCall.tools?.find((tool) => tool.name === 'get_data') as unknown as { inputSchema: { properties: { dataset: { enum: string[] } } } };
    // Only the datasets this member may read are offered to the model.
    expect(getData.inputSchema.properties.dataset.enum).toEqual(['stock']);
    expect(JSON.stringify(firstCall.prompt)).toContain('Selected club: Pixel.');
  });

  it('refuses datasets outside the member access even if the model asks', async () => {
    mockSupabase({ role: 'viewer', feature_access: ['inventory', 'assistant'], clubs: null });
    const model = scriptedModel([
      { call: { id: 'tool-1', name: 'get_data', input: { dataset: 'debts' } } },
      { text: 'I cannot read debts.' },
    ]);
    mocks.model = model;

    await readEvents(await POST(request()));

    expect(mocks.load).not.toHaveBeenCalled();
    const toolResult = JSON.stringify(model.doStreamCalls[1].prompt.at(-1));
    expect(toolResult).toMatch(/error/i);
  });
});

describe('assistantProvider', () => {
  beforeEach(() => {
    mocks.model = null;
  });

  it('defaults to Claude, even when a Gemini key is present', () => {
    expect(assistantProvider({ ANTHROPIC_API_KEY: 'key' }).name).toBe('anthropic');
    expect(assistantProvider({ ANTHROPIC_API_KEY: 'key', GEMINI_API_KEY: 'key' }).name).toBe('anthropic');
  });

  it('refuses the free Gemini tier unless the deployment opts in', () => {
    const free = { ASSISTANT_PROVIDER: 'gemini', GEMINI_API_KEY: 'key' };
    expect(() => assistantProvider(free)).toThrow();
    expect(() => assistantProvider({ ...free, ASSISTANT_ALLOW_FREE_GEMINI: 'false' })).toThrow();
    expect(assistantProvider({ ...free, ASSISTANT_ALLOW_FREE_GEMINI: 'true' }).models.length).toBeGreaterThan(1);
  });

  it('accepts a single paid Gemini model without the opt-in', () => {
    expect(assistantProvider({ ASSISTANT_PROVIDER: 'gemini', GEMINI_API_KEY: 'key', ASSISTANT_MODEL: 'gemini-3.8-flash' }).name).toBe('gemini');
  });
});
