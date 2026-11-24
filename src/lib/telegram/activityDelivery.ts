import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchProfileNames } from '../supabase/profileNames';
import {
  buildActivityNotices,
  type ActivityAuditRow,
  type ActivityLookups,
  type ShortageLookup,
} from './activityNotification';
import { ownerChatId, targetChatId } from './clubChat';
import { sendTelegramMessage, TelegramSendError } from './sendDailyFinanceReport';

/**
 * Sends a club's pending activity notices (migration 183): claims the rows
 * through the service-only `claim_activity_notices`, reads the names they
 * mention, and posts one message per change, oldest first. Best effort: a
 * failure is logged and never thrown, so the save, the request or the report
 * that triggered the delivery never fails because of Telegram.
 *
 * Sending stops at the first failure. Claimed rows whose notice was not sent
 * (the ones after it, and the failed one when Telegram definitely did not
 * take it: a rate limit, a server error, no time left) go back to pending
 * through `release_activity_notices`, for the next page call or the nightly
 * report. A message whose fate is unknown is never sent twice.
 */

export interface ActivityDeliveryOptions {
  /** Rows claimed per round (the RPC caps it at 200). */
  batchSize?: number;
  /** Rounds per call; whatever is left waits for the next call. */
  maxBatches?: number;
  /** Epoch ms by which every send must have finished; no round is claimed after it. */
  deadlineAt?: number;
  now?: () => number;
}

export interface ActivityDeliveryResult {
  /** Log rows claimed. */
  claimed: number;
  sent: number;
  /** Messages Telegram refused or may not have received; not sent again. */
  failed: number;
  /** Messages with no group to go to (no owners' group for a shortage). */
  unrouted: number;
  /** Claimed rows given back to pending. */
  released: number;
}

type Reader = Pick<SupabaseClient, 'from' | 'rpc'>;

const EMPTY_RESULT: ActivityDeliveryResult = { claimed: 0, sent: 0, failed: 0, unrouted: 0, released: 0 };

const errorMessage = (error: unknown) => (error instanceof Error
  ? error.message
  : typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: unknown }).message) : String(error));

/** Distinct non-empty values of `field` in the rows' before and after. */
function referenced(rows: readonly ActivityAuditRow[], field: string): string[] {
  const values = rows.flatMap((row) => [row.old_row?.[field], row.new_row?.[field]]);
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value !== ''))];
}

async function namesById(
  supabase: Reader,
  table: string,
  columns: string,
  clubId: string,
  ids: string[],
): Promise<Array<Record<string, unknown>>> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from(table).select(columns).eq('club_id', clubId).in('id', ids);
  if (error) {
    console.error('[telegram/activity] lookup failed', { clubId, table, error: error.message });
    return [];
  }
  return (data ?? []) as unknown as Array<Record<string, unknown>>;
}

/** The people, products, employees, debts and shortages the rows mention. Failed reads leave names out. */
export async function loadActivityLookups(supabase: Reader, clubId: string, rows: readonly ActivityAuditRow[]): Promise<ActivityLookups> {
  const userIds = [...new Set([
    ...rows.map((row) => row.changed_by),
    ...rows.filter((row) => row.table_name === 'club_memberships').map((row) => row.row_id),
  ].filter((id): id is string => typeof id === 'string' && id !== ''))];

  const [people, products, employees, debts, shortages] = await Promise.all([
    fetchProfileNames(supabase, userIds).catch((error: unknown) => {
      console.error('[telegram/activity] lookup failed', { clubId, table: 'profiles', error: errorMessage(error) });
      return new Map<string, string | null>();
    }),
    namesById(supabase, 'products', 'id, name', clubId, referenced(rows, 'product_id')),
    namesById(supabase, 'salary_employees', 'id, name', clubId, referenced(rows, 'employee_id')),
    namesById(supabase, 'new_debts', 'id, person_name', clubId, referenced(rows, 'debt_id')),
    namesById(supabase, 'cash_shortages', 'id, amount, date, created_at', clubId, referenced(rows, 'cash_shortage_id')),
  ]);

  const named = (list: Array<Record<string, unknown>>, field: string) => new Map(
    list.map((row) => [String(row.id), typeof row[field] === 'string' ? (row[field] as string).trim() : '']),
  );
  return {
    people: new Map([...people].map(([id, name]) => [id, name?.trim() ?? ''])),
    products: named(products, 'name'),
    employees: named(employees, 'name'),
    debts: named(debts, 'person_name'),
    shortages: new Map(shortages.map((row): [string, ShortageLookup] => [String(row.id), {
      amount: Number(row.amount ?? 0),
      date: String(row.date ?? ''),
      created_at: String(row.created_at ?? ''),
    }])),
  };
}

/** Telegram certainly did not post the message, so sending it again cannot duplicate it. */
const notDelivered = (error: unknown) => error instanceof TelegramSendError && error.retryable && !error.requiresManualReview;

async function release(supabase: Reader, clubId: string, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.rpc('release_activity_notices', { p_club_id: clubId, p_ids: ids });
  if (error) {
    console.error('[telegram/activity] release failed', { clubId, logIds: ids, error: error.message });
    return 0;
  }
  return Number(data ?? 0);
}

export async function deliverActivityNotices(
  supabase: Reader,
  clubId: string,
  options: ActivityDeliveryOptions = {},
): Promise<ActivityDeliveryResult> {
  const result = { ...EMPTY_RESULT };
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chats = { club: targetChatId(clubId), owners: ownerChatId(clubId) };
  // Nowhere to send: leave the rows pending rather than claim and drop them.
  if (!botToken || (!chats.club && !chats.owners)) return result;

  const { batchSize = 50, maxBatches = 4, deadlineAt, now = Date.now } = options;
  const pastDeadline = () => deadlineAt !== undefined && now() >= deadlineAt;

  try {
    for (let batch = 0; batch < maxBatches && !pastDeadline(); batch += 1) {
      const { data, error } = await supabase.rpc('claim_activity_notices', { p_club_id: clubId, p_limit: batchSize });
      if (error) {
        console.error('[telegram/activity] claim failed', { clubId, code: error.code, error: error.message });
        break;
      }
      const rows = (data ?? []) as ActivityAuditRow[];
      if (rows.length === 0) break;
      result.claimed += rows.length;

      // Claimed ids not yet sent or settled; whatever is left goes back to pending.
      const unsent = new Set(rows.map((row) => row.id));
      const settle = (ids: number[]) => ids.forEach((id) => unsent.delete(id));
      let stopped = false;
      try {
        const notices = buildActivityNotices(rows, await loadActivityLookups(supabase, clubId, rows));
        const told = new Set(notices.flatMap((notice) => notice.logIds));
        settle(rows.map((row) => row.id).filter((id) => !told.has(id)));
        for (const notice of notices) {
          const chatId = chats[notice.chat];
          if (!chatId) {
            result.unrouted += 1;
            settle(notice.logIds);
            continue;
          }
          try {
            await sendTelegramMessage({ botToken, chatId, text: notice.text, deadlineAt, now });
            result.sent += 1;
            settle(notice.logIds);
          } catch (sendError) {
            stopped = true;
            console.error('[telegram/activity] notice failed', { clubId, logIds: notice.logIds, error: errorMessage(sendError) });
            if (!notDelivered(sendError)) {
              result.failed += 1;
              settle(notice.logIds);
            }
            break;
          }
        }
      } catch (error) {
        stopped = true;
        console.error('[telegram/activity] delivery failed', { clubId, error: errorMessage(error) });
      }
      result.released += await release(supabase, clubId, [...unsent]);
      if (stopped || rows.length < batchSize) break;
    }
  } catch (error) {
    console.error('[telegram/activity] delivery failed', { clubId, error: errorMessage(error) });
  }
  return result;
}

/**
 * Drops every club's pending notices older than three days, including clubs
 * with no group, whose rows nobody claims. Best effort; returns how many.
 */
export async function expireActivityNotices(supabase: Pick<SupabaseClient, 'rpc'>): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('expire_activity_notices');
    if (error) {
      console.error('[telegram/activity] expiry failed', { code: error.code, error: error.message });
      return 0;
    }
    return Number(data ?? 0);
  } catch (error) {
    console.error('[telegram/activity] expiry failed', { error: errorMessage(error) });
    return 0;
  }
}
