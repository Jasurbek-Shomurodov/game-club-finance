import { assistant } from '@/lib/assistant/handler';

/**
 * Today's remaining free Gemini quota for the assistant page; `{ quota: null }`
 * when the provider is not quota-tracked. Requires assistant access in the club.
 */
export function GET(request: Request) {
  return assistant.usage(request);
}
