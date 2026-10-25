import { after } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { isManualExpenseCategory } from '@/lib/expenseCategories';
import { normalizePaymentMethods } from '@/lib/paymentMethods';
import { createClient } from '@/lib/supabase/server';
import { actorName } from '@/lib/telegram/actorName';
import { buildExpenseNotification } from '@/lib/telegram/expenseNotification';
import { targetChatId } from '@/lib/telegram/clubChat';
import { deleteTelegramMessage } from '@/lib/telegram/deleteTelegramMessage';
import { editTelegramMessage } from '@/lib/telegram/editTelegramMessage';
import { isIsoDate, sendTelegramMessage } from '@/lib/telegram/sendDailyFinanceReport';
import { serverTodayIso } from '@/lib/utils';
import { PAYMENT_METHODS, type Expense } from '@/types';
import { expenseErrorCode, expenseErrorResponse } from './errors';

const PAYMENT_SOURCES = ['game_club', 'bar'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

type DatabaseError = { message: string; code?: string };

interface ExpenseRequestBody {
  /** Optional client-generated UUID; a retried submit with the same id is recorded once. */
  id?: unknown;
  clubId?: unknown;
  date?: unknown;
  amount?: unknown;
  category?: unknown;
  paymentMethod?: unknown;
  paymentSource?: unknown;
  comment?: unknown;
  /** Optional planned expense (091) this payment belongs to. */
  presetId?: unknown;
}

interface ValidExpenseRequestBody {
  id?: string;
  clubId: string;
  date: string;
  amount: number;
  category: string;
  paymentMethod: (typeof PAYMENT_METHODS)[number];
  paymentSource: (typeof PAYMENT_SOURCES)[number];
  comment?: string | null;
  presetId?: string | null;
}

interface DeleteExpenseRequestBody {
  clubId?: unknown;
  expenseId?: unknown;
}

function isValidBody(body: ExpenseRequestBody): body is ValidExpenseRequestBody {
  return (body.id === undefined || isId(body.id))
    && isId(body.clubId)
    && typeof body.date === 'string'
    && isIsoDate(body.date)
    && typeof body.amount === 'number'
    && Number.isFinite(body.amount)
    && body.amount > 0
    && typeof body.category === 'string'
    && isManualExpenseCategory(body.category.trim())
    && PAYMENT_METHODS.includes(body.paymentMethod as (typeof PAYMENT_METHODS)[number])
    && PAYMENT_SOURCES.includes(body.paymentSource as (typeof PAYMENT_SOURCES)[number])
    && (body.comment === null || body.comment === undefined || (typeof body.comment === 'string' && body.comment.length <= 300))
    && (body.presetId === null || body.presetId === undefined || isId(body.presetId));
}

/** Postgres invalid/out-of-range datetime (e.g. the future-date guard of migration 086). */
const INVALID_DATE_CODES = new Set(['22007', '22008']);

function failure(scope: string, context: Record<string, unknown>, error: DatabaseError) {
  console.error(`[expenses] ${scope} failed`, { ...context, code: error.code, error: error.message });
  if (error.code && INVALID_DATE_CODES.has(error.code)) return expenseErrorResponse('INVALID_REQUEST');
  return expenseErrorResponse(expenseErrorCode(error));
}

/** Same request id must describe the same expense; anything else is a conflicting reuse. */
function sameExpense(existing: Record<string, unknown>, row: Record<string, unknown>) {
  return Number(existing.amount) === Number(row.amount)
    && ['date', 'category', 'payment_method', 'payment_source', 'comment', 'preset_id'].every((field) => (existing[field] ?? null) === (row[field] ?? null));
}

/** Best-effort, after the response: Telegram never fails or delays an already saved expense. */
async function notifyExpense(supabase: SupabaseClient, user: User, expense: Expense) {
  const chatId = targetChatId(expense.club_id);
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!chatId || !botToken) return;
  try {
    const telegram = await sendTelegramMessage({
      botToken,
      chatId,
      text: buildExpenseNotification({
        addedBy: await actorName(supabase, user),
        amount: Number(expense.amount),
        category: expense.category,
        comment: expense.comment,
        date: expense.date,
        paymentMethod: expense.payment_method,
        paymentSource: expense.payment_source,
      }),
    });
    const { error: coordinateError } = await supabase
      .from('expenses')
      .update({
        telegram_chat_id: String(telegram.result.chat.id),
        telegram_message_id: telegram.result.message_id,
      })
      .eq('club_id', expense.club_id)
      .eq('id', expense.id);

    if (coordinateError) {
      console.error('[telegram/expense] message coordinates were not saved', {
        clubId: expense.club_id,
        expenseId: expense.id,
        error: coordinateError.message,
      });
    }
  } catch (notificationError) {
    console.error('[telegram/expense] notification failed', {
      clubId: expense.club_id,
      expenseId: expense.id,
      error: notificationError instanceof Error ? notificationError.message : String(notificationError),
    });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return expenseErrorResponse('UNAUTHORIZED');

  const body = await request.json().catch(() => null) as ExpenseRequestBody | null;
  if (!body || !isValidBody(body)) return expenseErrorResponse('INVALID_REQUEST');
  const context = { clubId: body.clubId, expenseId: body.id ?? null };

  // Only the club's configured methods are accepted; RLS scopes the read to the caller's clubs.
  const { data: club, error: clubError } = await supabase
    .from('clubs')
    .select('enabled_payment_methods, business_day_start_hour')
    .eq('id', body.clubId)
    .maybeSingle();
  if (clubError) return failure('club lookup', context, clubError);
  if (!club) return expenseErrorResponse('FORBIDDEN');
  // An expense cannot be dated after the club's business today (also enforced by 086).
  if (body.date > serverTodayIso(new Date(), club.business_day_start_hour)) {
    return expenseErrorResponse('INVALID_REQUEST');
  }
  if (!normalizePaymentMethods(club.enabled_payment_methods).includes(body.paymentMethod)) {
    return expenseErrorResponse('PAYMENT_METHOD_DISABLED');
  }

  const row = {
    club_id: body.clubId,
    date: body.date,
    amount: body.amount,
    category: body.category.trim(),
    payment_method: body.paymentMethod,
    payment_source: body.paymentSource,
    comment: typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null,
    created_by: user.id,
    // Sent only when chosen, so clubs without migration 091 keep saving expenses.
    // The 091 trigger checks the preset is live and matches category and source.
    ...(body.presetId ? { preset_id: body.presetId } : {}),
  };

  let expense: Expense;
  if (body.id) {
    // Insert-or-nothing: a retry of the same submit returns the saved row without a second notification.
    const { data, error } = await supabase
      .from('expenses')
      .upsert({ id: body.id, ...row }, { onConflict: 'id', ignoreDuplicates: true })
      .select('*')
      .maybeSingle();
    if (error) return failure('insert', context, error);
    if (!data) {
      const { data: existing, error: existingError } = await supabase
        .from('expenses')
        .select('*')
        .eq('club_id', body.clubId)
        .eq('id', body.id)
        .maybeSingle();
      if (existingError) return failure('retry lookup', context, existingError);
      if (!existing || !sameExpense(existing, row)) return expenseErrorResponse('REQUEST_CONFLICT');
      return Response.json({ expense: existing, created: false, notificationQueued: false }, { status: 200 });
    }
    expense = data as Expense;
  } else {
    const { data, error } = await supabase.from('expenses').insert(row).select('*').single();
    if (error) return failure('insert', context, error);
    expense = data as Expense;
  }

  after(() => notifyExpense(supabase, user, expense));
  return Response.json({ expense, created: true, notificationQueued: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return expenseErrorResponse('UNAUTHORIZED');

  const body = await request.json().catch(() => null) as DeleteExpenseRequestBody | null;
  if (!body || !isId(body.clubId) || !isId(body.expenseId)) return expenseErrorResponse('INVALID_REQUEST');
  const clubId = body.clubId;
  const expenseId = body.expenseId;
  const context = { clubId, expenseId };

  const { data: membership, error: membershipError } = await supabase
    .from('club_memberships')
    .select('role')
    .eq('club_id', clubId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membershipError) return failure('membership lookup', context, membershipError);
  if (membership?.role !== 'owner') return expenseErrorResponse('FORBIDDEN');

  const { data: expense, error: expenseError } = await supabase
    .from('expenses')
    .select('*') // Includes the optional salary link; also works before migration 059.
    .eq('club_id', clubId)
    .eq('id', expenseId)
    .maybeSingle();

  if (expenseError) return failure('lookup', context, expenseError);
  if (!expense) return expenseErrorResponse('NOT_FOUND');

  // Payroll-linked expenses are removed from Salaries, where a deletion reason
  // is required; the audited RPC then removes this expense atomically.
  if (expense.salary_entry_id) return expenseErrorResponse('SALARY_PAYMENT_IMMUTABLE');

  // Remove the ledger row first: a failed or refused delete must leave its
  // Telegram message in place.
  const { data: deleted, error: deleteError } = await supabase
    .from('expenses')
    .delete()
    .eq('club_id', clubId)
    .eq('id', expenseId)
    .select('id');

  if (deleteError) return failure('deletion', context, deleteError);
  if (!deleted?.length) return expenseErrorResponse('NOT_FOUND');

  // Telegram cleanup is best-effort: the bot cannot remove messages older than
  // 48 hours (or ones it lost access to), and that never undoes the deletion.
  // The coordinates are user-writable under RLS, so only touch the club's own
  // configured group: a forged chat id must never let the bot delete elsewhere.
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const clubChatId = targetChatId(clubId);
  if (
    botToken
    && clubChatId
    && expense.telegram_message_id
    && String(expense.telegram_chat_id) === clubChatId
  ) {
    after(async () => {
      try {
        await deleteTelegramMessage({
          botToken,
          chatId: clubChatId,
          messageId: Number(expense.telegram_message_id),
        });
      } catch (telegramError) {
        console.error('[telegram/expense] message deletion failed', {
          ...context,
          error: telegramError instanceof Error ? telegramError.message : String(telegramError),
        });
      }
    });
  }
  return Response.json({ deleted: true });
}

interface UpdateExpenseRequestBody {
  clubId?: unknown;
  expenseId?: unknown;
  paymentMethod?: unknown;
  date?: unknown;
}

/** Owner correction of an expense's payment method and/or date; the group message is edited to match. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return expenseErrorResponse('UNAUTHORIZED');

  const body = await request.json().catch(() => null) as UpdateExpenseRequestBody | null;
  const hasMethod = body?.paymentMethod !== undefined;
  const hasDate = body?.date !== undefined;
  if (!body || !isId(body.clubId) || !isId(body.expenseId) || (!hasMethod && !hasDate)
    || (hasMethod && !PAYMENT_METHODS.includes(body.paymentMethod as (typeof PAYMENT_METHODS)[number]))
    || (hasDate && (typeof body.date !== 'string' || !isIsoDate(body.date)))) {
    return expenseErrorResponse('INVALID_REQUEST');
  }
  const clubId = body.clubId;
  const expenseId = body.expenseId;
  const paymentMethod = hasMethod ? body.paymentMethod as (typeof PAYMENT_METHODS)[number] : null;
  const date = hasDate ? body.date as string : null;
  const context = { clubId, expenseId };

  const { data: club, error: clubError } = await supabase
    .from('clubs')
    .select('enabled_payment_methods, business_day_start_hour')
    .eq('id', clubId)
    .maybeSingle();
  if (clubError) return failure('club lookup', context, clubError);
  if (!club) return expenseErrorResponse('FORBIDDEN');
  if (paymentMethod && !normalizePaymentMethods(club.enabled_payment_methods).includes(paymentMethod)) {
    return expenseErrorResponse('PAYMENT_METHOD_DISABLED');
  }
  // Not after the club's business today (also enforced by the 095 RPC).
  if (date && date > serverTodayIso(new Date(), club.business_day_start_hour)) {
    return expenseErrorResponse('INVALID_REQUEST');
  }

  const { data: expense, error: expenseError } = await supabase
    .from('expenses')
    .select('*')
    .eq('club_id', clubId)
    .eq('id', expenseId)
    .maybeSingle();
  if (expenseError) return failure('lookup', context, expenseError);
  if (!expense) return expenseErrorResponse('NOT_FOUND');
  // Payroll payments keep the method and date recorded on their salary entry.
  if (expense.salary_entry_id) return expenseErrorResponse('SALARY_PAYMENT_IMMUTABLE');
  const changeMethod = paymentMethod !== null && expense.payment_method !== paymentMethod;
  const changeDate = date !== null && expense.date !== date;
  if (!changeMethod && !changeDate) return Response.json({ expense });

  // Owner check, the method/date rules and each write happen atomically in their RPC.
  if (changeMethod) {
    const { error } = await supabase.rpc('update_expense_payment_method', {
      p_club_id: clubId,
      p_expense_id: expenseId,
      p_payment_method: paymentMethod,
    });
    if (error) return failure('payment method change', context, error);
  }
  if (changeDate) {
    const { error } = await supabase.rpc('update_expense_date', {
      p_club_id: clubId,
      p_expense_id: expenseId,
      p_date: date,
    });
    if (error) return failure('date change', context, error);
  }
  const updated = {
    ...expense,
    ...(changeMethod ? { payment_method: paymentMethod } : {}),
    ...(changeDate ? { date } : {}),
  } as Expense;

  // Best-effort, as for deletion: only the club's own group, and an edit
  // Telegram refuses (old message, lost access) never undoes the change.
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const clubChatId = targetChatId(clubId);
  if (
    botToken
    && clubChatId
    && updated.telegram_message_id
    && String(updated.telegram_chat_id) === clubChatId
  ) {
    after(async () => {
      try {
        const { data: creator } = updated.created_by
          ? await supabase.from('profiles').select('full_name').eq('id', updated.created_by).maybeSingle()
          : { data: null };
        const creatorName = typeof creator?.full_name === 'string' ? creator.full_name.trim() : '';
        await editTelegramMessage({
          botToken,
          chatId: clubChatId,
          messageId: Number(updated.telegram_message_id),
          text: buildExpenseNotification({
            addedBy: creatorName || '—',
            amount: Number(updated.amount),
            category: updated.category,
            comment: updated.comment,
            date: updated.date,
            paymentMethod: updated.payment_method,
            paymentSource: updated.payment_source,
          }),
        });
      } catch (telegramError) {
        console.error('[telegram/expense] message edit failed', {
          ...context,
          error: telegramError instanceof Error ? telegramError.message : String(telegramError),
        });
      }
    });
  }
  return Response.json({ expense: updated });
}
