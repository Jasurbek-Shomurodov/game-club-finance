import { after } from 'next/server';
import { isExchangeMethod } from '@/lib/calculations/moneyExchanges';
import { validateEntryNote } from '@/lib/entryNote';
import { createClient } from '@/lib/supabase/server';
import { actorName } from '@/lib/telegram/actorName';
import { clubMessageToReplyTo } from '@/lib/telegram/clubChat';
import { buildExchangeDeletedNotice, sendClubNotice } from '@/lib/telegram/entryChangeNotification';
import { notifyExchange, type ExchangeRow } from '@/lib/telegram/exchangeDelivery';
import { isIsoDate } from '@/lib/telegram/sendDailyFinanceReport';
import { exchangeErrorCode, exchangeErrorResponse } from './errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isPositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

type DatabaseError = { message: string; code?: string; hint?: string };

function failure(scope: string, context: Record<string, unknown>, error: DatabaseError) {
  console.error(`[exchanges] ${scope} failed`, { ...context, code: error.code, error: error.message });
  return exchangeErrorResponse(exchangeErrorCode(error));
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

  // Owner-only and club-scoped in the RPC. A refused delete sends nothing.
  const { error: deleteError } = await supabase.rpc('delete_money_exchange', { p_club_id: clubId, p_id: exchangeId });
  if (deleteError) return failure('deletion', context, deleteError);

  // The original announcement stays; the deletion notice replies to it, and
  // only when it is in the club's own group (the stored chat id is not trusted).
  const replyTo = clubMessageToReplyTo(clubId, exchange as Pick<ExchangeRow, 'telegram_chat_id' | 'telegram_message_id'>);
  after(async () => sendClubNotice(
    clubId,
    buildExchangeDeletedNotice(exchange as ExchangeRow, await actorName(supabase, user)),
    context,
    replyTo,
  ));
  return Response.json({ deleted: true });
}
