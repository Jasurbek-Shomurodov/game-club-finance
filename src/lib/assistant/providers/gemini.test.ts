import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ generateContentStream: vi.fn() }));

vi.mock('@google/genai', () => {
  class ApiError extends Error {
    status: number;
    constructor({ message, status }: { message: string; status: number }) {
      super(message);
      this.status = status;
    }
  }
  class GoogleGenAI {
    models = { generateContentStream: mocks.generateContentStream };
  }
  return { ApiError, GoogleGenAI };
});

import { ApiError } from '@google/genai';
import type { AssistantEvent } from '../events';
import {
  availableModels,
  contentsFor,
  GEMINI_MODEL_CHAIN,
  geminiProvider,
  resetGeminiCooldowns,
} from './gemini';

function streamOf(...chunks: Array<{ parts: unknown[]; finishReason?: string }>) {
  return (async function* () {
    for (const chunk of chunks) {
      yield { candidates: [{ content: { role: 'model', parts: chunk.parts }, finishReason: chunk.finishReason }] };
    }
  })();
}

function quotaError() {
  return new ApiError({ message: 'RESOURCE_EXHAUSTED', status: 429 });
}

function runInput(events: AssistantEvent[], runTool = vi.fn()) {
  return {
    systemPrompt: 'system',
    contextPrompt: 'context',
    history: [{ role: 'user' as const, content: 'Profit?' }],
    tools: [{ name: 'get_data', description: 'd', parameters: { type: 'object' as const, properties: {}, required: [] } }],
    runTool,
    send: (event: AssistantEvent) => events.push(event),
    signal: new AbortController().signal,
  };
}

describe('gemini provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGeminiCooldowns();
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('falls down the model chain when a model is out of quota', async () => {
    mocks.generateContentStream
      .mockRejectedValueOnce(quotaError())
      .mockRejectedValueOnce(quotaError())
      .mockResolvedValueOnce(streamOf({ parts: [{ text: 'Profit is 1 000 so\'m.' }], finishReason: 'STOP' }));
    const events: AssistantEvent[] = [];

    await geminiProvider().run(runInput(events));

    expect(mocks.generateContentStream.mock.calls.map(([request]) => request.model)).toEqual(GEMINI_MODEL_CHAIN.slice(0, 3));
    expect(events).toEqual([{ type: 'text', text: 'Profit is 1 000 so\'m.' }]);
    // Exhausted models are skipped by later questions on this instance.
    expect(availableModels()[0]).toBe('gemini-3.6-flash');
  });

  it('skips models recorded as used up and reports each request', async () => {
    mocks.generateContentStream
      .mockRejectedValueOnce(new ApiError({ message: 'quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier', status: 429 }))
      .mockResolvedValueOnce(streamOf({ parts: [{ text: 'Hi' }], finishReason: 'STOP' }));
    const onModelRequest = vi.fn();

    await geminiProvider().run({ ...runInput([]), skipModels: ['gemini-3.8-flash'], onModelRequest });

    expect(mocks.generateContentStream.mock.calls.map(([request]) => request.model)).toEqual(['gemini-3.7-flash', 'gemini-3.6-flash']);
    expect(onModelRequest.mock.calls).toEqual([['gemini-3.7-flash', 'daily_limit'], ['gemini-3.6-flash', 'ok']]);
  });

  it('still tries the chain when records say every model is used up', async () => {
    mocks.generateContentStream.mockResolvedValueOnce(streamOf({ parts: [{ text: 'Hi' }], finishReason: 'STOP' }));

    await geminiProvider().run({ ...runInput([]), skipModels: [...GEMINI_MODEL_CHAIN] });

    expect(mocks.generateContentStream.mock.calls[0][0].model).toBe('gemini-3.8-flash');
  });

  it('runs function calls and returns their results to the same model', async () => {
    const call = { id: 'call-1', name: 'get_data', args: { dataset: 'summary' } };
    mocks.generateContentStream
      .mockResolvedValueOnce(streamOf({ parts: [{ functionCall: call, thoughtSignature: 'sig' }], finishReason: 'STOP' }))
      .mockResolvedValueOnce(streamOf({ parts: [{ text: 'Done' }], finishReason: 'STOP' }));
    const runTool = vi.fn().mockResolvedValue({ result: { rows: [] } });
    const events: AssistantEvent[] = [];

    await geminiProvider().run(runInput(events, runTool));

    expect(runTool).toHaveBeenCalledWith('get_data', { dataset: 'summary' });
    const second = mocks.generateContentStream.mock.calls[1][0];
    expect(second.contents.at(-2)).toEqual({ role: 'model', parts: [{ functionCall: call, thoughtSignature: 'sig' }] });
    expect(second.contents.at(-1)).toEqual({
      role: 'user',
      parts: [{ functionResponse: { id: 'call-1', name: 'get_data', response: { output: { rows: [] } } } }],
    });
    expect(events).toEqual([{ type: 'tool', name: 'get_data' }, { type: 'text', text: 'Done' }]);
  });

  it('reports busy once every model is exhausted', async () => {
    mocks.generateContentStream.mockRejectedValue(quotaError());
    const provider = geminiProvider();

    const error = await provider.run(runInput([])).catch((caught: unknown) => caught);

    expect(mocks.generateContentStream).toHaveBeenCalledTimes(GEMINI_MODEL_CHAIN.length);
    expect(provider.errorCode(error)).toBe('BUSY');
  });

  it('does not retry other models on a request error', async () => {
    mocks.generateContentStream.mockRejectedValue(new ApiError({ message: 'bad', status: 400 }));
    const provider = geminiProvider();

    const error = await provider.run(runInput([])).catch((caught: unknown) => caught);

    expect(mocks.generateContentStream).toHaveBeenCalledTimes(1);
    expect(provider.errorCode(error)).toBe('SERVER_ERROR');
  });
});

describe('contentsFor', () => {
  it('neutralises thought signatures from a different model', () => {
    const turns = [
      { content: { role: 'user', parts: [{ text: 'q' }] }, producer: null },
      {
        content: { role: 'model', parts: [{ thought: true, text: 'hidden' }, { functionCall: { name: 'get_data' }, thoughtSignature: 'sig' }] },
        producer: 'gemini-3.8-flash',
      },
    ];
    expect(contentsFor(turns, 'gemini-3.8-flash')).toEqual(turns.map((turn) => turn.content));
    expect(contentsFor(turns, 'gemini-3.7-flash')[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'get_data' }, thoughtSignature: 'skip_thought_signature_validator' }],
    });
  });
});
