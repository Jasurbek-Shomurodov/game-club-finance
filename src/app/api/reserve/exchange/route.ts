import { after } from 'next/server';
import { validateEntryNote } from '@/lib/entryNote';
import { createClient } from '@/lib/supabase/server';
import { exchangeInReserve, type ReserveErrorCode } from '@/lib/supabase/ownerReserve';
import { notifyExchange, type ExchangeRow } from '@/lib/telegram/exchangeDelivery';
import { isIsoDate } from '@/lib/telegram/sendDailyFinanceReport';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isPositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const METHODS = ['cash', 'terminal', 'card'] as const;
type Method = (typeof METHODS)[number];

const STATUS: Record<ReserveErrorCode, number> = {
  exceeds_available: 409,
  insufficient: 409,
  day_balance: 409,
  already_used: 409,
  day_collected: 409,
  note_required: 400,
  method_disabled: 400,
  migration_required: 503,
  forbidden: 403,
  failed: 500,
};

const refuse = (failure: ReserveErrorCode | 'unauthorized' | 'invalid') => Response.json(
  { failure: failure === 'unauthorized' ? 'forbidden' : failure === 'invalid' ? 'failed' : failure },
  { status: failure === 'unauthorized' ? 401 : failure === 'invalid' ? 400 : STATUS[failure] },
);

/**
 * Buys dollars with the reserve's sums or sells its dollars for sums (170).
 * Owner access, the reserve's sums, the dollars held, the club's methods and
 * the business date are all checked atomically by exchange_owner_reserve; a
 * retried id is recorded once. The club group hears about it like any
 * exchange, so deleting it in Reports or here replies to that message.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return refuse('unauthorized');

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !isId(body.clubId) || !isId(body.id) || !isId(body.entryId) || body.id === body.entryId
    || typeof body.date !== 'string' || !isIsoDate(body.date)
    || (body.direction !== 'buy' && body.direction !== 'sell')
    || !METHODS.includes(body.method as Method)
    || !isPositive(body.amount) || !isPositive(body.rate)
    || typeof body.comment !== 'string' || body.comment.length > 300) {
    return refuse('invalid');
  }
  if (!validateEntryNote(body.comment).valid) return refuse('note_required');

  const clubId = body.clubId;
  const result = await exchangeInReserve(supabase, clubId, {
    id: body.id,
    entryId: body.entryId,
    date: body.date,
    direction: body.direction,
    method: body.method as Method,
    amount: body.amount,
    rate: body.rate,
    comment: body.comment,
  });
  if (result.failure) {
    console.error('[reserve/exchange] refused', { clubId, exchangeId: body.id, failure: result.failure });
    return refuse(result.failure);
  }

  if (result.created) {
    const exchangeId = body.id;
    after(async () => {
      const { data: exchange, error } = await supabase
        .from('money_exchanges')
        .select('*')
        .eq('club_id', clubId)
        .eq('id', exchangeId)
        .maybeSingle();
      if (error || !exchange) {
        console.error('[reserve/exchange] lookup for the notice failed', { clubId, exchangeId, error: error?.message });
        return;
      }
      await notifyExchange(supabase, user, exchange as ExchangeRow, true);
    });
  }
  return Response.json({ created: result.created }, { status: result.created ? 201 : 200 });
}
