import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import type { AssistantProvider } from './types';

/** ASSISTANT_PROVIDER selects the model vendor; Claude is the default. */
export function assistantProvider(): AssistantProvider {
  return process.env.ASSISTANT_PROVIDER?.trim().toLowerCase() === 'gemini' ? geminiProvider() : anthropicProvider();
}
