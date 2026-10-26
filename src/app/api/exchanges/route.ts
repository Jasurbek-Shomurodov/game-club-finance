import { after } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { isExchangeMethod, type ExchangeMethod } from '@/lib/calculations/moneyExchanges';
import { validateEntryNote } from '@/lib/entryNote';
import { createClient } from '@/lib/supabase/server';
import { actorName } from '@/lib/telegram/actorName';
import { targetChatId } from '@/lib/telegram/clubChat';
import { deleteTelegramMessage } from '@/lib/telegram/deleteTelegramMessage';
import { buildExchangeDeletedNotice, sendClubNotice } from '@/lib/telegram/entryChangeNotification';
import { buildExchangeNotification } from '@/lib/telegram/exchangeNotification';
import { isIsoDate, sendTelegramMessage } from '@/lib/telegram/sendDailyFinanceReport';
import { exchangeErrorCode, exchangeErrorResponse } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isPositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

type DatabaseError = { message: string; code?: string; hint?: string };

interface ExchangeRow {
  id: string;
  club_id: string;
  date: string;
  from_method: ExchangeMethod;
  to_method: ExchangeMethod;
  from_amount: number | string;
  to_amount: number | string;
  rate: number | string | null;
  comment: string;
  telegram_chat_id: string | null;
  telegram_message_id: number | string | null;
}

function failure(scope: string, context: Record<string, unknown>, error: DatabaseError) {
  console.error(`[exchanges] ${scope} failed`, { ...context, code: error.code, error: error.message });
  return exchangeErrorResponse(exchangeErrorCode(error));
}

/** Best-effort, after the response: Telegram never fails or delays a saved exchange. */
async function notifyExchange(supabase: SupabaseClient, user: User, exchange: ExchangeRow) {
  const chatId = targetChatId(exchange.club_id);
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!chatId || !botToken) return;
  try {
    const telegram = await sendTelegramMessage({
      botToken,
      chatId,
      text: buildExchangeNotification({
        addedBy: await actorName(supabase, user),
        date: exchange.date,
        from: exchange.from_method,
        to: exchange.to_method,
        fromAmount: Number(exchange.from_amount),
        toAmount: Number(exchange.to_amount),
        rate: exchange.rate === null ? null : Number(exchange.rate),
        comment: exchange.comment || null,
      }),
    });
    const { error } = await supabase.rpc('set_money_exchange_telegram_message', {
      p_club_id: exchange.club_id,
      p_id: exchange.id,
      p_chat_id: String(telegram.result.chat.id),
      p_message_id: telegram.result.message_id,
    });
    if (error) {
      console.error('[telegram/exchange] message coordinates were not saved', {
        clubId: exchange.club_id, exchangeId: exchange.id, error: error.message,
      });
    }
  } catch (notificationError) {
    console.error('[telegram/exchange] notification failed', {
      clubId: exchange.club_id,
      exchangeId: exchange.id,
      error: notificationError instanceof Error ? notificationError.message : String(notificationError),
    });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return exchangeErrorResponse('UNAUTHORIZED');

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !isId(body.id) || !isId(body.clubId) || typeof body.date !== 'string' || !isIsoDate(body.date)
    || !isExchangeMethod(body.from) || !isExchangeMethod(body.to) || body.from === body.to
    || !isPositive(body.amount)
    || ((body.from === 'usd' || body.to === 'usd') ? !isPositive(body.rate) : body.rate != null)
    || (body.comment != null && (typeof body.comment !== 'string' || body.comment.length > 300))) {
    return exchangeErrorResponse('INVALID_REQUEST');
  }
  // Every exchange says why the money moved (also enforced by 108).
  if (!validateEntryNote(body.comment).valid) return exchangeErrorResponse('NOTE_REQUIRED');
  const context = { clubId: body.clubId, exchangeId: body.id };

  // Access, the club's enabled methods, the business date and the converted
  // amount are all checked atomically by the RPC; a retried id is recorded once.
  const recorded = await supabase.rpc('record_money_exchange', {
    p_id: body.id,
    p_club_id: body.clubId,
    p_date: body.date,
    p_from_method: body.from,
    p_to_method: body.to,
    p_from_amount: body.amount,
    p_rate: body.rate ?? null,
    p_comment: typeof body.comment === 'string' ? body.comment : '',
  });
  if (recorded.error) return failure('record', context, recorded.error);
  const status = (Array.isArray(recorded.data) ? recorded.data[0] : recorded.data) as { created?: boolean } | null;

  const { data: exchange, error: lookupError } = await supabase
    .from('money_exchanges')
    .select('*')
    .eq('club_id', body.clubId)
    .eq('id', body.id)
    .maybeSingle();
  if (lookupError) return failure('lookup', context, lookupError);
  if (!exchange) return exchangeErrorResponse('NOT_FOUND');

  const created = status?.created === true;
  if (created) after(() => notifyExchange(supabase, user, exchange as ExchangeRow));
  return Response.json({ exchange, created, notificationQueued: created }, { status: created ? 201 : 200 });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return exchangeErrorResponse('UNAUTHORIZED');

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !isId(body.clubId) || !isId(body.exchangeId)) return exchangeErrorResponse('INVALID_REQUEST');
  const clubId = body.clubId;
  const exchangeId = body.exchangeId;
  const context = { clubId, exchangeId };

  const { data: exchange, error: lookupError } = await supabase
    .from('money_exchanges')
    .select('date, from_method, to_method, from_amount, to_amount, comment, telegram_chat_id, telegram_message_id')
    .eq('club_id', clubId)
    .eq('id', exchangeId)
    .maybeSingle();
  if (lookupError) return failure('lookup', context, lookupError);
  if (!exchange) return exchangeErrorResponse('NOT_FOUND');

  // Owner-only and club-scoped in the RPC. A refused delete keeps the message.
  const { error: deleteError } = await supabase.rpc('delete_money_exchange', { p_club_id: clubId, p_id: exchangeId });
  if (deleteError) return failure('deletion', context, deleteError);

  // A deletion is silent in Telegram, so the group also gets its own notice.
  after(async () => sendClubNotice(
    clubId,
    buildExchangeDeletedNotice(exchange as ExchangeRow, await actorName(supabase, user)),
    context,
  ));

  // Same rule as expenses: only the club's own group, never a stored chat id.
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const clubChatId = targetChatId(clubId);
  const coordinates = exchange as Pick<ExchangeRow, 'telegram_chat_id' | 'telegram_message_id'>;
  if (botToken && clubChatId && coordinates.telegram_message_id && String(coordinates.telegram_chat_id) === clubChatId) {
    after(async () => {
      try {
        await deleteTelegramMessage({ botToken, chatId: clubChatId, messageId: Number(coordinates.telegram_message_id) });
      } catch (telegramError) {
        console.error('[telegram/exchange] message deletion failed', {
          ...context,
          error: telegramError instanceof Error ? telegramError.message : String(telegramError),
        });
      }
    });
  }
  return Response.json({ deleted: true });
}
