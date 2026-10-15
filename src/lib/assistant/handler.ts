import 'server-only';
import { AssistantError, createAssistantHandler, providerFromEnv, type AssistantProvider } from 'hoggish-assistant/server';
import { createSupabaseQuotaStore } from 'hoggish-assistant/supabase';
import { createServiceClient } from '@/lib/supabase/service';
import { normalizeBusinessDayStartHour, serverTodayIso } from '@/lib/utils';
import { authorizeAssistant, type AssistantAccess } from './access';
import { allowedDatasets, type AssistantDataset } from './datasets';
import { createTranslator } from './i18n';
import { createDatasetLoader } from './loaders';
import { ASSISTANT_SYSTEM_PROMPT, assistantContextPrompt } from './prompt';
import { assistantTools } from './tools';

interface AssistantContext extends AssistantAccess {
  businessToday: string;
  datasets: AssistantDataset[];
}

/**
 * Claude by default. Google may use prompts sent on the free Gemini tier, and
 * club finances are private, so the free chain only runs when the deployment
 * opts in with ASSISTANT_ALLOW_FREE_GEMINI=true. A single paid Gemini model
 * (ASSISTANT_MODEL) needs no opt-in.
 */
export function assistantProvider(env: Record<string, string | undefined> = process.env): AssistantProvider {
  const provider = providerFromEnv(env, { provider: 'anthropic' });
  const freeTier = provider.models.some((entry) => entry.dailyLimit !== undefined);
  if (freeTier && env.ASSISTANT_ALLOW_FREE_GEMINI?.trim().toLowerCase() !== 'true') {
    console.error('[assistant] free-tier Gemini needs ASSISTANT_ALLOW_FREE_GEMINI=true');
    throw new AssistantError('NOT_CONFIGURED');
  }
  return provider;
}

/**
 * Free-tier request counts (migration 080), shared by the whole deployment.
 * Best effort: without the service key or the migration the badge is hidden.
 */
function quotaStore() {
  try {
    return createSupabaseQuotaStore(createServiceClient());
  } catch {
    return undefined;
  }
}

export const assistant = createAssistantHandler<AssistantContext>({
  async authorize(_request, context) {
    const access = await authorizeAssistant(context);
    if (!access) return null;
    return {
      ...access,
      businessToday: serverTodayIso(new Date(), normalizeBusinessDayStartHour(access.club?.business_day_start_hour)),
      datasets: allowedDatasets(access.membership.role, access.membership.feature_access),
    };
  },
  provider: () => assistantProvider(),
  system: ASSISTANT_SYSTEM_PROMPT,
  context: (ctx) => assistantContextPrompt({
    clubName: ctx.club?.name ?? '',
    businessToday: ctx.businessToday,
    locale: ctx.locale,
    datasets: ctx.datasets,
  }),
  tools: (ctx) => assistantTools({
    datasets: ctx.datasets,
    loader: createDatasetLoader({ supabase: ctx.supabase, clubId: ctx.clubId, businessToday: ctx.businessToday }),
    translate: createTranslator(ctx.locale),
    locale: ctx.locale,
  }),
  quotaStore: quotaStore(),
});
