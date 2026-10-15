/**
 * Newline-delimited JSON events streamed from /api/assistant to the browser.
 * Error codes map to translated messages under assistant.errors.
 */
export const ASSISTANT_ERROR_CODES = [
  'UNAUTHORIZED',
  'INVALID_REQUEST',
  'FORBIDDEN',
  'NOT_CONFIGURED',
  'BUSY',
  'REFUSED',
  'TOO_LONG',
  'SERVER_ERROR',
] as const;

export type AssistantErrorCode = (typeof ASSISTANT_ERROR_CODES)[number];

export type AssistantEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'file'; fileName: string; mimeType: string; data: string }
  | { type: 'error'; code: AssistantErrorCode }
  | { type: 'done' };

export function isAssistantErrorCode(value: unknown): value is AssistantErrorCode {
  return typeof value === 'string' && (ASSISTANT_ERROR_CODES as readonly string[]).includes(value);
}

/** Splits a growing NDJSON buffer into complete events and the unfinished tail. */
export function parseEventChunk(buffer: string): { events: AssistantEvent[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const events: AssistantEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as AssistantEvent);
    } catch {
      // A malformed line is skipped rather than ending the whole answer.
    }
  }
  return { events, rest };
}
