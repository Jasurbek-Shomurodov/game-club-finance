import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deleteDailyCashEntry } from '@/lib/supabase/dailyCashEntries';
import { isDayCollectedError } from '@/lib/supabase/dailyCashCollections';
import { isInsufficientBalanceError } from '@/lib/supabase/errors';
import { actorName } from '@/lib/telegram/actorName';
import { buildIncomeChangedNotice, buildIncomeDeletedNotice, sendClubNotice, type IncomeNoticeRow } from '@/lib/telegram/entryChangeNotification';
import { isIsoDate } from '@/lib/telegram/sendDailyFinanceReport';
import { serverTodayIso } from '@/lib/utils';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

const ERRORS = {
  UNAUTHORIZED: 401,
  INVALID_REQUEST: 400,
  NOT_FOUND: 404,
  DUPLICATE_DATE: 409,
  DAY_COLLECTED: 409,
  INSUFFICIENT_BALANCE: 409,
  SERVER_ERROR: 500,
} as const;

function errorResponse(code: keyof typeof ERRORS) {
  return Response.json({ code }, { status: ERRORS[code] });
}

/**
 * Deletes a daily income entry and tells the club group. The delete runs as
 * the signed-in user, so RLS (owner only, migration 036) decides; a refused
 * or missing row is a 404, a collected day or already-spent money a 409 and a
 * database fault a 500,
 * and none of them sends anything.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse('UNAUTHORIZED');

  const body = await request.json().catch(() => null) as { clubId?: unknown; entryId?: unknown } | null;
  if (!body || !isId(body.clubId) || !isId(body.entryId)) return errorResponse('INVALID_REQUEST');
  const clubId = body.clubId;
  const entryId = body.entryId;

  const { data: entry, error } = await supabase
    .from('daily_cash_entries')
    .select('date, cash_income, terminal_income, card_income, playstation_income')
    .eq('club_id', clubId)
    .eq('id', entryId)
    .maybeSingle();
  if (error) {
    console.error('[daily-cash] lookup failed', { clubId, entryId, code: error.code, error: error.message });
    return errorResponse('SERVER_ERROR');
  }
  if (!entry) return errorResponse('NOT_FOUND');

  const deletion = await deleteDailyCashEntry(supabase, clubId, entryId);
  if (deletion === 'not_found') return errorResponse('NOT_FOUND');
  if (deletion === 'day_closed') return errorResponse('DAY_COLLECTED');
  if (deletion === 'already_spent') return errorResponse('INSUFFICIENT_BALANCE');
  if (deletion === 'failed') {
    console.error('[daily-cash] deletion failed', { clubId, entryId });
    return errorResponse('SERVER_ERROR');
  }

  // A deletion is silent in Telegram, so the group gets its own notice.
  after(async () => sendClubNotice(
    clubId,
    buildIncomeDeletedNotice(entry as IncomeNoticeRow, await actorName(supabase, user)),
    { entryId },
  ));
  return Response.json({ deleted: true });
}

const INCOME_FIELDS = ['cashIncome', 'terminalIncome', 'cardIncome', 'playstationIncome'] as const;
const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const NOTICE_COLUMNS = 'date, cash_income, terminal_income, card_income, playstation_income, comment';

type IncomeEntry = IncomeNoticeRow & { comment: string | null };

/**
 * Saves a correction to a daily income entry and tells the club group what
 * changed. The update runs as the signed-in user, so RLS decides who may edit
 * (owners always, admins within their edit window); a refused or missing row
 * is a 404 and sends nothing, like a deletion.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse('UNAUTHORIZED');

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (
    !body || !isId(body.clubId) || !isId(body.entryId)
    || typeof body.date !== 'string' || !isIsoDate(body.date)
    || !INCOME_FIELDS.every((field) => isAmount(body[field]))
    || (body.comment !== null && typeof body.comment !== 'string')
  ) return errorResponse('INVALID_REQUEST');
  const clubId = body.clubId;
  const entryId = body.entryId;
  const context = { clubId, entryId };
  const comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null;

  const [{ data: club, error: clubError }, { data: before, error: lookupError }] = await Promise.all([
    supabase.from('clubs').select('business_day_start_hour').eq('id', clubId).maybeSingle(),
    supabase.from('daily_cash_entries').select(NOTICE_COLUMNS).eq('club_id', clubId).eq('id', entryId).maybeSingle(),
  ]);
  if (clubError || lookupError) {
    console.error('[daily-cash] lookup failed', { ...context, error: (clubError ?? lookupError)?.message });
    return errorResponse('SERVER_ERROR');
  }
  if (!club || !before) return errorResponse('NOT_FOUND');
  if (body.date > serverTodayIso(new Date(), club.business_day_start_hour)) return errorResponse('INVALID_REQUEST');

  const changes = {
    date: body.date,
    cash_income: body.cashIncome as number,
    terminal_income: body.terminalIncome as number,
    card_income: body.cardIncome as number,
    playstation_income: body.playstationIncome as number,
    comment,
  };
  const { data: updated, error } = await supabase
    .from('daily_cash_entries')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('club_id', clubId)
    .eq('id', entryId)
    .select('id');
  if (error) {
    if (error.code === '23505') return errorResponse('DUPLICATE_DATE');
    if (isDayCollectedError(error)) return errorResponse('DAY_COLLECTED');
    if (isInsufficientBalanceError(error)) return errorResponse('INSUFFICIENT_BALANCE');
    console.error('[daily-cash] update failed', { ...context, code: error.code, error: error.message });
    return errorResponse('SERVER_ERROR');
  }
  // RLS filtered the update out: the edit window closed or no permission.
  if ((updated ?? []).length === 0) return errorResponse('NOT_FOUND');

  const previous = before as IncomeEntry;
  const unchanged = previous.date === changes.date
    && (previous.comment ?? null) === changes.comment
    && Number(previous.cash_income ?? 0) === changes.cash_income
    && Number(previous.terminal_income ?? 0) === changes.terminal_income
    && Number(previous.card_income ?? 0) === changes.card_income
    && Number(previous.playstation_income ?? 0) === changes.playstation_income;
  // An edit is otherwise silent, so the group hears about every real change.
  if (!unchanged) {
    after(async () => sendClubNotice(
      clubId,
      buildIncomeChangedNotice(previous, changes, await actorName(supabase, user)),
      { ...context, action: 'changed' },
    ));
  }
  return Response.json({ updated: true });
}
