import { isManualExpenseCategory } from '@/lib/expenseCategories';
import { createClient } from '@/lib/supabase/server';
import { buildExpenseNotification } from '@/lib/telegram/expenseNotification';
import { targetChatId } from '@/lib/telegram/clubChat';
import { deleteTelegramMessage } from '@/lib/telegram/deleteTelegramMessage';
import { sendTelegramMessage } from '@/lib/telegram/sendDailyFinanceReport';
import { PAYMENT_METHODS, type Expense } from '@/types';

const PAYMENT_SOURCES = ['game_club', 'bar'] as const;

interface ExpenseRequestBody {
  clubId?: unknown;
  date?: unknown;
  amount?: unknown;
  category?: unknown;
  paymentMethod?: unknown;
  paymentSource?: unknown;
  comment?: unknown;
}

interface ValidExpenseRequestBody {
  clubId: string;
  date: string;
  amount: number;
  category: string;
  paymentMethod: (typeof PAYMENT_METHODS)[number];
  paymentSource: (typeof PAYMENT_SOURCES)[number];
  comment?: string | null;
}

interface DeleteExpenseRequestBody {
  clubId?: unknown;
  expenseId?: unknown;
}

function isValidBody(body: ExpenseRequestBody): body is ValidExpenseRequestBody {
  return typeof body.clubId === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(String(body.date))
    && typeof body.amount === 'number'
    && Number.isFinite(body.amount)
    && body.amount > 0
    && typeof body.category === 'string'
    && isManualExpenseCategory(body.category.trim())
    && PAYMENT_METHODS.includes(body.paymentMethod as (typeof PAYMENT_METHODS)[number])
    && PAYMENT_SOURCES.includes(body.paymentSource as (typeof PAYMENT_SOURCES)[number])
    && (body.comment === null || body.comment === undefined || (typeof body.comment === 'string' && body.comment.length <= 300));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as ExpenseRequestBody | null;
  if (!body || !isValidBody(body)) {
    return Response.json({ error: 'Invalid expense data' }, { status: 400 });
  }

  const { data, error } = await supabase.from('expenses').insert({
    club_id: body.clubId,
    date: body.date,
    amount: body.amount,
    category: body.category.trim(),
    payment_method: body.paymentMethod,
    payment_source: body.paymentSource,
    comment: typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null,
    created_by: user.id,
  }).select('*').single();

  if (error) return Response.json({ error: error.message }, { status: 400 });

  const expense = data as Expense;
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle();
  const addedBy = profile?.full_name?.trim()
    || (typeof user.user_metadata.full_name === 'string' ? user.user_metadata.full_name.trim() : '')
    || user.email
    || user.id;
  const chatId = targetChatId(expense.club_id);
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  let notificationSent = false;

  if (chatId && botToken) {
    try {
      const telegram = await sendTelegramMessage({
        botToken,
        chatId,
        text: buildExpenseNotification({
          addedBy,
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
      } else {
        notificationSent = true;
      }
    } catch (notificationError) {
      console.error('[telegram/expense] notification failed', {
        clubId: expense.club_id,
        expenseId: expense.id,
        error: notificationError instanceof Error ? notificationError.message : String(notificationError),
      });
    }
  }

  return Response.json({ expense, notificationSent }, { status: 201 });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null) as DeleteExpenseRequestBody | null;
  if (!body || typeof body.clubId !== 'string' || typeof body.expenseId !== 'string') {
    return Response.json({ error: 'Invalid expense deletion data' }, { status: 400 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from('club_memberships')
    .select('role')
    .eq('club_id', body.clubId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membershipError) return Response.json({ error: membershipError.message }, { status: 400 });
  if (membership?.role !== 'owner') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const { data: expense, error: expenseError } = await supabase
    .from('expenses')
    .select('*') // Includes the optional salary link; also works before migration 059.
    .eq('club_id', body.clubId)
    .eq('id', body.expenseId)
    .maybeSingle();

  if (expenseError) return Response.json({ error: expenseError.message }, { status: 400 });
  if (!expense) return Response.json({ error: 'Expense not found' }, { status: 404 });

  if (expense.salary_entry_id) {
    // Payroll-linked expenses are only removable through the audited RPC, which
    // soft-deletes the salary entry and removes the linked expense atomically.
    const { error: salaryError } = await supabase.rpc('delete_salary_record', {
      p_club_id: body.clubId,
      p_id: expense.salary_entry_id,
      p_kind: 'entry',
    });
    if (salaryError) {
      console.error('[expenses] salary payment deletion failed', { clubId: body.clubId, expenseId: body.expenseId, error: salaryError.message });
      return Response.json({ error: salaryError.message }, { status: 400 });
    }
    return Response.json({ deleted: true });
  }

  // Telegram cleanup is best-effort: the bot cannot remove messages older than
  // 48 hours (or ones it lost access to), and that must never stop the owner
  // from deleting the ledger entry itself.
  if (expense.telegram_chat_id && expense.telegram_message_id) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      try {
        await deleteTelegramMessage({
          botToken,
          chatId: expense.telegram_chat_id,
          messageId: Number(expense.telegram_message_id),
        });
      } catch (telegramError) {
        console.error('[telegram/expense] message deletion failed', {
          clubId: body.clubId,
          expenseId: body.expenseId,
          error: telegramError instanceof Error ? telegramError.message : String(telegramError),
        });
      }
    }
  }

  const { error: deleteError } = await supabase
    .from('expenses')
    .delete()
    .eq('club_id', body.clubId)
    .eq('id', body.expenseId);

  if (deleteError) {
    console.error('[expenses] deletion failed', { clubId: body.clubId, expenseId: body.expenseId, error: deleteError.message });
    return Response.json({ error: deleteError.message }, { status: 400 });
  }
  return Response.json({ deleted: true });
}
