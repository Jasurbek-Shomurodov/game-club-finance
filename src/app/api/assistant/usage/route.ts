import { authorizeAssistant } from '@/lib/assistant/access';
import { summarizeGeminiQuota } from '@/lib/assistant/geminiQuota';
import { assistantProvider } from '@/lib/assistant/providers';
import { createUsageStore } from '@/lib/assistant/usageStore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Today's remaining free Gemini quota for the assistant page. The quota is
 * shared by the whole deployment; members only see these derived totals.
 */
export async function GET(request: Request) {
  const clubId = new URL(request.url).searchParams.get('clubId');
  const access = await authorizeAssistant(clubId && UUID.test(clubId) ? clubId : null);
  if (!access.ok) return access.response;

  const provider = assistantProvider();
  if (provider.name !== 'gemini' || !provider.configured) {
    return Response.json({ quota: null }, { headers: { 'Cache-Control': 'no-store' } });
  }

  const rows = await createUsageStore().load();
  return Response.json(
    { quota: rows ? summarizeGeminiQuota(rows) : null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
