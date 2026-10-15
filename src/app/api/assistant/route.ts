import { allowedDatasets } from '@/lib/assistant/datasets';
import type { AssistantErrorCode, AssistantEvent } from '@/lib/assistant/events';
import { createTranslator } from '@/lib/assistant/i18n';
import { createDatasetLoader } from '@/lib/assistant/loaders';
import { assistantProvider } from '@/lib/assistant/providers';
import { ASSISTANT_SYSTEM_PROMPT, assistantContextPrompt } from '@/lib/assistant/prompt';
import { parseAssistantRequest } from '@/lib/assistant/request';
import { assistantToolDefinitions, createToolExecutor } from '@/lib/assistant/tools';
import { canAccessFeature } from '@/lib/permissions';
import { relatedClub } from '@/lib/supabase/memberships';
import { createClient } from '@/lib/supabase/server';
import { normalizeBusinessDayStartHour, serverTodayIso } from '@/lib/utils';
import type { ClubMembership } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

const STATUS: Record<AssistantErrorCode, number> = {
  UNAUTHORIZED: 401,
  INVALID_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_CONFIGURED: 503,
  BUSY: 429,
  REFUSED: 200,
  TOO_LONG: 200,
  SERVER_ERROR: 500,
};

function errorResponse(code: AssistantErrorCode) {
  return Response.json({ error: code }, { status: STATUS[code] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse('UNAUTHORIZED');

  const body = parseAssistantRequest(await request.json().catch(() => null));
  if (!body) return errorResponse('INVALID_REQUEST');

  const { data: membership, error: membershipError } = await supabase
    .from('club_memberships')
    .select('role,feature_access,clubs(name,business_day_start_hour)')
    .eq('club_id', body.clubId)
    .eq('user_id', user.id)
    .maybeSingle<Pick<ClubMembership, 'role' | 'feature_access' | 'clubs'>>();
  if (membershipError) {
    console.error('[assistant] membership lookup failed', { clubId: body.clubId, message: membershipError.message });
    return errorResponse('SERVER_ERROR');
  }
  if (!membership || !canAccessFeature(membership.role, membership.feature_access, 'assistant')) {
    return errorResponse('FORBIDDEN');
  }
  const provider = assistantProvider();
  if (!provider.configured) return errorResponse('NOT_CONFIGURED');

  const club = relatedClub(membership.clubs ?? null);
  const businessToday = serverTodayIso(new Date(), normalizeBusinessDayStartHour(club?.business_day_start_hour));
  const datasets = allowedDatasets(membership.role, membership.feature_access);
  const executor = createToolExecutor({
    datasets,
    loader: createDatasetLoader({ supabase, clubId: body.clubId, businessToday }),
    translate: createTranslator(body.locale),
    locale: body.locale,
  });

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
