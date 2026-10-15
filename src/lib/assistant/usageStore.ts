import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { isMissingDatabaseFunction } from '@/lib/supabase/errors';
import { quotaDate, type ModelUsageRow } from './geminiQuota';

/**
 * Shared daily request counts for the deployment's Gemini key (migration
 * 080). Counting is best effort: a missing table or service key only turns
 * the quota display off, it never blocks an answer.
 */
export function createUsageStore(now = new Date()) {
  let client: ReturnType<typeof createServiceClient> | null = null;
  try {
    client = createServiceClient();
  } catch {
    client = null;
  }
  const date = quotaDate(now);
  const pending: Promise<unknown>[] = [];

  async function load(): Promise<ModelUsageRow[] | null> {
    if (!client) return null;
    const { data, error } = await client
      .from('assistant_model_usage')
      .select('model,requests,exhausted')
      .eq('usage_date', date);
    if (error) {
      console.error('[assistant] usage read failed', { message: error.message });
      return null;
    }
    return (data ?? []) as ModelUsageRow[];
  }

  function record(model: string, result: 'ok' | 'daily_limit') {
    if (!client) return;
    pending.push(Promise.resolve(client
      .rpc('record_assistant_model_request', { p_usage_date: date, p_model: model, p_exhausted: result === 'daily_limit' }))
      .then(({ error }) => {
        if (error && !isMissingDatabaseFunction(error, 'record_assistant_model_request')) {
          console.error('[assistant] usage write failed', { model, message: error.message });
        }
      }));
  }

  /** Waits for recorded requests before the response stream closes. */
  async function flush() {
    await Promise.allSettled(pending.splice(0));
  }

  return { load, record, flush };
}
