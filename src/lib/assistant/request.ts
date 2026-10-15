import { z } from 'zod';
import { ASSISTANT_LOCALES } from './locales';

export const MAX_MESSAGE_CHARS = 4_000;
export const MAX_HISTORY_MESSAGES = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const chatMessage = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

const requestSchema = z.object({
  clubId: z.string().regex(UUID),
  locale: z.enum(ASSISTANT_LOCALES),
  messages: z.array(chatMessage).min(1).max(MAX_HISTORY_MESSAGES),
});

export type AssistantChatMessage = z.infer<typeof chatMessage>;
export type AssistantRequest = z.infer<typeof requestSchema>;

/**
 * Validates a chat request. History is plain text kept by the browser (no
 * history is stored); it must start with the user and end with a new question.
 */
export function parseAssistantRequest(body: unknown): AssistantRequest | null {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return null;
  const { messages } = parsed.data;
  if (messages[0].role !== 'user' || messages[messages.length - 1].role !== 'user') return null;
  return parsed.data;
}

/** Keeps the newest messages that fit, still starting with a user turn. */
export function trimHistory(messages: AssistantChatMessage[], limit = MAX_HISTORY_MESSAGES): AssistantChatMessage[] {
  const recent = messages.slice(-limit);
  const firstUser = recent.findIndex((message) => message.role === 'user');
  return firstUser <= 0 ? recent : recent.slice(firstUser);
}
