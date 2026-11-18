import { after } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import {
  deleteReserveEntry,
  depositToReserve,
  returnFromReserve,
  type ReserveErrorCode,
} from '@/lib/supabase/ownerReserve';
import { actorName } from '@/lib/telegram/actorName';
import { sendClubNotice } from '@/lib/telegram/entryChangeNotification';
import {
  buildReserveEntryDeletedNotice,
  buildReserveMoveNotice,
  type ReserveEntryNoticeRow,
  type ReserveNoticePart,
} from '@/lib/telegram/reserveNotification';
import { OWNER_WITHDRAWAL_PAYMENT_METHODS, OWNER_WITHDRAWAL_SOURCES, type OwnerWithdrawalPaymentMethod, type OwnerWithdrawalSource } from '@/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isSource = (value: unknown): value is OwnerWithdrawalSource => OWNER_WITHDRAWAL_SOURCES.includes(value as OwnerWithdrawalSource);
const isMethod = (value: unknown): value is OwnerWithdrawalPaymentMethod => OWNER_WITHDRAWAL_PAYMENT_METHODS.includes(value as OwnerWithdrawalPaymentMethod);

const STATUS: Record<ReserveErrorCode, number> = {
  exceeds_available: 409,
  insufficient: 409,
  day_balance: 409,
  already_used: 409,
  migration_required: 503,
  forbidden: 403,
  failed: 500,
};

const refuse = (failure: ReserveErrorCode | 'unauthorized' | 'invalid') => Response.json(
  { failure: failure === 'unauthorized' ? 'forbidden' : failure === 'invalid' ? 'failed' : failure },
  { status: failure === 'unauthorized' ? 401 : failure === 'invalid' ? 400 : STATUS[failure] },
);

/** Best-effort, after the response: Telegram never fails or delays a saved reserve change. */
function notify(supabase: SupabaseClient, user: User, clubId: string, text: (by: string) => string, context: Record<string, unknown>) {
  after(async () => sendClubNotice(clubId, text(await actorName(supabase, user)), context));
}

interface MoveBody {
  clubId: string;
  kind: 'deposit' | 'return';
  month: string;
  /** The day in `month` the money moved; the database checks it is not in the future. */
  date: string | null;
  source: OwnerWithdrawalSource;
  comment: string;
  parts: Array<{ id: string; method: OwnerWithdrawalPaymentMethod | null; amount: number }>;
}

function parseMove(body: Record<string, unknown> | null): MoveBody | null {
  if (!body || !isId(body.clubId) || (body.kind !== 'deposit' && body.kind !== 'return')
    || typeof body.month !== 'string' || !MONTH.test(body.month) || !isSource(body.source)
    || (body.comment != null && (typeof body.comment !== 'string' || body.comment.length > 300))
    || (body.date != null && (typeof body.date !== 'string' || !DAY.test(body.date) || body.date.slice(0, 7) !== body.month))
    || !Array.isArray(body.parts) || body.parts.length === 0 || body.parts.length > OWNER_WITHDRAWAL_PAYMENT_METHODS.length) {
    return null;
  }
  const source = body.source;
  const parts: MoveBody['parts'] = [];
  for (const raw of body.parts as unknown[]) {
    const part = raw as Record<string, unknown> | null;
    if (!part || !isId(part.id) || !isAmount(part.amount)) return null;
    // Game Club money always names its method; Bar money has none.
    if (source === 'game_club' ? !isMethod(part.method) : part.method != null) return null;
    parts.push({ id: part.id, method: source === 'game_club' ? part.method as OwnerWithdrawalPaymentMethod : null, amount: part.amount });
  }
  return { clubId: body.clubId, kind: body.kind, month: body.month, date: typeof body.date === 'string' ? body.date : null, source, comment: typeof body.comment === 'string' ? body.comment : '', parts };
}

/**
 * Moves owner profit into the reserve (deposit) or back out (return). Several
 * parts are one Game Club move split by method, as "Put all in" makes them;
 * the group gets one message for everything that was newly recorded.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return refuse('unauthorized');

  const body = parseMove(await request.json().catch(() => null) as Record<string, unknown> | null);
  if (!body) return refuse('invalid');

  // Owner access, the month's available profit and the reserve's holdings are
  // checked atomically by each RPC; a retried id is recorded once.
  const write = body.kind === 'deposit' ? depositToReserve : returnFromReserve;
  const recorded: ReserveNoticePart[] = [];
  let failure: ReserveErrorCode | null = null;
  for (const part of body.parts) {
    const result = await write(supabase, body.clubId, {
      id: part.id, month: body.month, date: body.date, source: body.source, method: part.method, amount: part.amount, comment: body.comment,
    });
    if (result.failure) {
      failure = result.failure;
      console.error('[reserve] move refused', { clubId: body.clubId, entryId: part.id, kind: body.kind, failure });
      break;
    }
    if (result.created) recorded.push({ method: part.method, amount: part.amount });
  }

  // Parts saved before a refusal stay saved, so they are still reported.
  if (recorded.length > 0) {
    notify(supabase, user, body.clubId, (by) => buildReserveMoveNotice({
      kind: body.kind, month: body.month, source: body.source, parts: recorded, comment: body.comment.trim() || null, by,
    }), { kind: body.kind, month: body.month });
  }
  return failure ? refuse(failure) : Response.json({ recorded: recorded.length });
}

/** Deletes a deposit or return; the database refuses money that was already used. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return refuse('unauthorized');

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || !isId(body.clubId) || !isId(body.entryId)) return refuse('invalid');
  const clubId = body.clubId;
  const entryId = body.entryId;

  const { data: entry, error: lookupError } = await supabase
    .from('owner_reserve_entries')
    .select('kind, period_month, source, payment_method, amount, comment')
    .eq('club_id', clubId)
    .eq('id', entryId)
    .maybeSingle();
  if (lookupError) {
    console.error('[reserve] lookup failed', { clubId, entryId, error: lookupError.message });
    return refuse('failed');
  }
  if (!entry) return refuse('failed');

  const failure = await deleteReserveEntry(supabase, clubId, entryId);
  if (failure) return refuse(failure);

  notify(supabase, user, clubId, (by) => buildReserveEntryDeletedNotice(entry as ReserveEntryNoticeRow, by), { entryId });
  return Response.json({ deleted: true });
}
