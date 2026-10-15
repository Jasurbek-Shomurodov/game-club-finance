import { ApiError, GoogleGenAI, type Content, type FunctionCall, type Part } from '@google/genai';
import { MAX_ROUNDS, runToolCalls, type AssistantProvider, type AssistantRunInput } from './types';

/**
 * Free-tier models, strongest first. Each has its own quota, so when one is
 * exhausted (429) or unavailable the next one answers instead.
 */
export const GEMINI_MODEL_CHAIN = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
] as const;

/** How long a model that hit its limit is skipped by this server instance. */
const QUOTA_COOLDOWN_MS = 60_000;
const MISSING_MODEL_COOLDOWN_MS = 60 * 60_000;
const cooldownUntil = new Map<string, number>();

/**
 * Google documents this value for function-call parts the current model did
 * not produce. It is used only when a quota fallback switches models partway
 * through one answer, because signatures are tied to the model that made them.
 */
const FOREIGN_SIGNATURE = 'skip_thought_signature_validator';

export class GeminiQuotaExhaustedError extends Error {}

function fallbackCooldown(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status === 429 || error.status === 503 || error.status === 500) return QUOTA_COOLDOWN_MS;
  if (error.status === 404) return MISSING_MODEL_COOLDOWN_MS;
  return null;
}

export function availableModels(now = Date.now()): string[] {
  return GEMINI_MODEL_CHAIN.filter((model) => (cooldownUntil.get(model) ?? 0) <= now);
}

/** Exposed for tests. */
export function resetGeminiCooldowns() {
  cooldownUntil.clear();
}

interface ModelTurn {
  content: Content;
  /** Model that produced a `model` turn; null for user turns. */
  producer: string | null;
}

/** Contents for `model`, neutralising thought signatures another model produced. */
export function contentsFor(turns: ModelTurn[], model: string): Content[] {
  return turns.map(({ content, producer }) => {
    if (!producer || producer === model) return content;
    return {
      ...content,
      parts: (content.parts ?? [])
        .filter((part) => !part.thought)
        .map((part) => (part.thoughtSignature ? { ...part, thoughtSignature: FOREIGN_SIGNATURE } : part)),
    };
  });
}

async function run(input: AssistantRunInput) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const config = {
    systemInstruction: `${input.systemPrompt}\n\n${input.contextPrompt}`,
    abortSignal: input.signal,
    ...(input.tools.length
      ? {
          tools: [{
            functionDeclarations: input.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parametersJsonSchema: tool.parameters,
            })),
          }],
        }
      : {}),
  };
  const turns: ModelTurn[] = input.history.map((message) => ({
    content: { role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] },
    producer: null,
  }));
  let textSent = false;

  /** Streams one model turn, falling back down the chain before any text is shown. */
  async function streamTurn() {
    for (const model of availableModels()) {
      let roundText = false;
      try {
        const stream = await ai.models.generateContentStream({ model, contents: contentsFor(turns, model), config });
        const parts: Part[] = [];
        let finishReason: string | undefined;
        for await (const chunk of stream) {
          const candidate = chunk.candidates?.[0];
          for (const part of candidate?.content?.parts ?? []) {
            parts.push(part);
            if (part.text && !part.thought) {
              // Separate text from different rounds ("Let me check…" then the answer).
              input.send({ type: 'text', text: !roundText && textSent ? `\n\n${part.text}` : part.text });
              roundText = true;
              textSent = true;
            }
          }
          if (candidate?.finishReason) finishReason = candidate.finishReason;
        }
        return { model, parts, finishReason };
      } catch (error) {
        const cooldown = fallbackCooldown(error);
        if (cooldown === null || roundText || input.signal.aborted) throw error;
        cooldownUntil.set(model, Date.now() + cooldown);
      }
    }
    throw new GeminiQuotaExhaustedError('Every Gemini model in the chain is rate limited');
  }

  for (let round = 0; ; round += 1) {
    if (round >= MAX_ROUNDS) {
      input.send({ type: 'error', code: 'TOO_LONG' });
      return;
    }

    const { model, parts, finishReason } = await streamTurn();
    const calls = parts
      .map((part) => part.functionCall)
      .filter((call): call is FunctionCall & { name: string } => Boolean(call?.name));

    if (calls.length === 0) {
      if (!textSent && finishReason && finishReason !== 'STOP') input.send({ type: 'error', code: 'REFUSED' });
      return;
    }
    if (finishReason === 'MAX_TOKENS') {
      // A function call cut off by the token limit must not run.
      input.send({ type: 'error', code: 'TOO_LONG' });
      return;
    }

    turns.push({ content: { role: 'model', parts }, producer: model });
    const results = await runToolCalls(calls.map((call) => ({ ...call, input: call.args ?? {} })), input);
    turns.push({
      content: {
        role: 'user',
        parts: results.map(({ call, outcome }) => ({
          functionResponse: {
            id: call.id,
            name: call.name,
            response: outcome.isError ? { error: outcome.result } : { output: outcome.result },
          },
        })),
      },
      producer: null,
    });
  }
}

export function geminiProvider(): AssistantProvider {
  return {
    name: 'gemini',
    configured: Boolean(process.env.GEMINI_API_KEY),
    run,
    errorCode: (error) => (error instanceof GeminiQuotaExhaustedError || fallbackCooldown(error) !== null ? 'BUSY' : 'SERVER_ERROR'),
  };
}
