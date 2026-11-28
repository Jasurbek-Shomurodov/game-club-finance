import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';
import { handleOwnerBotCallback, type OwnerBotCallbackReply } from '@/lib/telegram/ownerBot/callbacks';
import { handleOwnerBotMessage, type OwnerBotReply } from '@/lib/telegram/ownerBot/handler';
import { deliverOwnerBotReply, sendOwnerBotPrompt } from '@/lib/telegram/ownerBot/outgoing';
import { answerOwnerBotCallback, editOwnerBotMessage } from '@/lib/telegram/ownerBot/telegramApi';
import { errorText, pressFailedText } from '@/lib/telegram/ownerBot/texts';
import { parseOwnerBotCallbackQuery, parseOwnerBotMessage, type OwnerBotCallbackQuery } from '@/lib/telegram/ownerBot/update';
import { ownerBotWebhookAuthStatus } from '@/lib/telegram/ownerBot/webhookAuth';

/**
 * Webhook of the owner money bot (docs/plans/owner-money-bot.md,
 * docs/runbooks/owner-money-bot.md). Telegram calls it with every update; it
 * answers private messages and presses of its buttons, acting only for the
 * sender's own linked account.
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
  const deadlineAt = startedAt + REPLY_DEADLINE_MS;
  const press = parseOwnerBotCallbackQuery(update);
  if (press) {
    await answerPress(supabase, botToken, press, deadlineAt);
    return handled();
  }
  const message = parseOwnerBotMessage(update);
  if (!message) return handled();

  let replies: OwnerBotReply[];
  try {
    replies = await handleOwnerBotMessage(supabase, message);
  } catch (error) {
    console.error('[telegram/owner-bot] update not handled:', describe(error));
    replies = [{ text: errorText(), keyboard: null }];
  }

  for (const reply of replies) {
    try {
      await deliverOwnerBotReply(supabase, reply, {
        botToken,
        chatId: message.chatId,
        telegramUserId: message.telegramUserId,
        deadlineAt,
      });
    } catch (error) {
      // TelegramSendError messages never contain the token (boundedDescription).
      console.error('[telegram/owner-bot] reply not sent:', describe(error));
      break;
    }
  }
  return handled();
}

/**
 * A button press: the toast first (it also stops the button's spinner),
 * then the message redrawn in place, then for ✏️ Другая сумма the question
 * as a new message. A resent update presses the same button again, which the
 * database answers without saving twice.
 */
async function answerPress(supabase: SupabaseClient, botToken: string, press: OwnerBotCallbackQuery, deadlineAt: number) {
  let reply: OwnerBotCallbackReply;
  try {
    reply = await handleOwnerBotCallback(supabase, press);
  } catch (error) {
    console.error('[telegram/owner-bot] button press not handled:', describe(error));
    reply = { answer: { text: pressFailedText(), showAlert: true }, edit: null };
  }

  try {
    await answerOwnerBotCallback({ botToken, callbackQueryId: press.callbackQueryId, ...reply.answer });
  } catch (error) {
    // An answer after Telegram's time limit is refused; the message is still redrawn.
    console.error('[telegram/owner-bot] press not answered:', describe(error));
  }
  if (!press.privateChat || press.chatId === null || press.messageId === null) return;
  if (reply.edit) {
    try {
      await editOwnerBotMessage({ botToken, chatId: press.chatId, messageId: press.messageId, ...reply.edit });
    } catch (error) {
      console.error('[telegram/owner-bot] message not redrawn:', describe(error));
    }
  }
  if (reply.prompt) {
    try {
      await sendOwnerBotPrompt(supabase, {
        botToken,
        chatId: press.chatId,
        telegramUserId: press.telegramUserId,
        deadlineAt,
        ...reply.prompt,
      });
    } catch (error) {
      console.error('[telegram/owner-bot] amount question not sent:', describe(error));
    }
  }
}
