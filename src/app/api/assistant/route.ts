import { allowedDatasets } from '@/lib/assistant/datasets';
import { assistantErrorResponse, authorizeAssistant } from '@/lib/assistant/access';
import type { AssistantEvent } from '@/lib/assistant/events';
import { exhaustedModels } from '@/lib/assistant/geminiQuota';
import { createTranslator } from '@/lib/assistant/i18n';
import { createDatasetLoader } from '@/lib/assistant/loaders';
import { assistantProvider } from '@/lib/assistant/providers';
import { ASSISTANT_SYSTEM_PROMPT, assistantContextPrompt } from '@/lib/assistant/prompt';
import { parseAssistantRequest } from '@/lib/assistant/request';
import { assistantToolDefinitions, createToolExecutor } from '@/lib/assistant/tools';
import { createUsageStore } from '@/lib/assistant/usageStore';
import { normalizeBusinessDayStartHour, serverTodayIso } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = parseAssistantRequest(await request.json().catch(() => null));
  const access = await authorizeAssistant(body?.clubId ?? null);
  if (!access.ok) return access.response;
  // authorizeAssistant rejects a missing club, so a parsed body exists here.
  if (!body) return assistantErrorResponse('INVALID_REQUEST');
  const { supabase, membership, club } = access;

  const provider = assistantProvider();
  if (!provider.configured) return assistantErrorResponse('NOT_CONFIGURED');

  const businessToday = serverTodayIso(new Date(), normalizeBusinessDayStartHour(club?.business_day_start_hour));
  const datasets = allowedDatasets(membership.role, membership.feature_access);
  const executor = createToolExecutor({
    datasets,
    loader: createDatasetLoader({ supabase, clubId: body.clubId, businessToday }),
    translate: createTranslator(body.locale),
    locale: body.locale,
  });

  const usage = provider.name === 'gemini' ? createUsageStore() : null;
  const usageRows = usage ? await usage.load() : null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AssistantEvent) => {
        // The browser may have gone away; dropping late events is fine.
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {}
      };

      try {
        await provider.run({
          systemPrompt: ASSISTANT_SYSTEM_PROMPT,
          contextPrompt: assistantContextPrompt({ clubName: club?.name ?? '', businessToday, locale: body.locale, datasets }),
          history: body.messages,
          tools: assistantToolDefinitions(datasets),
          runTool: executor.run,
          send,
          signal: request.signal,
          skipModels: usageRows ? exhaustedModels(usageRows) : undefined,
          onModelRequest: usage?.record,
        });
        send({ type: 'done' });
      } catch (error) {
        if (!request.signal.aborted) {
          console.error('[assistant] request failed', {
            clubId: body.clubId,
            provider: provider.name,
            name: error instanceof Error ? error.name : typeof error,
            status: typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : undefined,
          });
          send({ type: 'error', code: provider.errorCode(error) });
        }
      } finally {
        await usage?.flush();
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
