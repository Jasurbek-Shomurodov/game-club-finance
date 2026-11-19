import 'server-only';

import { generateText, type LanguageModel } from 'ai';
import { providerFromEnv } from 'hoggish-assistant/server';
import { cleanReply, REVIEW_REPLY_SYSTEM_PROMPT, reviewReplyPrompt, type GoogleReview } from './reviews';

type Generate = (options: {
  model: LanguageModel;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  maxRetries: number;
  providerOptions?: Record<string, Record<string, unknown>>;
  abortSignal?: AbortSignal;
}) => Promise<{ text: string }>;

/**
 * Longest one model may take before the chain moves on. The cron route has 60
 * seconds in all; a model that hangs (seen with a busy Gemini preview) must
 * not use them up before a single reply is saved.
 */
export const MODEL_TIMEOUT_MS = 10_000;

/**
 * Writes review replies with the assistant's configured models (Claude by
 * default; ASSISTANT_PROVIDER / ASSISTANT_MODEL switch it), walking the chain
 * when one model fails. Reviews are public text, so the free Gemini tier is
 * allowed here. Null when no model key is set.
 */
export function createReviewReplyWriter(
  env: Record<string, string | undefined> = process.env,
  generate: Generate = generateText as unknown as Generate,
  timeoutMs = MODEL_TIMEOUT_MS,
) {
  const provider = providerFromEnv(env, { provider: 'anthropic' });
  if (!provider.configured || provider.models.length === 0) return null;

  return async (review: GoogleReview, clubName: string): Promise<string | null> => {
    let lastError: unknown = null;
    for (const model of provider.models) {
      try {
        const { text } = await generate({
          model: model.languageModel,
          system: REVIEW_REPLY_SYSTEM_PROMPT,
          prompt: reviewReplyPrompt(review, clubName),
          maxOutputTokens: 600,
          maxRetries: 1,
          providerOptions: model.providerOptions ?? provider.providerOptions,
          abortSignal: AbortSignal.timeout(timeoutMs),
        });
        const reply = cleanReply(text);
        if (reply) return reply;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return null;
  };
}
