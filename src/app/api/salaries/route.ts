import { after } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { isMissingDatabaseFunction } from '@/lib/supabase/errors';
import { createClient } from '@/lib/supabase/server';
import { actorName } from '@/lib/telegram/actorName';
import { targetChatId } from '@/lib/telegram/clubChat';
import { buildSalaryNotification, type SalaryNotificationInput } from '@/lib/telegram/salaryNotification';
import { sendTelegramMessage } from '@/lib/telegram/sendDailyFinanceReport';
import { salaryErrorCode, salaryErrorResponse } from './errors';

type Body = Record<string, unknown>;
type Notification = SalaryNotificationInput extends infer T ? T extends unknown ? Omit<T, 'addedBy' | 'employee'> : never : never;
type DatabaseError = { message: string; code?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isDate = (value: unknown): value is string => typeof value === 'string' && DATE.test(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isSalaryType = (value: unknown): value is 'daily' | 'monthly' => value === 'daily' || value === 'monthly';
const text = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value.trim() : null);

class BadRequest extends Error {}

/** Optional KPI basis/pools; null means "keep what the employee has today". */
function kpiSettings(body: Body): { basis: string | null; gameClub: boolean | null; bar: boolean | null } {
  const basis = body.kpiBasis ?? null;
  const gameClub = body.kpiGameClub ?? null;
  const bar = body.kpiBar ?? null;
  if ((basis !== null && basis !== 'owner_profit' && basis !== 'overall_profit')
    || (gameClub !== null && typeof gameClub !== 'boolean') || (bar !== null && typeof bar !== 'boolean')
    || (gameClub === false && bar === false)) throw new BadRequest();
  return { basis, gameClub, bar };
}
const withDefaults = (settings: ReturnType<typeof kpiSettings>) => ({
  basis: (settings.basis ?? 'overall_profit') as 'owner_profit' | 'overall_profit',
  gameClub: settings.gameClub ?? true,
  bar: settings.bar ?? true,
});

/** Best-effort and run after the response: a Telegram problem never fails an already committed payroll change. */
async function notify(supabase: SupabaseClient, user: User, clubId: string, employeeId: string, notification: Notification) {
  const chatId = targetChatId(clubId);
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!chatId || !botToken) return false;
  try {
    const [{ data: employee }, addedBy] = await Promise.all([
      supabase.from('salary_employees').select('name').eq('club_id', clubId).eq('id', employeeId).maybeSingle(),
      actorName(supabase, user),
    ]);
    await sendTelegramMessage({
      botToken,
      chatId,
      text: buildSalaryNotification({ ...notification, employee: employee?.name ?? '—', addedBy } as SalaryNotificationInput),
    });
    return true;
  } catch (error) {
    console.error('[telegram/salary] notification failed', {
      clubId, employeeId, error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return salaryErrorResponse('UNAUTHORIZED');

  const body = await request.json().catch(() => null) as Body | null;
  if (!body || !isId(body.clubId) || !isId(body.employeeId)) return salaryErrorResponse('INVALID_REQUEST');
  const clubId = body.clubId;
  const employeeId = body.employeeId;
  const fail = (step: string, error: DatabaseError) => {
    console.error('[salaries] write failed', { action: body.action, step, clubId, code: error.code, error: error.message });
    return salaryErrorResponse(salaryErrorCode(error));
  };

  try {
    let notification: Notification | null = null;
    let rpcResult: { error: DatabaseError | null };

    switch (body.action) {
      case 'save_employee': {
        const name = text(body.name, 120);
        const jobTitle = text(body.jobTitle, 120);
        if (!name || jobTitle === null || !isDate(body.date) || !isSalaryType(body.salaryType)
          || !isNumber(body.amount) || !isNumber(body.kpi) || typeof body.active !== 'boolean') throw new BadRequest();
        const kpiOptions = kpiSettings(body);
        // Only picks the notification title; the RPC itself decides insert vs update.
        const { data: existing, error: lookupError } = await supabase.from('salary_employees').select('id').eq('club_id', clubId).eq('id', employeeId).maybeSingle();
        if (lookupError) return fail('employee_lookup', lookupError);
        rpcResult = await supabase.rpc('save_salary_employee', {
          p_kpi_basis: kpiOptions.basis, p_kpi_game_club: kpiOptions.gameClub, p_kpi_bar: kpiOptions.bar,
          p_club_id: clubId, p_employee_id: employeeId, p_name: name, p_job_title: jobTitle,
          p_effective_date: body.date, p_salary_type: body.salaryType, p_amount: body.amount, p_kpi_percent: body.kpi, p_active: body.active,
        });
        notification = { event: existing ? 'employee_updated' : 'employee_added', role: jobTitle, salaryType: body.salaryType, amount: body.amount, kpi: body.kpi, kpiSettings: withDefaults(kpiOptions), date: body.date };
        break;
      }
      case 'change_term': {
        if ((body.kind !== 'salary' && body.kind !== 'kpi') || !isNumber(body.amount)) throw new BadRequest();
        const salaryType = body.kind === 'salary' ? body.salaryType : null;
        if (body.kind === 'salary' && !isSalaryType(salaryType)) throw new BadRequest();
        const kpiOptions = kpiSettings(body);
        rpcResult = await supabase.rpc('change_salary_term', {
          p_club_id: clubId, p_employee_id: employeeId, p_kind: body.kind, p_amount: body.amount, p_salary_type: salaryType,
          p_kpi_basis: kpiOptions.basis, p_kpi_game_club: kpiOptions.gameClub, p_kpi_bar: kpiOptions.bar,
        });
        notification = body.kind === 'kpi'
          ? { event: 'kpi_changed', kpi: body.amount, kpiSettings: withDefaults(kpiOptions) }
          : { event: 'salary_changed', salaryType: salaryType as 'daily' | 'monthly', amount: body.amount };
        break;
      }
      case 'change_role': {
        const role = text(body.jobTitle, 120);
        if (!role) throw new BadRequest();
        rpcResult = await supabase.rpc('change_salary_employee_role', { p_club_id: clubId, p_employee_id: employeeId, p_job_title: role });
        break;
      }
      case 'set_active': {
        if (typeof body.active !== 'boolean') throw new BadRequest();
        rpcResult = await supabase.rpc(body.active ? 'activate_salary_employee' : 'deactivate_salary_employee', { p_club_id: clubId, p_employee_id: employeeId });
        notification = { event: body.active ? 'activated' : 'deactivated' };
        break;
      }
      case 'record_entry': {
        if (!isId(body.requestId) || !isDate(body.date) || !isNumber(body.amount)
          || (body.kind !== 'payment' && body.kind !== 'bonus' && body.kind !== 'fine')) throw new BadRequest();
        const comment = text(body.comment, 1000);
        if (comment === null) throw new BadRequest();
        const paymentMethod = body.kind === 'payment' && typeof body.paymentMethod === 'string' ? body.paymentMethod : null;
        const paymentSource = body.kind === 'payment' && typeof body.paymentSource === 'string' ? body.paymentSource : null;
        const params = {
          p_club_id: clubId, p_employee_id: employeeId, p_request_id: body.requestId, p_date: body.date,
          p_kind: body.kind, p_amount: body.amount, p_comment: comment, p_payment_method: paymentMethod, p_payment_source: paymentSource,
        };
        // A retried request id is idempotent in the database, so it must not notify twice.
        // Migration 077 reports that atomically; older databases need a read first.
        const recorded = await supabase.rpc('record_salary_entry_with_status', params);
        let created: boolean;
        if (recorded.error && isMissingDatabaseFunction(recorded.error, 'record_salary_entry_with_status')) {
          const { data: existing, error: lookupError } = await supabase.from('salary_entries').select('id').eq('club_id', clubId).eq('id', body.requestId).maybeSingle();
          if (lookupError) return fail('entry_lookup', lookupError);
          rpcResult = await supabase.rpc('record_salary_entry', params);
          created = !existing;
        } else {
          rpcResult = recorded;
          const row = (Array.isArray(recorded.data) ? recorded.data[0] : recorded.data) as { created?: boolean } | null;
          created = row?.created === true;
        }
        if (created) notification = { event: body.kind, amount: body.amount, date: body.date, comment: comment || null, paymentMethod, paymentSource };
        break;
      }
      case 'delete_record': {
        if (!isId(body.recordId) || (body.kind !== 'entry' && body.kind !== 'rate')) throw new BadRequest();
        // Read what is being deleted first, only to describe it in the group notification.
        const lookup = body.kind === 'entry'
          ? await supabase.from('salary_entries').select('kind, amount, date').eq('club_id', clubId).eq('id', body.recordId).maybeSingle()
          : await supabase.from('salary_rates').select('effective_date').eq('club_id', clubId).eq('id', body.recordId).maybeSingle();
        if (lookup.error) return fail('record_lookup', lookup.error);
        // Same audited RPC as before; it checks the record belongs to the club and the caller's access.
        rpcResult = await supabase.rpc('delete_salary_record', { p_club_id: clubId, p_id: body.recordId, p_kind: body.kind });
        const record = lookup.data as { kind?: 'payment' | 'bonus' | 'fine'; amount?: number | string; date?: string; effective_date?: string } | null;
        if (record?.kind && record.date) {
          notification = { event: 'entry_deleted', kind: record.kind, amount: Number(record.amount), date: record.date };
        } else if (record?.effective_date) {
          notification = { event: 'rate_deleted', effectiveDate: record.effective_date };
        }
        break;
      }
      default:
        throw new BadRequest();
    }

    if (rpcResult.error) return fail('rpc', rpcResult.error);

    if (notification) {
      const pending = notification;
      after(() => notify(supabase, user, clubId, employeeId, pending));
    }
    return Response.json({ ok: true, notificationQueued: notification !== null });
  } catch (error) {
    if (error instanceof BadRequest) return salaryErrorResponse('INVALID_REQUEST');
    throw error;
  }
}
