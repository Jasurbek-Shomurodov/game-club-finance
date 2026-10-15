import { assistant } from '@/lib/assistant/handler';

export const runtime = 'nodejs';
export const maxDuration = 120;

export function POST(request: Request) {
  return assistant.chat(request);
}
