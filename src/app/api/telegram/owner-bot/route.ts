import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';
import { handleOwnerBotMessage } from '@/lib/telegram/ownerBot/handler';
import { errorText } from '@/lib/telegram/ownerBot/texts';
import { parseOwnerBotMessage } from '@/lib/telegram/ownerBot/update';
import { ownerBotWebhookAuthStatus } from '@/lib/telegram/ownerBot/webhookAuth';
import { sendTelegramMessage } from '@/lib/telegram/sendDailyFinanceReport';

/**
 * Webhook of the owner money bot (docs/plans/owner-money-bot.md,
 * docs/runbooks/owner-money-bot.md). Telegram calls it with every update; it
 * answers only private messages from the sender's own linked account.
 *
 * Telegram resends an update until it gets a 2xx, so every update that
 * passed the secret check is answered 200, even when the reply could not be
 * built or sent. Only a missing configuration (503) and a wrong secret (401)
 * are refused.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

/** Time left for the replies after the update was handled, kept under maxDuration. */
const REPLY_DEADLINE_MS = 25_000;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

const handled = () => json({ ok: true });
const notConfigured = () => json({ ok: false, error: 'The owner bot is not configured' }, 503);

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const auth = ownerBotWebhookAuthStatus(request);
  if (auth === 'invalid_configuration') return notConfigured();
  if (auth === 'unauthorized') return json({ ok: false, error: 'Unauthorized' }, 401);

  const botToken = process.env.TELEGRAM_OWNER_BOT_TOKEN;
  if (!botToken) return notConfigured();
  let supabase: SupabaseClient;
  try {
    supabase = createServiceClient();
  } catch {
    return notConfigured();
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    // Not an update Telegram can send again in a better shape: drop it.
    return handled();
  }
  const message = parseOwnerBotMessage(update);
  if (!message) return handled();

  let replies: string[];
  try {
    replies = await handleOwnerBotMessage(supabase, message);
  } catch (error) {
    console.error('[telegram/owner-bot] update not handled:', describe(error));
    replies = [errorText()];
  }

  for (const text of replies) {
    try {
      await sendTelegramMessage({
        botToken,
        chatId: String(message.chatId),
        text,
        maxAttempts: 2,
        timeoutMs: 5_000,
        deadlineAt: startedAt + REPLY_DEADLINE_MS,
      });
    } catch (error) {
      // TelegramSendError messages never contain the token (boundedDescription).
      console.error('[telegram/owner-bot] reply not sent:', describe(error));
      break;
    }
  }
  return handled();
}
