import type { AssistantEvent } from '../events';
import type { AssistantChatMessage } from '../request';
import type { AssistantToolSpec, ToolOutcome } from '../tools';

/** Model calls per question; each tool round is one call. */
export const MAX_ROUNDS = 8;

export interface AssistantRunInput {
  /** Stable instructions, identical across requests (cacheable). */
  systemPrompt: string;
  /** Per-club, per-day context. */
  contextPrompt: string;
  /** Plain-text history from the browser, ending with the new question. */
  history: AssistantChatMessage[];
  tools: AssistantToolSpec[];
  runTool: (name: string, input: unknown) => Promise<ToolOutcome>;
  send: (event: AssistantEvent) => void;
  signal: AbortSignal;
  /** Models already known to be out of daily quota (quota-tracked providers). */
  skipModels?: string[];
  /** Called once per accepted model request, or when a model hits its daily limit. */
  onModelRequest?: (model: string, result: 'ok' | 'daily_limit') => void;
}

export interface AssistantProvider {
  name: 'anthropic' | 'gemini';
  /** False when the provider's server-side API key is missing. */
  configured: boolean;
  /** Streams one answer. Throws only on failures it could not turn into an event. */
  run: (input: AssistantRunInput) => Promise<void>;
  /** Maps a thrown error to a stable code for the browser. */
  errorCode: (error: unknown) => 'BUSY' | 'SERVER_ERROR';
}

/**
 * Runs the tool calls of one model turn in parallel, streaming status and
 * any generated file to the browser, and returns the outcomes in call order.
 */
export async function runToolCalls<T extends { name: string; input: unknown }>(
  calls: T[],
  input: Pick<AssistantRunInput, 'runTool' | 'send'>,
): Promise<Array<{ call: T; outcome: ToolOutcome }>> {
  return Promise.all(calls.map(async (call) => {
    input.send({ type: 'tool', name: call.name });
    const outcome = await input.runTool(call.name, call.input);
    if (outcome.file) {
      input.send({
        type: 'file',
        fileName: outcome.file.fileName,
        mimeType: outcome.file.mimeType,
        data: outcome.file.data.toString('base64'),
      });
    }
    return { call, outcome };
  }));
}
